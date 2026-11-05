import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Linking, Platform, View } from 'react-native';
import * as Location from 'expo-location';
import { COMPETITION_CONSENT_VERSION } from '@/config/env';
import { friendlyError, rpc } from '@/lib/api';
import { setAnalyticsConsent, track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Card, Screen, Segmented, Toggle, Txt } from '@/components/ui';
import { requestNotificationPermission, notificationPermission } from '@/notifications/push';
import { ensureLocationPermission } from '@/recording/recorder';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

type LocState = 'unknown' | 'granted' | 'foreground_only' | 'denied' | 'services_disabled';

/** S05 Permissions setup — location and background readiness; optional notifications; health later. */
export default function PermissionsSetup() {
  const { userId, refresh } = useSession();
  const status = useQuery({
    queryKey: ['permission-status'],
    queryFn: async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'undetermined' }));
      const loc: LocState = fg.status !== 'granted' ? (fg.canAskAgain ? 'unknown' : 'denied') : bg.status === 'granted' ? 'granted' : 'foreground_only';
      return { loc, notif: await notificationPermission() };
    }
  });
  const [asked, setAsked] = useState<LocState | null>(null);
  const loc: LocState = asked ?? status.data?.loc ?? 'unknown';
  const notif = status.data?.notif ?? 'undetermined';
  const read = () => void status.refetch();
  const [mode, setMode] = useState<'explore' | 'compete' | 'social'>('explore');
  const [territory, setTerritory] = useState(false);
  const [speed, setSpeed] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askLocation = async () => {
    const r = await ensureLocationPermission();
    setAsked(r);
    const os = Platform.OS === 'ios' ? 'ios' : 'android';
    track('permission_outcome', { category: 'location_foreground', outcome: r === 'denied' || r === 'services_disabled' ? 'denied' : 'granted', os_family: os });
    track('permission_outcome', { category: 'location_background', outcome: r === 'granted' ? 'granted' : 'denied', os_family: os });
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (territory) await rpc('set_consent', { p_kind: 'territory_competition', p_granted: true, p_version: COMPETITION_CONSENT_VERSION });
      if (speed) await rpc('set_consent', { p_kind: 'speed_competition', p_granted: true, p_version: COMPETITION_CONSENT_VERSION });
      await rpc('set_consent', { p_kind: 'analytics', p_granted: analytics, p_version: 'v1' });
      await setAnalyticsConsent(analytics);
      const { error: e } = await supabase().from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', userId!);
      if (e) throw e;
      track('onboarding_completed', { mode, app_version: '0.1.0' });
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const locText: Record<LocState, string> = {
    unknown: 'Not set up yet. Recording needs location while you run.',
    granted: 'Ready: runs keep recording when the screen is locked.',
    foreground_only: 'Recording works while the app is open. Allow "Always" (iOS) or "Allow all the time" (Android) so a locked screen does not stop your run.',
    denied: 'Location is off for this app. Turn it on in system settings to record runs.',
    services_disabled: 'Location services are off on this phone.'
  };

  return (
    <Screen>
      <View style={{ gap: spacing.md, marginTop: spacing.lg, paddingBottom: spacing.xl }}>
        <Txt variant="caption">Step 2 of 2</Txt>
        <Txt variant="title">Get ready to run</Txt>
        <Card>
          <Txt variant="heading">Location</Txt>
          <Txt color="textMuted">{locText[loc]}</Txt>
          <Txt variant="caption">Location is recorded only during runs you start. Raw traces are never shown to other runners.</Txt>
          {loc === 'denied' || loc === 'services_disabled' ? (
            <Button variant="secondary" label="Open settings" onPress={() => void Linking.openSettings()} />
          ) : loc !== 'granted' ? (
            <Button variant="secondary" label="Allow location" onPress={askLocation} />
          ) : null}
        </Card>
        <Card>
          <Txt variant="heading">Notifications (optional)</Txt>
          <Txt color="textMuted">Follow requests, messages, club updates and one daily territory digest. Previews never include message text.</Txt>
          {notif === 'granted' ? <Txt variant="label" color="success">On</Txt> : notif === 'denied' ? <Button variant="ghost" label="Open settings" onPress={() => void Linking.openSettings()} /> : <Button variant="secondary" label="Allow notifications" onPress={() => void requestNotificationPermission().then(read)} />}
        </Card>
        <Card>
          <Txt variant="heading">Health data (later)</Txt>
          <Txt color="textMuted">You can connect {Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'} any time from Progress → Health. It stays on this phone and never affects competition.</Txt>
        </Card>
        <Card>
          <Txt variant="heading">How do you want to start?</Txt>
          <Segmented label="Starting mode" value={mode} onChange={setMode} options={[{ value: 'explore', label: 'Explore' }, { value: 'compete', label: 'Compete' }, { value: 'social', label: 'Social' }]} />
          <Toggle label="Take part in territory" description="Eligible loops you start in competitive mode can claim land on the shared map. You can turn this off later; your land is then withdrawn." value={territory} onChange={setTerritory} />
          <Toggle label="Take part in route titles" description="Timed attempts on approved routes can earn titles. Separate from land." value={speed} onChange={setSpeed} />
          <Txt variant="caption">Competition rules and thresholds are proposed pilot values and may change after field testing.</Txt>
        </Card>
        <Toggle label="Share anonymous usage analytics" description="Helps improve the app. Never includes GPS, health readings, messages or what you write. Off by default." value={analytics} onChange={setAnalytics} />
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button label="Finish setup" onPress={finish} loading={busy} />
      </View>
    </Screen>
  );
}
