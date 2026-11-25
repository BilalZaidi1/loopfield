/**
 * Running features, first stage: following a route (planned, or the speed route being raced), the live link
 * (pushing positions, the sharing sheet and the public page), the route planner and the picture as the
 * position dot. The phone's SQLite is replaced by a small in-memory stand-in that understands the statements
 * these modules use; the server is replaced at the `rpc` / `callFunction` boundary.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Linking, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { latLngToCell } from 'h3-js';
import { destination, encodePolyline, haversineMeters, type LatLng } from '@loopfield/core';
import { parseAppConfig, PAUSED_TEXT } from '@/lib/appConfig';
import { emitCue } from '@/lib/cues';
import { callFunction, rpc } from '@/lib/api';
import { BACK_ON_ROUTE_TEXT, OFF_ROUTE_TEXT, _resetFollowForTests, attachFollow, checkFollow, followStatus, followSummary } from '@/recording/follow';
import { _resetLivePushForTests, attachLiveShare, liveShareFor, pendingLiveShare, pushLive, thinFixes } from '@/recording/livePush';
import { fmtElapsed, freshness, liveHeadline, mapsLink } from '@/features/live/pageText';
import { liveLinkExplainer, LiveShareSheet } from '@/features/live/LiveShare';
import { straightLegNote } from '@/features/plan/api';
import { planFromLine, usePlanner } from '@/features/plan/usePlanner';
import { estimateOfflineBytes, packBounds, sizeLabel } from '@/features/plan/offline';
import { loopCells, previewLand, previewText } from '@/features/plan/landPreview';
import { loadMarkerPreference, markerFileName, saveMarkerPreference } from '@/features/map/AvatarMarker';
import type { PublicLiveLink } from '@/features/live/api';
import LiveLinkPage from '../app/l/[token]';
import { fix, resetDb, samples } from './helpers/recordingDbStub';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })), scheduleNotificationAsync: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/cues', () => ({ emitCue: jest.fn() }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  rpc: jest.fn(async (fn: string, args?: Record<string, unknown>) => mockServer.rpc(fn, args ?? {})),
  callFunction: jest.fn(async (path: string, body: Record<string, unknown>) => mockServer.fn(path, body))
}));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  return { ...actual, useAppConfig: () => ({ settings: actual.parseAppConfig(mockConfig.raw), loaded: true, error: null }) };
});
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: 'me', session: null, profile: { avatar_path: null } }), useUnits: () => 'metric' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ token: mockPage.token })
}));
jest.mock('@/features/live/api', () => ({
  ...jest.requireActual('@/features/live/api'),
  usePublicLiveLink: () => mockPage.query,
  countLiveView: jest.fn(async () => {})
}));

const mockConfig: { raw: Record<string, unknown> } = { raw: {} };
const mockServer = {
  rpcResults: {} as Record<string, unknown>,
  fnResults: [] as unknown[],
  rpc(fn: string, _args: Record<string, unknown>) {
    return fn in this.rpcResults ? this.rpcResults[fn] : null;
  },
  fn(_path: string, _body: Record<string, unknown>) {
    return this.fnResults.length ? this.fnResults.shift() : { snapped: false, reason: 'error' };
  }
};
const mockPage: { token: string; query: { data: PublicLiveLink | null | undefined; isLoading: boolean; error: unknown; refetch: () => void } } = {
  token: 'abcdefghijklmnopqrstuv',
  query: { data: undefined, isLoading: true, error: null, refetch: () => {} }
};

const start: LatLng = { lat: 51.5, lng: -0.12 };
const along = (m: number, offsetNorthM = 0) => destination(destination(start, m, 90), offsetNorthM, 0);
const route = Array.from({ length: 11 }, (_, i) => along(i * 100)); // 1 km due east
const T0 = 1_800_000_000_000;
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

beforeEach(() => {
  mockConfig.raw = {};
  resetDb();
  mockServer.rpcResults = {};
  mockServer.fnResults = [];
  (emitCue as jest.Mock).mockClear();
  (rpc as jest.Mock).mockClear();
  (callFunction as jest.Mock).mockClear();
  _resetFollowForTests();
  _resetLivePushForTests();
  void AsyncStorage.clear();
});

describe('settings for the first running features', () => {
  it('starts with every new switch on and the built-in values', () => {
    const s = parseAppConfig(null);
    expect([s.enabled.route_builder_enabled, s.enabled.route_snapping_enabled, s.enabled.live_links_enabled, s.enabled.avatar_marker_enabled]).toEqual([true, true, true, true]);
    expect([s.plannedRoutesMax, s.offRouteDistanceM, s.offRouteSeconds, s.liveLinkPushSeconds, s.liveLinkGraceMinutes, s.liveLinkMaxHours]).toEqual([100, 40, 15, 30, 15, 6]);
  });

  it('keeps values from the back office inside safe limits', () => {
    const s = parseAppConfig({ off_route_distance_m: 5, off_route_seconds: 900, live_link_push_seconds: 2, live_link_grace_minutes: -10, live_link_max_hours: 48 });
    expect([s.offRouteDistanceM, s.offRouteSeconds, s.liveLinkPushSeconds, s.liveLinkGraceMinutes, s.liveLinkMaxHours]).toEqual([20, 60, 15, 0, 12]);
    expect(parseAppConfig({ live_links_enabled: false }).enabled.live_links_enabled).toBe(false);
  });

  it('has a plain message for each paused feature', () => {
    for (const k of ['route_builder_enabled', 'route_snapping_enabled', 'live_links_enabled', 'avatar_marker_enabled'] as const) expect(PAUSED_TEXT[k].length).toBeGreaterThan(20);
  });
});

describe('following a route during a run', () => {
  const choice = { kind: 'planned' as const, refId: 'r1', name: 'River loop', path: route };

  it('alerts once after the runner has been off the line for long enough, and again when back on it', async () => {
    attachFollow('s1', choice, { offRouteM: 40, offRouteSeconds: 15 });
    samples.s1 = Array.from({ length: 11 }, (_, k) => fix(along(k * 20), T0 + k * 2000));
    await checkFollow('s1', 10_000);
    expect(emitCue).not.toHaveBeenCalled();
    expect(followStatus('s1')!.snap.state).toBe('on');

    // 80 m north of the line for 30 seconds.
    samples.s1.push(...Array.from({ length: 16 }, (_, k) => fix(along(220 + k * 5, 80), T0 + 22_000 + k * 2000)));
    await checkFollow('s1', 20_000);
    expect(emitCue).toHaveBeenCalledTimes(1);
    expect(emitCue).toHaveBeenLastCalledWith('off_route', OFF_ROUTE_TEXT);

    samples.s1.push(fix(along(320), T0 + 56_000), fix(along(340), T0 + 58_000));
    await checkFollow('s1', 30_000);
    expect(emitCue).toHaveBeenLastCalledWith('back_on_route', BACK_ON_ROUTE_TEXT);
    expect(followSummary('s1')).toEqual({ followed: 'planned', alerts: 1 });
    expect(followStatus('s1')!.remainingM).toBeGreaterThan(600);
    expect(followStatus('s1')!.remainingM).toBeLessThan(700);
  });

  it('never alerts for a short wander or for fixes too inaccurate to judge', async () => {
    attachFollow('s1', choice, { offRouteM: 40, offRouteSeconds: 15 });
    samples.s1 = [
      ...Array.from({ length: 5 }, (_, k) => fix(along(k * 20), T0 + k * 2000)),
      // ten seconds off the line: under the limit
      ...Array.from({ length: 5 }, (_, k) => fix(along(100 + k * 5, 60), T0 + 10_000 + k * 2000)),
      // a long stretch of poor fixes far away
      ...Array.from({ length: 20 }, (_, k) => fix(along(150, 200), T0 + 20_000 + k * 2000, 80)),
      fix(along(160), T0 + 62_000)
    ];
    await checkFollow('s1', 10_000);
    expect(emitCue).not.toHaveBeenCalled();
    expect(followSummary('s1').alerts).toBe(0);
  });

  it('checks at most every few seconds and reports no route when none was chosen', async () => {
    attachFollow('s1', choice, { offRouteM: 40, offRouteSeconds: 15 });
    samples.s1 = [fix(along(0), T0)];
    await checkFollow('s1', 10_000);
    samples.s1.push(fix(along(10), T0 + 1000));
    await checkFollow('s1', 11_000);
    expect(followStatus('s1')!.snap.lastT).toBe(T0);
    expect(followSummary('nothing')).toEqual({ followed: 'none', alerts: 0 });
  });
});

describe('sending positions to a live link', () => {
  it('sends a thinned set of the newest fixes, no more often than the interval', async () => {
    attachLiveShare('s2', 'tok_s2_abcdefghijklmnop', 'run', 30);
    samples.s2 = Array.from({ length: 31 }, (_, k) => fix({ lat: 51.5 + k * 1.23456789e-5, lng: -0.12 }, T0 + k * 2000));
    mockServer.rpcResults.live_link_push = { ok: true, added: 7, every_seconds: 30 };
    await pushLive('s2', { force: true }, 100_000);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = (rpc as jest.Mock).mock.calls[0]!;
    expect(fn).toBe('live_link_push');
    expect(args).toMatchObject({ p_token: 'tok_s2_abcdefghijklmnop', p_session: 's2', p_state: 'running' });
    const pts = args.p_points as { t: number; lat: number }[];
    expect(pts.map((p) => (p.t - T0) / 1000)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(pts.every((p) => Math.round(p.lat * 1e6) === p.lat * 1e6)).toBe(true);

    await pushLive('s2', {}, 110_000); // too soon
    expect(rpc).toHaveBeenCalledTimes(1);

    samples.s2.push(fix({ lat: 51.501, lng: -0.12 }, T0 + 70_000));
    await pushLive('s2', {}, 131_000);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(((rpc as jest.Mock).mock.calls[1]![1].p_points as { t: number }[]).map((p) => p.t)).toEqual([T0 + 70_000]);
  });

  it('stops for good once the server says the link has ended', async () => {
    attachLiveShare('s3', 'tok_s3_abcdefghijklmnop', 'standing', 30);
    samples.s3 = [fix(start, T0)];
    mockServer.rpcResults.live_link_push = { ok: false, reason: 'ended' };
    await pushLive('s3', { force: true }, 100_000);
    expect(liveShareFor('s3')!.ended).toBe(1);
    await pushLive('s3', { force: true }, 200_000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('thins fixes to one every ten seconds, always keeping the newest, at most ten', () => {
    const many = Array.from({ length: 200 }, (_, k) => fix(start, T0 + k * 1000));
    const out = thinFixes(many);
    expect(out).toHaveLength(10);
    expect(out[out.length - 1]!.t).toBe(T0 + 199_000);
    expect(thinFixes([])).toEqual([]);
  });
});

describe('the live sharing sheet', () => {
  it('creates a link for this run, opens the share sheet and waits for the run to start', async () => {
    mockServer.rpcResults.my_live_links = [];
    mockServer.rpcResults.live_link_create = { token: 'tok_new_abcdefghijklmn', kind: 'run', created: true };
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction } as never);
    const onShared = jest.fn();
    await render(wrap(<LiveShareSheet visible onClose={() => {}} sessionId={null} onShared={onShared} />));
    expect(screen.getByText(liveLinkExplainer(15, 6))).toBeTruthy();
    await fireEvent.press(screen.getByText('Share link'));
    await settle();
    expect(rpc).toHaveBeenCalledWith('live_link_create', { p_kind: 'run', p_show_everywhere: false });
    expect(String((share.mock.calls[0]![0] as { message: string }).message)).toContain('/l/tok_new_abcdefghijklmn');
    expect(pendingLiveShare()).toEqual({ token: 'tok_new_abcdefghijklmn', kind: 'run' });
    expect(onShared).toHaveBeenCalledWith({ token: 'tok_new_abcdefghijklmn', kind: 'run' });
    share.mockRestore();
  });

  it('says so plainly when live links are paused', async () => {
    mockConfig.raw = { live_links_enabled: false };
    await render(wrap(<LiveShareSheet visible onClose={() => {}} sessionId={null} />));
    expect(screen.getByText(PAUSED_TEXT.live_links_enabled)).toBeTruthy();
    expect(screen.queryByText('Share link')).toBeNull();
  });
});

describe('the live link page', () => {
  const running: PublicLiveLink = {
    status: 'running', kind: 'run', name: 'Sam', started_at: new Date(Date.now() - 25 * 60_000).toISOString(), last_update: new Date().toISOString(),
    distance_m: 4210, hidden: false, last: { lat: 51.501, lng: -0.119 }, trail: [[[-0.12, 51.5], [-0.1195, 51.5005], [-0.119, 51.501]]], refresh_seconds: 30
  };
  const show = async (data: PublicLiveLink | null) => {
    mockPage.query = { data, isLoading: false, error: null, refetch: () => {} };
    return render(wrap(<LiveLinkPage />));
  };

  it('shows who is running, how far and for how long, and opens their position in maps', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await show(running);
    expect(screen.getByText('Sam is running')).toBeTruthy();
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(screen.getByText('4.21')).toBeTruthy();
    expect(screen.getByText(/Running for 25 min/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Open in maps'));
    expect(open).toHaveBeenCalledWith(mapsLink({ lat: 51.501, lng: -0.119 }));
    open.mockRestore();
  });

  it('hides the position inside a protected area and offers no map link', async () => {
    await show({ ...running, hidden: true, last: null });
    expect(screen.getByText('Sam is in one of their protected areas, so where they are is hidden for now.')).toBeTruthy();
    expect(screen.queryByText('Open in maps')).toBeNull();
  });

  it('says when sharing is over, and shows nothing for a link that was turned off', async () => {
    await show({ status: 'ended', kind: 'run', name: 'Sam' });
    expect(screen.getByText('This live link has ended')).toBeTruthy();
    expect(screen.queryByText(/Running for/)).toBeNull();
    await show(null);
    expect(screen.getByText('This live link is not available')).toBeTruthy();
  });

  it('counts one opening however often the page refreshes', async () => {
    const { countLiveView } = jest.requireMock('@/features/live/api') as { countLiveView: jest.Mock };
    countLiveView.mockClear();
    const view = await show(running);
    await view.rerender(wrap(<LiveLinkPage />));
    expect(countLiveView).toHaveBeenCalledTimes(1);
    expect(countLiveView).toHaveBeenCalledWith('abcdefghijklmnopqrstuv');
  });

  it('loads no analytics on the public pages', () => {
    const { onPublicPage } = jest.requireActual('@/lib/analytics') as typeof import('@/lib/analytics');
    expect(onPublicPage('/l/abcdefghijklmnopqrstuv')).toBe(true);
    expect(onPublicPage('/a/abcdefghijklmnopqrstuv')).toBe(true);
    expect(onPublicPage('/map')).toBe(false);
    expect(onPublicPage('/l/abc/edit')).toBe(false);
    expect(onPublicPage(null)).toBe(false);
  });

  it('words every state, and warns when updates stop', () => {
    expect(liveHeadline({ status: 'waiting', name: 'Sam' }).title).toBe("Sam hasn't started yet");
    expect(liveHeadline({ status: 'not_running', name: 'Sam' }).title).toBe("Sam isn't running right now");
    expect(liveHeadline({ status: 'finished', name: 'Sam' }).title).toBe('Sam has finished');
    const now = Date.now();
    expect(freshness(new Date(now - 40_000).toISOString(), now)).toEqual({ text: 'Updated 40 s ago', stale: false });
    expect(freshness(new Date(now - 5 * 60_000).toISOString(), now)!.stale).toBe(true);
    expect(freshness(null, now)).toBeNull();
    expect(mapsLink({ lat: 51.5012345, lng: -0.1198765 })).toBe('https://www.google.com/maps/search/?api=1&query=51.50123,-0.11988');
    expect([fmtElapsed(20_000), fmtElapsed(38 * 60_000 + 59_000), fmtElapsed(65 * 60_000)]).toEqual(['under a minute', '38 min', '1 h 05 min']);
  });
});

describe('the route planner', () => {
  const a = start;
  const b = destination(a, 500, 90);
  const c = destination(b, 500, 0);

  it('draws straight legs between taps, closes a loop and undoes step by step', async () => {
    const { result } = await renderHook(() => usePlanner(undefined, false));
    await act(async () => { await result.current.addPoint(a); });
    await act(async () => { await result.current.addPoint(b); });
    await act(async () => { await result.current.addPoint(c); });
    expect(result.current.plan.legs).toHaveLength(2);
    expect(result.current.distanceM).toBeGreaterThan(990);
    expect(result.current.distanceM).toBeLessThan(1010);
    expect(result.current.snapped).toBe(false);
    expect(result.current.canClose).toBe(true);
    await act(async () => { await result.current.closeLoop(); });
    expect(result.current.loop).toBe(true);
    expect(result.current.canClose).toBe(false);
    await act(() => result.current.undo());
    expect(result.current.loop).toBe(false);
    expect(result.current.plan.points).toHaveLength(3);
    expect(callFunction).not.toHaveBeenCalled();
  });

  it('turns a line into an out-and-back and reverses it', async () => {
    const { result } = await renderHook(() => usePlanner(undefined, false));
    await act(async () => { await result.current.addPoint(a); });
    await act(async () => { await result.current.addPoint(b); });
    await act(() => result.current.outAndBack());
    expect(result.current.distanceM).toBeGreaterThan(990);
    expect(haversineMeters(result.current.path[result.current.path.length - 1]!, a)).toBeLessThan(1);
    await act(() => result.current.undo());
    await act(() => result.current.reverse());
    expect(haversineMeters(result.current.plan.points[0]!, b)).toBeLessThan(1);
  });

  it('follows paths when it can, moving the points onto them, and says why a leg is straight when not', async () => {
    const onPathA = destination(a, 8, 0);
    const onPathB = destination(b, 6, 0);
    mockServer.fnResults = [
      { snapped: true, path: encodePolyline([onPathA, destination(onPathA, 250, 90), onPathB]), distance_m: 505 },
      { snapped: false, reason: 'capped' }
    ];
    const { result } = await renderHook(() => usePlanner(undefined, true));
    await act(async () => { await result.current.addPoint(a); });
    await act(async () => { await result.current.addPoint(b); });
    expect(haversineMeters(result.current.plan.points[0]!, onPathA)).toBeLessThan(2);
    expect(haversineMeters(result.current.plan.points[1]!, onPathB)).toBeLessThan(2);
    expect(result.current.snapped).toBe(true);
    await act(async () => { await result.current.addPoint(c); });
    expect(result.current.note).toBe(straightLegNote('capped'));
    expect(result.current.plan.legs[1]!.snapped).toBe(false);
    expect(callFunction).toHaveBeenCalledWith('route-snap', expect.objectContaining({ from: expect.any(Object), to: expect.any(Object) }), { timeoutMs: 10_000 });
  });

  it('opens a saved route as it was saved', () => {
    const plan = planFromLine(route, true);
    expect(plan.points).toHaveLength(2);
    expect(plan.legs[0]!.path).toHaveLength(route.length);
    expect(planFromLine([a], false).points).toHaveLength(0);
  });

  it('keeps the offline map 500 m around the route', () => {
    const [ne, sw] = packBounds(route)!;
    expect(haversineMeters({ lng: ne[0], lat: ne[1] }, { lng: ne[0], lat: route[0]!.lat })).toBeGreaterThan(490);
    expect(sw[0]).toBeLessThan(route[0]!.lng);
    expect(ne[0]).toBeGreaterThan(route[route.length - 1]!.lng);
  });

  it('estimates the offline map size before downloading, larger for a longer route', () => {
    const short = estimateOfflineBytes(route)!;
    const long = estimateOfflineBytes(Array.from({ length: 21 }, (_, i) => along(i * 500)))!;
    expect(short).toBeGreaterThan(1_500_000);
    expect(short).toBeLessThan(10_000_000);
    expect(long).toBeGreaterThan(short * 2);
    expect(sizeLabel(4_200_000)).toBe('about 4 MB');
    expect(sizeLabel(23_000_000)).toBe('about 25 MB');
    expect(sizeLabel(400_000)).toBe('under 1 MB');
  });

  it('previews the land inside a planned loop against the published map', () => {
    const sq = [a, destination(a, 300, 90), destination(destination(a, 300, 90), 300, 0), destination(a, 300, 0), a];
    const cells = loopCells(sq, 11)!;
    expect(cells.length).toBeGreaterThan(20);
    const mine = BigInt(`0x${cells[0]}`).toString();
    const p = previewLand(cells, [
      { cell: mine, status: 'controlled', controller_key: 'me', controller_handle: 'me', controller_name: 'Me', is_me: true },
      { cell: cells[1]!, status: 'controlled', controller_key: 'x', controller_handle: 'x', controller_name: 'X', is_me: false },
      { cell: latLngToCell(10, 10, 11), status: 'excluded', controller_key: null, controller_handle: null, controller_name: null, is_me: false }
    ]);
    expect(p).toMatchObject({ total: cells.length, mine: 1, others: 1, unavailable: 0, free: cells.length - 2 });
    expect(previewText(p)).toMatch(/The run itself decides\.$/);
    expect(loopCells(route.slice(0, 3), 11)).toBeNull();
  });
});

describe('the picture as the position dot', () => {
  it('is on unless the runner turns it off on this phone', async () => {
    expect(await loadMarkerPreference()).toBe(true);
    await saveMarkerPreference(false);
    expect(await loadMarkerPreference()).toBe(false);
  });

  it('names the kept marker after the picture, so a new picture makes a new marker', () => {
    expect(markerFileName('me/a.jpg')).toBe(markerFileName('me/a.jpg'));
    expect(markerFileName('me/a.jpg')).not.toBe(markerFileName('me/b.jpg'));
    expect(markerFileName('me/a.jpg')).toMatch(/^avatar-marker-[a-z0-9]+\.png$/);
  });
});
