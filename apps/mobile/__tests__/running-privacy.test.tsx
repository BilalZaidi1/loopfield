/**
 * What leaves the phone while the running features are used. Analytics and error reports must never carry a
 * position (or, for the health features, a health value); positions go only to the server calls whose job is
 * to carry them: a live-link push, a planned route and path following. Training numbers (efforts, loads,
 * predictions) and the heart rate behind them never leave the phone at all.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { destination, emptyStore, racePredictions, runEffort, trainingLoad, zonesFromMaxHr, type HealthStore, type LatLng, type QuantitySample } from '@loopfield/core';
import { savePlannedRoute, snapLeg } from '@/features/plan/api';
import { createLiveLink, endLiveLink } from '@/features/live/api';
import { saveSharePeople } from '@/features/friends/api';
import { HighlightsCard } from '@/features/results/HighlightsCard';
import { buildTrainingRuns } from '@/health/training';
import { attachCheckins, endRunningNow, pingRunningNow, _resetCheckinsForTests } from '@/recording/checkins';
import { attachFollow, checkFollow, _resetFollowForTests } from '@/recording/follow';
import { attachLiveShare, pushLive, startFriendsShare, stopFriendsShare, stopLiveShare, _resetLivePushForTests } from '@/recording/livePush';
import TrainingScreen from '../app/(app)/health/training';
import { captureAnalytics, captureConsole, payloads, problems, resetPayloads, type Payload } from './helpers/payloadCapture';
import { fix, resetDb, samples } from './helpers/recordingDbStub';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
jest.mock('@/lib/analytics', () => ({ track: (e: string, p: Record<string, unknown>) => require('./helpers/payloadCapture').captureAnalytics(e, p) }));
jest.mock('@/lib/api', () => {
  const capture = require('./helpers/payloadCapture');
  return {
    ...jest.requireActual('@/lib/api'),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      capture.captureRequest(`rpc:${fn}`, args);
      return mockResults[fn] ?? null;
    }),
    callFunction: jest.fn(async (path: string, body: Record<string, unknown>) => {
      capture.captureRequest(path, body);
      return { snapped: false, reason: 'unavailable' };
    })
  };
});
jest.mock('@/lib/supabase', () => {
  const capture = require('./helpers/payloadCapture');
  const row = { id: 'r1', name: 'River loop', path: 'abc', distance_m: 1200, point_count: 3, is_loop: false, snapped: false, created_at: 'now', updated_at: 'now' };
  // Reads resolve to the table's rows; writes are recorded as payloads.
  const chain = (table: string) => {
    const q: Record<string, unknown> = {
      insert: (body: unknown) => (capture.captureRequest(`${table}.insert`, body), q),
      update: (body: unknown) => (capture.captureRequest(`${table}.update`, body), q),
      delete: () => q, eq: () => q, select: () => q, gte: () => q, is: () => q, order: () => q, limit: () => q,
      single: () => Promise.resolve({ data: row, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: table === 'activities' ? mockActivities : [row], error: null }).then(ok, bad)
    };
    return q;
  };
  return { supabase: () => ({ from: chain }) };
});
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/cues', () => ({ emitCue: jest.fn() }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })), scheduleNotificationAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null }, useIsFocused: () => true, useLocalSearchParams: () => ({}) }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: 'me', settings: { friends_live_mode: 'all', running_now_counted: true } }), useUnits: () => 'metric' }));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  return { ...actual, useAppConfig: () => ({ settings: actual.parseAppConfig({}), loaded: true, error: null }) };
});
jest.mock('@/health/useHealth', () => ({
  useHealthStore: () => mockHealth.store,
  quantities: (store: HealthStore, type: string) => [...store.quantity.values()].filter((q) => q.type === type),
  deviceOffsetMin: () => 0
}));
jest.mock('@/health/cache', () => ({ getZoneConfig: () => mockHealth.zones, getGoals: () => ({ weeklyRuns: null, weeklyDistanceM: null }) }));
jest.mock('@/features/results/useActivity', () => ({ useActivityDetail: () => ({ data: null }) }));

const mockResults: Record<string, unknown> = {};
const mockActivities: Record<string, unknown>[] = [];
const mockHealth: { store: HealthStore; zones: ReturnType<typeof zonesFromMaxHr> | null } = { store: emptyStore(), zones: null };
const start: LatLng = { lat: 24.8607, lng: 67.0011 };
const along = (m: number, north = 0) => destination(destination(start, m, 90), north, 0);
const route = Array.from({ length: 11 }, (_, i) => along(i * 100));
const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
/** The calls whose job is to carry a position. */
const carriesPositions = (p: Payload) => ['rpc:live_push', 'planned_routes.insert', 'planned_routes.update', 'route-snap'].includes(p.name);

let restoreConsole: () => void = () => {};
beforeEach(() => {
  resetPayloads();
  resetDb();
  _resetFollowForTests();
  _resetLivePushForTests();
  _resetCheckinsForTests();
  for (const k of Object.keys(mockResults)) delete mockResults[k];
  mockActivities.length = 0;
  mockHealth.store = emptyStore();
  mockHealth.zones = null;
  restoreConsole = captureConsole();
});
afterEach(() => restoreConsole());

describe('payloads from the running features', () => {
  it('sends positions only where a route or a live link needs them (stage 1)', async () => {
    // Planning: saving a route and following paths send the line to our server, nowhere else.
    await savePlannedRoute({ name: 'River loop', path: route, snapped: false });
    await snapLeg(route[0]!, route[3]!);

    // A live link: created, shared positions, ended.
    mockResults.live_link_create = { token: 'tok_privacy_abcdefghijk', kind: 'run', created: true };
    mockResults.live_push = { ok: true, every_seconds: 30 };
    const link = await createLiveLink('run', false);
    attachLiveShare('s1', link.token, 'run', 30);
    samples.s1 = Array.from({ length: 20 }, (_, k) => fix(along(k * 25), T0 + k * 3000));
    await pushLive('s1', { force: true }, 200_000);

    // Following, with an off-route alert, and a failure whose message holds coordinates.
    attachFollow('s1', { kind: 'planned', refId: 'r1', name: 'River loop', path: route }, { offRouteM: 40, offRouteSeconds: 15 });
    samples.s1.push(...Array.from({ length: 12 }, (_, k) => fix(along(500, 90), T0 + 61_000 + k * 2000)));
    await checkFollow('s1', 10_000);
    Object.defineProperty(samples, 's1', { configurable: true, get: () => { throw new Error('bad fix at 24.86071, 67.00112'); } });
    await checkFollow('s1', 20_000);
    delete samples.s1;

    await stopLiveShare('s1');
    await endLiveLink(link.token, 'run');

    expect(problems({ allowNetwork: carriesPositions })).toEqual([]);
    // The check itself sees positions: without the allowance, the push, the route and path following are flagged.
    const flagged = new Set(problems().map((x) => x.split(':')[0]));
    expect([...flagged].sort()).toEqual(['network planned_routes.insert', 'network route-snap', 'network rpc'].sort());
    expect(payloads.filter((p) => p.channel === 'analytics').map((p) => p.name)).toEqual(expect.arrayContaining(['route_planned', 'live_link']));
    expect(payloads.some((p) => p.channel === 'error' && /route check failed/.test(String(p.body)))).toBe(true);
  });

  it('keeps training numbers on the phone, and check-ins and friends sharing send no position (stage 2)', async () => {
    jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    jest.setSystemTime(new Date(2026, 10, 20, 12, 0));
    try {
      // Today's run with a watch's heart rate, and runs rated by feel before it: every training number is real.
      const iso = (t: number) => new Date(t).toISOString();
      const today = Date.now() - 3 * 3_600_000;
      mockActivities.push({ id: 'today', started_at: iso(today), ended_at: iso(today + 45 * 60_000), distance_m: 10_000, moving_ms: 45 * 60_000, elapsed_ms: 45 * 60_000, perceived_effort: null, splits: null });
      for (let i = 1; i <= 12; i++) {
        const t = today - i * 3 * DAY;
        mockActivities.push({ id: `e${i}`, started_at: iso(t), ended_at: iso(t + 40 * 60_000), distance_m: 8000, moving_ms: 40 * 60_000, elapsed_ms: 40 * 60_000, perceived_effort: 6, splits: null });
      }
      mockHealth.zones = zonesFromMaxHr(190, 1);
      for (let k = 0; k < 270; k++) {
        const s: QuantitySample = { id: `hr${k}`, type: 'heart_rate', value: 163, start: today + k * 10_000, end: today + k * 10_000, sourceId: 'watch', sourceKind: 'watch' } as QuantitySample;
        mockHealth.store.quantity.set(s.id, s);
      }

      // The numbers the screens show: what must not appear in anything sent.
      const runs = buildTrainingRuns(mockActivities as never, mockHealth.store, mockHealth.zones);
      const load = trainingLoad(runs, Date.now(), 0);
      const predictions = racePredictions(runs, Date.now());
      const healthValues = [163, ...runs.map((r) => runEffort(r).score), Math.round(load.long), Math.round(load.short), Math.round(load.balance), ...predictions.flatMap((p) => [p.low, p.high, Math.round(p.low), Math.round(p.high)])]
        .filter((v) => Math.abs(v) >= 10);
      // About 45 minutes in zone 4.
      expect(runEffort(runs.at(-1)!)).toEqual(expect.objectContaining({ basis: 'heart_rate', score: 179 }));
      expect(predictions.length).toBeGreaterThan(1);

      const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
      const view = await render(wrap(<TrainingScreen />));
      expect(await screen.findByText(String(Math.round(load.long)))).toBeTruthy();
      await fireEvent.press(screen.getByText('Show as a table'));
      await fireEvent.press(screen.getByText('Race predictions'));
      expect(screen.getAllByText(/^Based on your /).length).toBe(predictions.length);
      await view.unmount();
      await render(wrap(<HighlightsCard activityId="today" />));
      expect(await screen.findByText('Your longest run this month: 10.0 km.')).toBeTruthy();

      // Runners out right now: only the run's id, at the start and at the end.
      mockResults.running_now_ping = { ok: true, every_seconds: 300 };
      attachCheckins('s2', true);
      await pingRunningNow('s2', { force: true });
      await endRunningNow('s2');

      // Friends: choosing who sees runs, then a run shared with them and a live link at once, then stopped.
      await saveSharePeople(['friend-1', 'friend-2']);
      mockResults.friends_live_start = { ok: true, token: 'tok_friends_abcdefghijk', every_seconds: 30 };
      mockResults.live_push = { ok: true, every_seconds: 30, links: { tok_link_abcdefghijklmn: 'ok', tok_friends_abcdefghijk: 'ok' } };
      attachLiveShare('s2', 'tok_link_abcdefghijklmn', 'run', 30);
      expect(await startFriendsShare('s2', 'all')).toBe(true);
      samples.s2 = Array.from({ length: 10 }, (_, k) => fix(along(k * 30), T0 + k * 3000));
      await pushLive('s2', { force: true }, 300_000);
      await stopFriendsShare('s2');

      expect(problems({ allowNetwork: carriesPositions, health: true, healthValues })).toEqual([]);
      const sent = (name: string) => payloads.filter((p) => p.name === name).map((p) => p.body);
      expect(sent('rpc:running_now_ping')).toEqual([{ p_session: 's2' }]);
      expect(sent('rpc:running_now_end')).toEqual([{ p_session: 's2' }]);
      expect(sent('rpc:friends_live_start')).toEqual([{ p_session: 's2' }]);
      expect(sent('rpc:set_live_share_people')).toEqual([{ p_people: ['friend-1', 'friend-2'] }]);
      // One push serves both shares.
      expect(sent('rpc:live_push')).toEqual([expect.objectContaining({ p_session: 's2', p_tokens: expect.arrayContaining(['tok_link_abcdefghijklmn', 'tok_friends_abcdefghijk']) })]);
      expect(payloads.filter((p) => p.channel === 'analytics').map((p) => p.name)).toEqual(expect.arrayContaining(['training_viewed', 'run_summary', 'friends_live']));
      // Nothing about training was written anywhere.
      expect(payloads.filter((p) => p.channel === 'network' && /^(activities|health|training)/.test(p.name))).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops anything outside the event schema before it is sent', () => {
    captureAnalytics('route_planned', { action: 'created', distance_bucket: '5-10km', loop: true, snapped: true, lat: 24.8607123, path: 'abc' } as never);
    captureAnalytics('training_viewed', { part: 'load', effort: 180, load: 42, prediction_s: 2700 } as never);
    captureAnalytics('run_summary', { action: 'shown', lines: '2', top: 'longest', text: 'Your longest run this month: 10.0 km.' } as never);
    expect(problems({ health: true, healthValues: [180, 42, 2700] })).toEqual([]);
    expect(payloads.map((p) => p.body)).toEqual([
      { action: 'created', distance_bucket: '5-10km', loop: true, snapped: true },
      { part: 'load' },
      { action: 'shown', lines: '2', top: 'longest' }
    ]);
  });
});
