import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { ApiError, friendlyError, rpc } from '@/lib/api';
import { isExpoGo } from '@/lib/runtime';
import { useTerritoryRules } from '@/lib/gameRules';
import type { IconName } from '@/components/icons';
import type { RunMode } from '@/recording/db';
import { createSession, discardRun, ensureLocationPermission, startRun } from '@/recording/recorder';
import { useCompetition, type Competition, type Season } from '@/state/competition';
import { useEvents, type EventRow } from '@/features/events/api';
import { useSession } from '@/state/session';

/** Runs are recorded only in the phone app; the browser shows the recorder for reference. */
export const BROWSER = Platform.OS === 'web';

export type Gps = { state: 'checking' | 'off' | 'weak' | 'good'; accuracy: number | null };

export const RUN_MODES: { value: RunMode; title: string; body: string; icon: IconName }[] = [
  { value: 'private', title: 'Private', body: 'Just for your history. It never claims land or titles and only you see it.', icon: 'lock' },
  { value: 'territory', title: 'Territory', body: 'Close a loop to claim the land inside it.', icon: 'hexagon' },
  { value: 'speed', title: 'Speed', body: 'Race a route for its title.', icon: 'stopwatch' },
  { value: 'territory_speed', title: 'Both', body: 'Claim land and race a route title in one run.', icon: 'bolt' }
];

/** GPS readiness before the run (not the recording itself): good, weak, off or still looking. */
export function useGpsReadiness(enabled: boolean): Gps & { recheck: () => void } {
  const rules = useTerritoryRules();
  const rulesRef = useRef(rules);
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);
  const [gps, setGps] = useState<Gps>({ state: 'checking', accuracy: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || BROWSER) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setGps({ state: 'off', accuracy: null });
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 }, (loc) => {
        if (cancelled) return;
        const acc = loc.coords.accuracy ?? null;
        setGps({ state: acc != null && acc <= rulesRef.current.closureEndpointMaxAccuracyMeters.value ? 'good' : 'weak', accuracy: acc });
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled, attempt]);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...gps, recheck };
}

export function gpsLabel(gps: Gps): string {
  if (BROWSER) return 'Phone app only';
  return gps.state === 'good' ? 'GPS good' : gps.state === 'weak' ? 'GPS weak' : gps.state === 'off' ? 'Location off' : 'Finding GPS…';
}

export function gpsColor(gps: Gps): string {
  if (BROWSER) return '#8A8F9E';
  return gps.state === 'good' ? '#2FB45A' : gps.state === 'weak' ? '#E8A317' : gps.state === 'off' ? '#E5484D' : '#A3A7B5';
}

/** Where a competitive run counts, in one sentence (the server decides the result after upload). */
export function countsFor(c: Competition, season: Season | null, territory: boolean, landEvents: EventRow[]): string {
  if (c.kind === 'club') return `Counts in ${c.name} only: club races stay inside the club.`;
  const race = season ? `the season ${season.number} race` : 'the season race';
  if (!territory) return `Route titles count in ${race}.`;
  const events = landEvents.length ? (landEvents.length === 1 ? ` and in ${landEvents[0]!.name}` : ` and in ${landEvents.length} events you joined`) : '';
  return `A loop counts on the all-time map, in ${race}${events}.`;
}

interface CourseOption {
  course_id: string;
  course_version_id: string;
  name: string;
  status: string;
  length_m: number;
}

/**
 * Everything the recorder needs before a run: the run type, the loop-capture choice, the chosen speed
 * route, what would block a competitive run, and `start`, which creates and starts the recording session
 * (the recorder screen then switches to the live view on its own).
 */
export function usePreRun(initialCourse?: string | null) {
  const { userId, settings } = useSession();
  const { competition, season } = useCompetition();
  const events = useEvents('current');
  const [mode, setMode] = useState<RunMode>(initialCourse ? 'speed' : 'private');
  const [captureNow, setCaptureNow] = useState(true);
  const [courseId, setCourseId] = useState<string | null>(initialCourse ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A route chosen while the recorder is open arrives as a new parameter: race it (keeping territory if on).
  const [seenCourse, setSeenCourse] = useState(initialCourse ?? null);
  if ((initialCourse ?? null) !== seenCourse) {
    setSeenCourse(initialCourse ?? null);
    if (initialCourse) {
      setCourseId(initialCourse);
      setMode((m) => (m === 'territory' || m === 'territory_speed' ? 'territory_speed' : 'speed'));
    }
  }

  const course = useQuery({
    queryKey: ['course-option', courseId, competition?.id, season?.id],
    enabled: Boolean(courseId && competition && season),
    queryFn: () => rpc<CourseOption | null>('speed_route_detail', { p_course: courseId, p_competition: competition!.id, p_season: season!.id })
  });

  const wantsTerritory = mode === 'territory' || mode === 'territory_speed';
  const wantsSpeed = mode === 'speed' || mode === 'territory_speed';
  const joinedEvents = (events.data ?? []).filter((e) => e.joined && e.phase === 'live');
  const landEvents = joinedEvents.filter((e) => e.event_type === 'territory' && e.region_id === competition?.region_id);
  const distanceEvents = joinedEvents.filter((e) => e.event_type === 'distance');
  const blockers: { text: string; settings?: boolean; route?: boolean }[] = [];
  if (BROWSER) blockers.push({ text: 'Runs are recorded in the Loopfield phone app. The browser version shows everything else.' });
  if (mode !== 'private') {
    if (settings?.full_private_mode) blockers.push({ text: 'Full private mode is on, so competitive runs are unavailable.', settings: true });
    if (!competition || !season) blockers.push({ text: 'There is no active season here yet.' });
    if (wantsTerritory && !settings?.territory_competition_enabled) blockers.push({ text: 'Turn on territory in Privacy settings to claim land.', settings: true });
    if (wantsSpeed && !settings?.speed_competition_enabled) blockers.push({ text: 'Turn on route titles in Privacy settings to race routes.', settings: true });
    if (wantsSpeed && !courseId) blockers.push({ text: 'Choose a route to race for its title.', route: true });
    if (wantsSpeed && course.data && course.data.status !== 'active') blockers.push({ text: 'This route is not accepting attempts right now.', route: true });
  }
  const counts = mode !== 'private' && competition ? countsFor(competition, season, wantsTerritory, landEvents) : null;

  const start = async (forceMode?: RunMode): Promise<boolean> => {
    const m = forceMode ?? mode;
    setBusy(true);
    setError(null);
    let sessionId: string | null = null;
    try {
      const perm = await ensureLocationPermission();
      if (perm === 'denied' || perm === 'services_disabled') {
        setError(perm === 'services_disabled' ? 'Location services are off on this phone.' : 'Location permission is needed to record a run.');
        return false;
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
        if (!proceed) return false;
      }
      const s = await createSession({ userId: userId!, mode: m, competitionId: m === 'private' ? null : competition?.id ?? null, courseVersionId: m === 'speed' || m === 'territory_speed' ? course.data?.course_version_id ?? null : null });
      sessionId = s.sessionId;
      await startRun(s.sessionId, { startCaptureNow: captureNow, startSpeedNow: true });
      return true;
    } catch (e) {
      if (sessionId) await discardRun(sessionId).catch(() => {});
      if (m !== 'private' && e instanceof ApiError && e.code === 'network') {
        Alert.alert('Competition needs a connection to start', 'A competitive run needs an online ticket before it starts. You can record privately now; it will not claim land or titles.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Record privately', onPress: () => void start('private') }
        ]);
      } else setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { mode, setMode, captureNow, setCaptureNow, courseId, course, wantsTerritory, wantsSpeed, distanceEvents, blockers, counts, busy, error, start };
}

export type PreRun = ReturnType<typeof usePreRun>;
