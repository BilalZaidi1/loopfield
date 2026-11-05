import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import type { Href } from 'expo-router';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { supabase } from '@/lib/supabase';

/**
 * Push registration and routing. The backend sends exactly one Expo push per notification row with a
 * content-free preview (no message text); Stream's own push is disabled, so there are no duplicates.
 */
let currentToken: string | null = null;
let viewingChannel: string | null = null;

export function setViewingChannel(channelId: string | null): void {
  viewingChannel = channelId;
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = n.request.content.data as { channel_id?: string } | undefined;
    const suppress = Boolean(data?.channel_id && data.channel_id === viewingChannel);
    return { shouldShowBanner: !suppress, shouldShowList: !suppress, shouldPlaySound: false, shouldSetBadge: true };
  }
});

export async function notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const s = await Notifications.getPermissionsAsync();
  return s.granted ? 'granted' : s.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestNotificationPermission(): Promise<boolean> {
  const s = await Notifications.requestPermissionsAsync();
  track('permission_outcome', { category: 'notifications', outcome: s.granted ? 'granted' : 'denied', os_family: Platform.OS === 'ios' ? 'ios' : 'android' });
  return s.granted;
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Register this device's Expo push token for the signed-in user (only after the user granted permission). */
export async function registerPushToken(userId: string): Promise<'registered' | 'no_permission' | 'not_configured' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';
  if ((await notificationPermission()) !== 'granted') return 'no_permission';
  const pid = projectId();
  if (!pid) return 'not_configured';
  if (Platform.OS === 'android') {
    // eslint-disable-next-line import/namespace -- re-exported enum the import plugin cannot follow
    await Notifications.setNotificationChannelAsync('default', { name: 'Updates', importance: Notifications.AndroidImportance.DEFAULT, showBadge: true });
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
  currentToken = token;
  const sb = supabase();
  const ins = await sb.from('push_tokens').insert({ user_id: userId, token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  if (ins.error && ins.error.code !== '23505') log.warn(`push token register failed: ${ins.error.message}`);
  if (ins.error?.code === '23505') await sb.from('push_tokens').update({ last_seen_at: new Date().toISOString(), disabled_at: null }).eq('token', token);
  return 'registered';
}

/** On sign-out the device stops receiving the previous user's notifications. */
export async function unregisterPushToken(): Promise<void> {
  if (!currentToken) return;
  await supabase().from('push_tokens').delete().eq('token', currentToken);
  currentToken = null;
}

/** Map a notification row to an in-app destination (shared by the inbox list and push taps). */
export function routeForNotification(n: { kind: string; object_type: string | null; object_id: string | null; data?: Record<string, unknown> | null }): Href {
  const id = n.object_id ?? '';
  if (n.kind === 'follow_request') return '/connections';
  if (n.kind === 'club_join_request') return { pathname: '/club/[id]/organizer', params: { id } };
  if (n.kind === 'territory_digest') return '/map';
  if (n.kind === 'title_digest') return '/routes';
  switch (n.object_type) {
    case 'post':
      return { pathname: '/post/[id]', params: { id } };
    case 'conversation':
      return n.data?.channel_id ? { pathname: '/inbox/[channel]', params: { channel: String(n.data.channel_id) } } : '/inbox';
    case 'club':
      return { pathname: '/club/[id]', params: { id } };
    case 'profile':
      return { pathname: '/profile/[id]', params: { id } };
    case 'activity':
      return { pathname: '/activities/[id]', params: { id } };
    case 'appeal':
    case 'integrity_case':
    case 'moderation_case':
      return '/appeals';
    case 'data_export':
      return '/settings/account';
    case 'route_proposal':
      return '/proposals';
    case 'course':
      return { pathname: '/routes/[id]', params: { id } };
  }
  return '/notifications';
}

export async function routeForPushTap(data: Record<string, unknown>): Promise<Href> {
  const id = typeof data.notification_id === 'string' ? data.notification_id : null;
  if (!id) return '/notifications';
  const { data: row } = await supabase().from('notifications').select('id, kind, category, object_type, object_id, data').eq('id', id).maybeSingle();
  if (!row) return '/notifications';
  void supabase().rpc('mark_notifications_read', { p_ids: [id] });
  const category = String(row.category);
  track('notification_opened', { category: (['social', 'message', 'club', 'competitive', 'system'].includes(category) ? category : 'system') as 'social' });
  return routeForNotification(row as never);
}
