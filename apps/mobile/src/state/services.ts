import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { queryClient } from '@/lib/query';
import { log } from '@/lib/log';
import { processUploads } from '@/recording/uploader';
import { checkRecovery } from '@/recording/recorder';
import { getConnection } from '@/health/cache';
import { HEALTH_PLATFORM, syncHealth } from '@/health/sync';
import { registerPushToken, routeForPushTap } from '@/notifications/push';

const HEALTH_SYNC_MIN_INTERVAL_MS = 15 * 60_000;

/**
 * App-level background duties for a signed-in runner:
 *  - recover an interrupted recording (never reconstructing missing movement),
 *  - drain the upload queue on launch, foreground and reconnect,
 *  - incremental on-device health sync on foreground,
 *  - push registration and notification-tap routing.
 */
export function useBackgroundServices(userId: string | null): void {
  const lastHealthSync = useRef(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const drain = async () => {
      try {
        const n = await processUploads(userId);
        if (n > 0) {
          void queryClient.invalidateQueries({ queryKey: ['activities'] });
          void queryClient.invalidateQueries({ queryKey: ['activity'] });
          void queryClient.invalidateQueries({ queryKey: ['local-runs'] });
        }
      } catch (e) {
        log.warn(`upload drain failed: ${String(e)}`);
      }
    };
    const health = async () => {
      const c = getConnection(HEALTH_PLATFORM);
      if (!c.connected || Date.now() - lastHealthSync.current < HEALTH_SYNC_MIN_INTERVAL_MS) return;
      lastHealthSync.current = Date.now();
      await syncHealth().catch(() => {});
    };

    void (async () => {
      const r = await checkRecovery().catch(() => ({ kind: 'none' as const }));
      if (!cancelled && r.kind !== 'none') router.push('/run/active');
      await drain();
      await health();
      await registerPushToken(userId).catch((e) => log.warn(`push registration failed: ${String(e)}`));
      if (Platform.OS === 'web') return; // no push taps to route in the browser version
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!cancelled && last) router.push(await routeForPushTap(last.notification.request.content.data as Record<string, unknown>));
    })();

    const appSub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void drain();
      void health();
      void queryClient.invalidateQueries({ queryKey: ['badge_counts'] });
    });
    let wasOnline = true;
    const netSub = NetInfo.addEventListener((st) => {
      const online = Boolean(st.isConnected && st.isInternetReachable !== false);
      if (online && !wasOnline) void drain();
      wasOnline = online;
    });
    const tapSub = Notifications.addNotificationResponseReceivedListener((resp) => {
      void routeForPushTap(resp.notification.request.content.data as Record<string, unknown>).then((href) => router.push(href));
    });
    const recvSub = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ['badge_counts'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      cancelled = true;
      appSub.remove();
      netSub();
      tapSub.remove();
      recvSub.remove();
    };
  }, [userId]);
}
