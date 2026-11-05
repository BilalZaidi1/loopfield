import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { TERRITORY_RULES } from '@loopfield/core';
import { ApiError, friendlyError, rpc } from '@/lib/api';
import { fmtDistance } from '@/lib/format';
import { isExpoGo } from '@/lib/runtime';
import { ArrowLink, Banner, Button, Card, OfflineBanner, PressableScale, Row, Screen, Toggle, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { GoButton } from '@/features/run/GoButton';
import { TopBar } from '@/components/TopBar';
import { activeSession, type RunMode } from '@/recording/db';
import { createSession, discardRun, ensureLocationPermission, startRun } from '@/recording/recorder';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { radius, spacing, usePalette } from '@/theme/tokens';

type Gps = { state: 'checking' | 'off' | 'weak' | 'good'; accuracy: number | null };

/** Runs are recorded only in the phone app; the browser version shows this screen for reference. */
const BROWSER = Platform.OS === 'web';

function useGpsReadiness(enabled: boolean): Gps {
  const [gps, setGps] = useState<Gps>({ state: 'checking', accuracy: null });
  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setGps({ state: 'off', accuracy: null });
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 }, (loc) => {
        if (cancelled) return;
        const acc = loc.coords.accuracy ?? null;
        setGps({ state: acc != null && acc <= TERRITORY_RULES.closureEndpointMaxAccuracyMeters.value ? 'good' : 'weak', accuracy: acc });
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);
  return gps;
}

interface CourseOption {
  course_id: string;
  course_version_id: string;
  name: string;
  status: string;
  length_m: number;
}

/** S20 Pre-run — Private, Territory or Speed mode; GPS status, competition, consent and optional capture. */
export default function PreRun() {
  const p = usePalette();
  const params = useLocalSearchParams<{ course?: string }>();
  const units = useUnits();
  const { userId, settings } = useSession();
  const { competition, season } = useCompetition();
  const [inProgress, setInProgress] = useState(() => activeSession());
  const [mode, setMode] = useState<RunMode>(params.course ? 'speed' : 'private');
  const [captureNow, setCaptureNow] = useState(true);
  const [courseId, setCourseId] = useState<string | null>(params.course ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gps = useGpsReadiness(!inProgress && !BROWSER);

  useFocusEffect(useCallback(() => setInProgress(activeSession()), []));

  const course = useQuery({
    queryKey: ['course-option', courseId, competition?.id, season?.id],
    enabled: Boolean(courseId && competition && season),
    queryFn: async () => {
      const d = await rpc<{ course_id: string; course_version_id: string; name: string; status: string; length_m: number } | null>('speed_route_detail', { p_course: courseId, p_competition: competition!.id, p_season: season!.id });
      return d as CourseOption | null;
    }
  });

  const wantsTerritory = mode === 'territory' || mode === 'territory_speed';
  const wantsSpeed = mode === 'speed' || mode === 'territory_speed';
  const blockers: string[] = [];
  if (BROWSER) blockers.push('Runs are recorded in the Loopfield phone app. The browser version shows everything else.');
  if (mode !== 'private') {
    if (settings?.full_private_mode) blockers.push('Full private mode is on. Competitive runs are unavailable.');
    if (!competition || !season) blockers.push('There is no active season for the selected competition.');
    if (wantsTerritory && !settings?.territory_competition_enabled) blockers.push('Turn on territory in Privacy settings to claim land.');
    if (wantsSpeed && !settings?.speed_competition_enabled) blockers.push('Turn on route titles in Privacy settings to race routes.');
    if (wantsSpeed && !courseId) blockers.push('Choose a route from Speed routes to attempt a title.');
    if (wantsSpeed && course.data && course.data.status !== 'active') blockers.push('This route is not accepting attempts right now.');
  }

  const start = async (forceMode?: RunMode) => {
    const m = forceMode ?? mode;
    setBusy(true);
    setError(null);
    let sessionId: string | null = null;
    try {
      const perm = await ensureLocationPermission();
      if (perm === 'denied' || perm === 'services_disabled') {
        setError(perm === 'services_disabled' ? 'Location services are off on this phone.' : 'Location permission is needed to record a run.');
        return;
      }
      if (perm === 'foreground_only') {
        const proceed = await new Promise<boolean>((resolve) =>
          isExpoGo
            ? Alert.alert('Keep Loopfield open', 'Expo Go records only while the app is on screen, so the screen stays on during the run. Time spent outside the app is kept as a gap, never filled in.', [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Record', onPress: () => resolve(true) }
              ])
            : Alert.alert('Recording may stop when locked', 'Without "Always" location access, the phone can stop recording when the screen locks. Missing time is shown as a gap, never filled in.', [
                { text: 'Open settings', onPress: () => { void Linking.openSettings(); resolve(false); } },
                { text: 'Record anyway', onPress: () => resolve(true) }
              ])
        );
        if (!proceed) return;
      }
      const s = await createSession({ userId: userId!, mode: m, competitionId: m === 'private' ? null : competition?.id ?? null, courseVersionId: m === 'speed' || m === 'territory_speed' ? course.data?.course_version_id ?? null : null });
      sessionId = s.sessionId;
      await startRun(s.sessionId, { startCaptureNow: captureNow, startSpeedNow: true });
      router.replace('/run/active');
    } catch (e) {
      if (sessionId) await discardRun(sessionId).catch(() => {});
      if (m !== 'private' && e instanceof ApiError && e.code === 'network') {
        Alert.alert('Competition needs a connection to start', 'A competitive run needs an online ticket before it starts. You can record privately now; it will not claim land or titles.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Record privately', onPress: () => void start('private') }
        ]);
      } else setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (inProgress) {
    return (
      <Screen>
        <TopBar title="Record" showSocial={false} />
        <Card tone="violet">
          <Icon name="record" color="#FFFFFF" size={28} />
          <Txt variant="display" style={{ fontSize: 34, lineHeight: 38 }}>A run is in progress</Txt>
          <Txt color="textMuted">Return to it to pause, finish or review any interruption.</Txt>
          <Button label="Open current run" arrow onPress={() => router.push('/run/active')} />
        </Card>
      </Screen>
    );
  }

  const modes: { value: RunMode; title: string; body: string; icon: IconName }[] = [
    { value: 'private', title: 'Private', body: 'Just for your history', icon: 'lock' },
    { value: 'territory', title: 'Territory', body: 'Close a loop, claim land', icon: 'hexagon' },
    { value: 'speed', title: 'Speed', body: 'Race a route title', icon: 'stopwatch' },
    { value: 'territory_speed', title: 'Both', body: 'Land and a title', icon: 'bolt' }
  ];
  const gpsLabel = BROWSER ? 'Phone app only' : gps.state === 'good' ? 'GPS good' : gps.state === 'weak' ? 'GPS weak' : gps.state === 'off' ? 'Location off' : 'Finding GPS…';
  const startLabel = mode === 'private' ? 'Start private run' : 'Start run';

  return (
    <Screen>
      <TopBar title="Record" showSocial={false} />
      <OfflineBanner />
      <View style={[styles.go, { backgroundColor: '#16171C' }]}>
        <Txt variant="display" style={{ color: '#FFFFFF', textAlign: 'center' }}>{'READY?'}</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
          <View style={[styles.pill, { backgroundColor: 'rgba(255,255,255,0.1)' }]} accessible accessibilityLabel={`${gpsLabel}${gps.accuracy != null ? `, about plus or minus ${Math.round(gps.accuracy)} metres` : ''}`}>
            <View style={[styles.dot, { backgroundColor: BROWSER ? '#8A8F9E' : gps.state === 'good' ? '#5CC86A' : gps.state === 'weak' ? '#F5B841' : gps.state === 'off' ? '#FF7B7B' : '#A3A7B5' }]} />
            <Txt variant="label" style={{ color: '#FFFFFF' }}>{gps.accuracy != null && !BROWSER ? `${gpsLabel} · ±${Math.round(gps.accuracy)} m` : gpsLabel}</Txt>
          </View>
          <View style={[styles.pill, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
            <Icon name={modes.find((m) => m.value === mode)!.icon} color="#FFFFFF" size={16} />
            <Txt variant="label" style={{ color: '#FFFFFF' }}>{modes.find((m) => m.value === mode)!.title}</Txt>
          </View>
        </View>
        <GoButton accessibilityLabel={startLabel} onPress={() => void start()} busy={busy} disabled={blockers.length > 0} />
        <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.72)', textAlign: 'center' }}>Open sky gives the best loop closure.</Txt>
      </View>
      {blockers.map((b) => (
        <Banner key={b} tone="warning" text={b} />
      ))}
      {error ? <Banner tone="danger" text={error} /> : null}
      {blockers.length && mode !== 'private' && !BROWSER ? <Button variant="secondary" icon="lock" label="Record privately instead" onPress={() => void start('private')} /> : null}
      <View style={{ gap: spacing.md }}>
        <Txt variant="headline">Run mode</Txt>
        <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Run mode">
          {modes.map((m) => {
            const selected = m.value === mode;
            return (
              <PressableScale
                key={m.value}
                onPress={() => setMode(m.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${m.title}. ${m.body}`}
                style={[styles.mode, { backgroundColor: selected ? p.primarySoft : p.surface, borderColor: selected ? p.primary : 'transparent' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Icon name={m.icon} color={selected ? p.primary : p.textMuted} size={24} />
                  {selected ? <Icon name="check" color={p.primary} size={20} strokeWidth={2.6} /> : null}
                </View>
                <Txt variant="heading" style={selected ? { color: p.onPrimarySoft } : undefined}>{m.title}</Txt>
                <Txt variant="caption">{m.body}</Txt>
              </PressableScale>
            );
          })}
        </View>
      </View>
      <Card accessibilityLabel="Mode details">
        {mode === 'private' ? <Txt>Private runs are for your own history. They never claim land or titles and are visible only to you.</Txt> : null}
        {wantsTerritory ? (
          <>
            <Txt>Territory: start a loop capture, run any loop and finish within {TERRITORY_RULES.closureMaxGapMeters.value} m of where the capture started. Loops of {fmtDistance(TERRITORY_RULES.minLoopLengthMeters.value, units, 0)}–{fmtDistance(TERRITORY_RULES.maxLoopLengthMeters.value, units, 0)} count. Travel before the capture stays private.</Txt>
            <Toggle label="Start loop capture when the run starts" description="Turn off to jog to your loop first and start the capture later." value={captureNow} onChange={setCaptureNow} />
          </>
        ) : null}
        {wantsSpeed ? (
          <>
            <Txt>Speed: run the chosen route in its direction through the start gate, checkpoints and finish gate. Timing starts at the start gate.</Txt>
            {courseId ? (
              course.isLoading ? <Txt variant="caption">Loading route…</Txt> : course.data ? (
                <Row icon="route" title={course.data.name} subtitle={fmtDistance(course.data.length_m, units)} onPress={() => router.push('/routes')} />
              ) : <Txt variant="caption">Route not found.</Txt>
            ) : (
              <Button variant="secondary" icon="route" label="Choose a route" onPress={() => router.push('/routes')} />
            )}
          </>
        ) : null}
        {mode !== 'private' && competition ? <Txt variant="caption">Competition: {competition.name}{season ? ` · season ${season.number}` : ''}. Results are checked on the server after upload; anything shown during the run is only a preview.</Txt> : null}
      </Card>
      <ArrowLink label="How loops and titles work" onPress={() => router.push('/help')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  go: { borderRadius: 28, paddingTop: spacing.xxl, paddingBottom: spacing.xl, paddingHorizontal: spacing.xl, alignItems: 'center', gap: spacing.sm, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 32, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  mode: { flexBasis: '46%', flexGrow: 1, minHeight: 112, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 2 }
});
