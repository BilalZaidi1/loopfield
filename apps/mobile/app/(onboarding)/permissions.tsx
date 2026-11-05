import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Linking, Platform, View } from 'react-native';
import * as Location from 'expo-location';
import { COMPETITION_CONSENT_VERSION } from '@/config/env';
import { friendlyError, rpc } from '@/lib/api';
import { setAnalyticsConsent, track } from '@/lib/analytics';
import { isExpoGo } from '@/lib/runtime';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, Chip, ListGroup, Screen, Toggle, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { StepHeader } from '@/features/onboarding/StepHeader';
import { requestNotificationPermission, notificationPermission } from '@/notifications/push';
import { ensureLocationPermission } from '@/recording/recorder';
import { useSession } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';

type LocState = 'unknown' | 'granted' | 'foreground_only' | 'denied' | 'services_disabled';

/** S05 Permissions setup — location and background readiness; optional notifications; health later. */
export default function PermissionsSetup() {
  const { userId, refresh } = useSession();
  const status = useQuery({
    queryKey: ['permission-status'],
    queryFn: async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync().catch(() => ({ status: 'undetermined' }));
      const loc: LocState = fg.status !== 'granted' ? (fg.canAskAgain ? 'unknown' : 'denied') : bg.status === 'granted' && !isExpoGo ? 'granted' : 'foreground_only';
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
    foreground_only: isExpoGo
      ? 'Recording works while the app is open. Expo Go cannot record with the screen locked; the installed Loopfield app can.'
      : 'Recording works while the app is open. Allow "Always" (iOS) or "Allow all the time" (Android) so a locked screen does not stop your run.',
    denied: 'Location is off for this app. Turn it on in system settings to record runs.',
    services_disabled: 'Location services are off on this phone.'
  };

  const locBadge: Record<LocState, { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }> = {
    unknown: { label: 'Not set up', tone: 'muted' },
    granted: { label: 'Ready', tone: 'success' },
    foreground_only: { label: 'While open', tone: 'warning' },
    denied: { label: 'Off', tone: 'danger' },
    services_disabled: { label: 'Off', tone: 'danger' }
  };

  return (
    <Screen maxWidth={560} footer={<Button label="Finish setup" size="lg" arrow onPress={finish} loading={busy} />}>
      <StepHeader step={2} of={2} title="Get ready to run" subtitle="Location is the only thing a run needs. Everything else is optional and can change later." />
      <Card>
        <PermissionHead icon="locate" title="Location" badge={locBadge[loc]} />
        <Txt color="textMuted">{locText[loc]}</Txt>
        <Txt variant="caption">Location is recorded only during runs you start. Raw traces are never shown to other runners.</Txt>
        {loc === 'denied' || loc === 'services_disabled' ? (
          <Button variant="secondary" label="Open settings" icon="settings" onPress={() => void Linking.openSettings()} />
        ) : loc !== 'granted' && !(isExpoGo && loc === 'foreground_only') ? (
          <Button label="Allow location" icon="locate" onPress={askLocation} />
        ) : null}
      </Card>
      <Card>
        <PermissionHead icon="bell" title="Notifications" badge={notif === 'granted' ? { label: 'On', tone: 'success' } : notif === 'denied' ? { label: 'Off', tone: 'danger' } : { label: 'Optional', tone: 'muted' }} />
        <Txt color="textMuted">Follow requests, messages, club updates and one daily territory digest. Previews never include message text.</Txt>
        {notif === 'granted' ? null : notif === 'denied' ? <Button variant="ghost" label="Open settings" onPress={() => void Linking.openSettings()} /> : <Button variant="secondary" label="Allow notifications" icon="bell" onPress={() => void requestNotificationPermission().then(read)} />}
      </Card>
      <Card>
        <PermissionHead icon="pulse" title="Health data" badge={{ label: 'Later', tone: 'muted' }} />
        <Txt color="textMuted">You can connect {Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'} any time from Progress → Health. It stays on this phone and never affects competition.</Txt>
      </Card>
      <View style={{ gap: spacing.md }}>
        <Txt variant="headline">How do you want to start?</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel="Starting mode">
          <Chip label="Explore" icon="compass" selected={mode === 'explore'} onPress={() => setMode('explore')} />
          <Chip label="Compete" icon="trophy" selected={mode === 'compete'} onPress={() => setMode('compete')} />
          <Chip label="Social" icon="clubs" selected={mode === 'social'} onPress={() => setMode('social')} />
        </View>
        <ListGroup>
          <Toggle label="Take part in territory" description="Eligible loops you start in competitive mode can claim land on the shared map. You can turn this off later; your land is then withdrawn." value={territory} onChange={setTerritory} />
          <Toggle label="Take part in route titles" description="Timed attempts on approved routes can earn titles. Separate from land." value={speed} onChange={setSpeed} />
        </ListGroup>
        <Txt variant="caption">Competition rules and thresholds are proposed pilot values and may change after field testing.</Txt>
      </View>
      <ListGroup>
        <Toggle label="Share anonymous usage analytics" description="Helps improve the app. Never includes GPS, health readings, messages or what you write. Off by default." value={analytics} onChange={setAnalytics} />
      </ListGroup>
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}

function PermissionHead({ icon, title, badge }: { icon: IconName; title: string; badge: { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={p.primary} size={22} />
      </View>
      <Txt variant="heading" style={{ flex: 1 }}>{title}</Txt>
      <Badge label={badge.label} tone={badge.tone} />
    </View>
  );
}
