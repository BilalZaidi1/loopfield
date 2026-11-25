/**
 * Running features, second stage: training (effort, loads, predictions) on the phone, run highlights, runners
 * out right now (check-ins and the counts line), and live runs with friends (starting and stopping the share,
 * the settings, the Record-tab reminder and the friend card text). The server is replaced at the `rpc`
 * boundary and the phone's SQLite by the in-memory stand-in.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { emptyStore, zonesFromMaxHr, type HealthStore, type QuantitySample } from '@loopfield/core';
import { parseAppConfig, PAUSED_TEXT } from '@/lib/appConfig';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { _resetCheckinsForTests, attachCheckins, endRunningNow, pingRunningNow, CHECKIN_EVERY_MS } from '@/recording/checkins';
import { _resetLivePushForTests, attachLiveShare, friendsShareFor, liveShareFor, startFriendsShare, stopFriendsShare } from '@/recording/livePush';
import { runningNowLine, RunningNowLine, type RunningNowCounts } from '@/features/runningNow/RunningNow';
import { friendStatus } from '@/features/friends/api';
import { FriendsLiveSettings } from '@/features/friends/FriendsLiveSettings';
import { FriendsLivePicker } from '@/features/run/PreRunExtras';
import type { PreRun } from '@/features/run/usePreRun';
import { buildTrainingRuns, effortText, zonesFor, type TrainingActivity } from '@/health/training';
import { balanceWord, weekRows } from '@/features/training/text';
import { describeDay, LoadChart } from '@/features/training/LoadChart';
import { HighlightsCard } from '@/features/results/HighlightsCard';
import TrainingScreen from '../app/(app)/health/training';
import { resetDb } from './helpers/recordingDbStub';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  rpc: jest.fn(async (fn: string, args?: Record<string, unknown>) => mockServer.rpc(fn, args ?? {}))
}));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  return { ...actual, useAppConfig: () => ({ settings: actual.parseAppConfig(mockConfig.raw), loaded: true, error: null }) };
});
jest.mock('@/state/session', () => ({
  useSession: () => ({ userId: 'me', session: null, profile: { avatar_path: null }, settings: mockSession.settings, refresh: jest.fn(async () => {}) }),
  useUnits: () => 'metric'
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useIsFocused: () => true,
  useLocalSearchParams: () => ({})
}));
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => {
      const q = {
        select: () => q, gte: () => q, is: () => q, eq: () => q, order: () => q,
        limit: () => Promise.resolve({ data: mockTables[table] ?? [], error: null }),
        update: (body: unknown) => { mockUpdates.push({ table, body }); return { eq: () => Promise.resolve({ error: null }) }; }
      };
      return q;
    }
  })
}));
jest.mock('@/health/useHealth', () => ({
  useHealthStore: () => mockHealth.store,
  quantities: (store: HealthStore, type: string) => [...store.quantity.values()].filter((q) => q.type === type),
  deviceOffsetMin: () => 0
}));
jest.mock('@/health/cache', () => ({ getZoneConfig: () => mockHealth.zones, getGoals: () => ({ weeklyRuns: null, weeklyDistanceM: null }) }));
jest.mock('@/features/results/useActivity', () => ({ useActivityDetail: () => ({ data: mockDetail.data }) }));

const mockConfig: { raw: Record<string, unknown> } = { raw: {} };
const mockSession: { settings: Record<string, unknown> | null } = { settings: { friends_live_mode: 'off', running_now_counted: true } };
const mockTables: Record<string, unknown[]> = {};
const mockUpdates: { table: string; body: unknown }[] = [];
const mockHealth: { store: HealthStore; zones: ReturnType<typeof zonesFromMaxHr> | null } = { store: emptyStore(), zones: null };
const mockDetail: { data: unknown } = { data: null };
const mockServer = {
  results: {} as Record<string, unknown>,
  rpc(fn: string, _args: Record<string, unknown>) {
    return fn in this.results ? this.results[fn] : null;
  }
};

const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
const DAY = 86_400_000;
const NOW = Date.now();

beforeEach(async () => {
  mockConfig.raw = {};
  mockSession.settings = { friends_live_mode: 'off', running_now_counted: true };
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockUpdates.length = 0;
  mockHealth.store = emptyStore();
  mockHealth.zones = null;
  mockDetail.data = null;
  mockServer.results = {};
  (rpc as jest.Mock).mockClear();
  (track as jest.Mock).mockClear();
  resetDb();
  _resetCheckinsForTests();
  _resetLivePushForTests();
  await AsyncStorage.clear();
});

describe('settings for the second stage', () => {
  it('turns every new switch on by default and never shows a count under five', () => {
    const s = parseAppConfig(null);
    expect([s.enabled.run_summaries_enabled, s.enabled.running_now_enabled, s.enabled.friends_live_enabled]).toEqual([true, true, true]);
    expect(parseAppConfig({ running_now_min_count: 3 }).runningNowMinCount).toBe(5);
    expect(parseAppConfig({ friends_live_max_people: 900 }).friendsLiveMaxPeople).toBe(200);
    expect(PAUSED_TEXT.friends_live_enabled).toMatch(/Nothing is shared/);
  });
});

describe('runners out right now on the phone', () => {
  it('checks in at the start, every five minutes, and stops at the end, with nothing but the run', async () => {
    attachCheckins('run1', true);
    mockServer.results.running_now_ping = { ok: true, every_seconds: 300 };
    await pingRunningNow('run1', { force: true }, 1_000_000);
    expect(rpc).toHaveBeenLastCalledWith('running_now_ping', { p_session: 'run1' });
    await pingRunningNow('run1', {}, 1_000_000 + CHECKIN_EVERY_MS - 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    await pingRunningNow('run1', {}, 1_000_000 + CHECKIN_EVERY_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    await endRunningNow('run1');
    expect(rpc).toHaveBeenLastCalledWith('running_now_end', { p_session: 'run1' });
    await pingRunningNow('run1', { force: true }, 9_000_000);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('sends nothing for a runner who opted out, and stops when the server says so', async () => {
    attachCheckins('quiet', false);
    await pingRunningNow('quiet', { force: true });
    await endRunningNow('quiet');
    expect(rpc).not.toHaveBeenCalled();
    attachCheckins('elsewhere', true);
    mockServer.results.running_now_ping = { ok: false, reason: 'opted_out' };
    await pingRunningNow('elsewhere', { force: true }, 1_000_000);
    await pingRunningNow('elsewhere', { force: true }, 2_000_000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('words the line by city, then country, then everywhere, and hides it under five', () => {
    const c = (city: number | null, country: number | null, everywhere: number | null): RunningNowCounts => ({ enabled: true, min_count: 5, city: { name: 'Karachi', count: city }, country: { code: 'PK', count: country }, everywhere });
    expect(runningNowLine(c(23, 41, 900))).toBe('23 Karachi runners out right now');
    expect(runningNowLine(c(null, 41, 900))).toBe('41 runners out right now in Pakistan');
    expect(runningNowLine(c(null, null, 900))).toBe('900 runners out right now');
    expect(runningNowLine(c(null, null, null))).toBeNull();
    expect(runningNowLine({ enabled: false })).toBeNull();
  });

  it('shows the line and opens the three counts', async () => {
    mockServer.results.running_now_counts = { enabled: true, min_count: 5, city: { name: 'Karachi', count: 23 }, country: { code: 'PK', count: 41 }, everywhere: null };
    await render(wrap(<RunningNowLine />));
    await fireEvent.press(await screen.findByText('23 Karachi runners out right now'));
    expect(screen.getByText('Fewer than 5')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('running_now', { action: 'shown' });
    expect(track).toHaveBeenCalledWith('running_now', { action: 'opened' });
  });
});

describe('live runs with friends on the phone', () => {
  it('starts the share with the run and pushes to it, and stops it without touching a live link', async () => {
    mockServer.results.friends_live_start = { ok: true, token: 'tok_friends_abcdefghijk', every_seconds: 30 };
    attachLiveShare('r1', 'tok_link_abcdefghijklmn', 'run', 30);
    expect(await startFriendsShare('r1', 'chosen')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('friends_live_start', { p_session: 'r1' });
    expect(friendsShareFor('r1')!.token).toBe('tok_friends_abcdefghijk');
    expect(track).toHaveBeenCalledWith('friends_live', { action: 'run_shared', audience: 'chosen' });
    await stopFriendsShare('r1');
    expect(rpc).toHaveBeenLastCalledWith('live_link_end', { p_token: 'tok_friends_abcdefghijk' });
    expect(friendsShareFor('r1')!.ended).toBe(1);
    expect(liveShareFor('r1')!.ended).toBe(0);
  });

  it('shares nothing when sharing is off on the server', async () => {
    mockServer.results.friends_live_start = { ok: false, reason: 'off' };
    expect(await startFriendsShare('r2', 'all')).toBe(false);
    expect(friendsShareFor('r2')).toBeNull();
  });

  it('turns sharing on with friends I choose, and says plainly what friends see', async () => {
    await render(wrap(<FriendsLiveSettings onCountChange={() => {}} />));
    expect(screen.getByText('Off. Friends who share with you still appear on your map.')).toBeTruthy();
    await fireEvent(screen.getByRole('switch', { name: 'Share my live runs with friends' }), 'valueChange', true);
    expect(mockUpdates).toEqual([{ table: 'user_settings', body: { friends_live_mode: 'chosen' } }]);
    expect(track).toHaveBeenCalledWith('friends_live', { action: 'turned_on', audience: 'chosen' });
  });

  it('reminds the runner before GO, with Not this run', async () => {
    const setSkipFriends = jest.fn();
    await render(<FriendsLivePicker pre={{ friendsMode: 'all', skipFriends: false, setSkipFriends } as unknown as PreRun} />);
    expect(screen.getByText(/Friends can see this run live/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Not this run'));
    expect(setSkipFriends).toHaveBeenCalledWith(true);
    const off = await render(<FriendsLivePicker pre={{ friendsMode: 'off', skipFriends: false, setSkipFriends } as unknown as PreRun} />);
    expect(off.toJSON()).toBeNull();
  });

  it('words a friend’s card: how long, when last heard, and protected areas', () => {
    const f = { state: 'running' as const, started_at: new Date(NOW - 32 * 60_000).toISOString(), last_update: new Date(NOW - 20_000).toISOString(), hidden: false };
    expect(friendStatus(f, NOW)).toBe('Running for 32 min · updated 20 s ago');
    expect(friendStatus({ ...f, hidden: true }, NOW)).toBe('Running for 32 min · in one of their protected areas');
    expect(friendStatus({ ...f, state: 'paused', last_update: new Date(NOW - 5 * 60_000).toISOString() }, NOW)).toBe('Paused · last update 5 min ago');
  });
});

describe('training on the phone', () => {
  const hrSamples = (start: number, minutes: number, bpm: number): QuantitySample[] =>
    Array.from({ length: minutes * 6 }, (_, i) => ({ id: `hr${start}-${i}`, type: 'heart_rate', value: bpm, start: start + i * 10_000, end: start + i * 10_000, sourceId: 'watch', sourceKind: 'watch' }) as QuantitySample);
  const activity = (id: string, daysAgo: number, over: Partial<TrainingActivity> = {}): TrainingActivity => {
    const start = NOW - daysAgo * DAY;
    return { id, started_at: new Date(start).toISOString(), ended_at: new Date(start + 40 * 60_000).toISOString(), distance_m: 8000, moving_ms: 40 * 60_000, elapsed_ms: 40 * 60_000, perceived_effort: null, ...over };
  };

  it('uses heart-rate zones when the heart rate covers the run, and adds imported runs once', () => {
    const zones = zonesFromMaxHr(190, 1);
    const run = activity('own', 2);
    const start = Date.parse(run.started_at);
    const store = emptyStore();
    for (const s of hrSamples(start, 40, 160)) store.quantity.set(s.id, s);
    store.workout.set('w1', { id: 'w1', activity: 'running', start: NOW - 5 * DAY, end: NOW - 5 * DAY + 30 * 60_000, sourceId: 'watch', sourceKind: 'watch', distanceM: 6000 });
    // The same run exported from this app is not counted twice.
    store.workout.set('w2', { id: 'w2', activity: 'running', start, end: start + 40 * 60_000, sourceId: 'watch', sourceKind: 'watch', distanceM: 8000, externalId: 'own' });
    const runs = buildTrainingRuns([run], store, zones);
    expect(runs.map((r) => [r.id, r.imported])).toEqual([['hs:w1', true], ['own', false]]);
    expect(runs.find((r) => r.id === 'own')!.zoneMs![3]).toBeGreaterThan(30 * 60_000);
    expect(zonesFor(hrSamples(start, 10, 150), start, start + 40 * 60_000, zones)).toBeNull();
    expect(zonesFor(hrSamples(start, 40, 150), start, start + 40 * 60_000, null)).toBeNull();
  });

  it('says how each effort was worked out and how it compares', () => {
    expect(effortText({ score: 142, basis: 'heart_rate', word: 'harder' })).toEqual({ value: '142 · harder than usual', detail: 'From your heart-rate zones' });
    expect(effortText({ score: 100, basis: 'assumed', word: null }).detail).toMatch(/moderate run/);
    expect(balanceWord(12)).toBe('Fresher than usual');
    expect(balanceWord(-12)).toBe('More tired than usual');
  });

  it('shows the loads, a table of the weeks and the predictions, with the medical line', async () => {
    mockTables.activities = Array.from({ length: 30 }, (_, i) => activity(`a${i}`, i * 3, { perceived_effort: 5, distance_m: i === 4 ? 10_000 : 8000 }));
    await render(wrap(<TrainingScreen />));
    expect(await screen.findByText('6-week load')).toBeTruthy();
    expect(screen.getByText(/For training, not medical advice/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('training_viewed', { part: 'load' });
    await fireEvent.press(screen.getByText('Show as a table'));
    // Each week is one row, read out whole by a screen reader.
    expect(screen.getAllByLabelText(/^Week of .+, Effort \d+, 6-week \d+, 7-day \d+, Balance -?\d+$/).length).toBeGreaterThan(10);
    await fireEvent.press(screen.getByText('Race predictions'));
    expect(screen.getByText(/^10K: /)).toBeTruthy();
    expect(screen.getAllByText(/^Based on your /).length).toBeGreaterThan(0);
    expect(track).toHaveBeenCalledWith('training_viewed', { part: 'predictions' });
  });

  it('hides everything when the back office suspends the training card', async () => {
    mockConfig.raw = { disabled_health_cards: ['training'] };
    await render(wrap(<TrainingScreen />));
    expect(screen.getByText('Training is paused for now')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads out the day that was tapped on the chart, and clears it on a second tap', async () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(10 + i).padStart(2, '0')}`, effort: i === 5 ? 120 : 0, long: 40 + i, short: 30 + i * 2, balance: 10 - i }));
    await render(<LoadChart days={days} label="Training load" />);
    await fireEvent(screen.getByLabelText('Training load'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 190 } } });
    const touch = screen.getByTestId('load-chart-touch', { includeHiddenElements: true });
    // 300 wide: the plot runs from 40 to 248, so day 5 of 0–9 sits at about 156.
    await fireEvent.press(touch, { nativeEvent: { locationX: 156 } });
    expect(screen.getByText(describeDay(days[5]!))).toBeTruthy();
    expect(describeDay(days[5]!)).toMatch(/6-week load 45, 7-day load 40, effort that day 120\.$/);
    await fireEvent.press(touch, { nativeEvent: { locationX: 156 } });
    expect(screen.getByText('Tap the chart to see a day.')).toBeTruthy();
    await fireEvent.press(touch, { nativeEvent: { locationX: 2000 } });
    expect(screen.getByText(describeDay(days[9]!))).toBeTruthy();
  });

  it('builds one table row per week, newest first', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(9 + i).padStart(2, '0')}`, effort: i === 0 ? 100 : 0, long: i, short: i * 2, balance: -i }));
    const rows = weekRows(days);
    expect(rows).toHaveLength(2);
    expect(rows[1]![1]).toBe('100');
    expect(rows[0]!.slice(2)).toEqual(['13', '26', '-13']);
  });
});

describe('run highlights on the phone', () => {
  // Only the clock is pinned (to the middle of a month, so "this month" has room); timers stay real.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    jest.setSystemTime(new Date(2026, 10, 20, 12, 0));
  });
  afterEach(() => jest.useRealTimers());

  it('shows the same lines each time the run is opened, and can be hidden', async () => {
    const t = Date.now() - 3_600_000;
    mockTables.activities = [
      { id: 'today', started_at: new Date(t).toISOString(), distance_m: 12_400, moving_ms: 70 * 60_000, elapsed_ms: 72 * 60_000, splits: null },
      { id: 'before', started_at: new Date(t - 2 * DAY).toISOString(), distance_m: 8000, moving_ms: 45 * 60_000, elapsed_ms: 45 * 60_000, splits: null }
    ];
    const first = await render(wrap(<HighlightsCard activityId="today" />));
    expect(await screen.findByText('Your longest run this month: 12.4 km.')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('run_summary', expect.objectContaining({ action: 'shown', top: 'longest' }));
    await first.unmount();
    (track as jest.Mock).mockClear();
    // Opened again later, with a longer run since: the lines are the ones first shown, and not counted again.
    mockTables.activities.unshift({ id: 'later', started_at: new Date(t + 30 * 60_000).toISOString(), distance_m: 20_000, moving_ms: 110 * 60_000, elapsed_ms: 110 * 60_000, splits: null });
    await render(wrap(<HighlightsCard activityId="today" />));
    expect(await screen.findByText('Your longest run this month: 12.4 km.')).toBeTruthy();
    expect(track).not.toHaveBeenCalledWith('run_summary', expect.objectContaining({ action: 'shown' }));
    await fireEvent.press(screen.getByText('Hide'));
    expect(screen.queryByText('Your longest run this month: 12.4 km.')).toBeNull();
    expect(track).toHaveBeenCalledWith('run_summary', expect.objectContaining({ action: 'hidden' }));
  });

  it('stays quiet while switched off', async () => {
    mockConfig.raw = { run_summaries_enabled: false };
    mockTables.activities = [{ id: 'today', started_at: new Date(NOW - 3_600_000).toISOString(), distance_m: 12_400, moving_ms: 70 * 60_000, elapsed_ms: 72 * 60_000, splits: null }];
    const view = await render(wrap(<HighlightsCard activityId="today" />));
    expect(view.toJSON()).toBeNull();
  });
});
