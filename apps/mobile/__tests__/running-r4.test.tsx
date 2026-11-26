/**
 * Running features, fourth stage: a speed route from part of a run (the phone's checks and what it sends),
 * shoe mileage (the list, adding and changing a pair, photos, the pair on a run, reminders, run_saved) and the
 * 3D replay (its clock, the flat map with Reduce Motion or a slow phone, the controls). The server, storage and
 * the map are replaced at their module boundaries.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { buildReplay, destination, encodePolyline, pathLengthMeters, replayAt, type LatLng } from '@loopfield/core';
import { parseAppConfig, PAUSED_TEXT } from '@/lib/appConfig';
import { track } from '@/lib/analytics';
import { queryClient } from '@/lib/query';
import { prepareImage, uploadToBucket } from '@/features/social/media';
import { shoesSubtitle, useRunShoes, wear, type Gear } from '@/features/gear/api';
import { RunShoesCard } from '@/features/gear/ShoeParts';
import { reminderText, typedMetres } from '@/features/gear/text';
import { defaultPart, overlapWith, touchedArea, type OwnArea } from '@/features/propose/parts';
import { ReplayClock } from '@/features/replay/clock';
import { PACE_SHADES, shadeColor } from '@/features/replay/colors';
import { ReplayView } from '@/features/replay/ReplayView';
import { filterOf, presentNotification } from '@/notifications/present';
import { routeForNotification } from '@/notifications/push';
import { countsTowardsShoes } from '@/recording/gearSource';
import ShoesScreen from '../app/(app)/shoes/index';
import ShoeScreen from '../app/(app)/shoes/[id]';
import ProposeRoute from '../app/(app)/propose-route/[activityId]';
import ReplayScreen from '../app/(app)/activities/replay/[id]';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), AndroidImportance: { DEFAULT: 3 } }));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  return {
    ...actual,
    useAppConfig: () => ({ settings: actual.parseAppConfig(mockConfig.raw), loaded: true, error: null }),
    useFeature: (k: string) => actual.parseAppConfig(mockConfig.raw).enabled[k],
    fetchAppConfig: async () => actual.parseAppConfig(mockConfig.raw)
  };
});
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), rpc: jest.fn(async (fn: string, args?: Record<string, unknown>) => mockRpc(fn, args ?? {})) }));
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: table === 'route_proposals' ? mockServer.proposals : [], error: null }).then(ok, bad)
      };
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          mockServer.removed.push(...paths.map((x) => `${bucket}/${x}`));
          return { error: null };
        }
      })
    }
  })
}));
jest.mock('@/features/social/media', () => ({
  useSignedUrl: () => ({ data: null }),
  prepareImage: jest.fn(async () => ({ uri: 'file:///prepared.jpg', width: 800, height: 800 })),
  uploadToBucket: jest.fn(async () => {})
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(async () => mockPicker.result) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: 'me', profile: { status: 'active' }, settings: null }), useUnits: () => mockUnits.value }));
jest.mock('@/features/results/useActivity', () => ({ useActivityDetail: () => mockDetail }));
jest.mock('@/lib/gameRules', () => ({ useSpeedRules: () => jest.requireActual('@loopfield/core').SPEED_RULES }));
jest.mock('@/theme/motion', () => ({ ...jest.requireActual('@/theme/motion'), useReducedMotion: () => mockMotion.reduced }));
jest.mock('@/features/map/MapCanvas', () => {
  const { Text } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return {
    mapAvailability: () => ({ ok: true }),
    MapCanvas: ({ layers, accessibilityLabel }: { layers: { faint?: unknown[]; path?: unknown[]; paceLines?: unknown[]; dot?: unknown; markers?: { label: string }[] }; accessibilityLabel: string }) =>
      createElement(Text, { accessibilityLabel, testID: 'map' }, JSON.stringify({ faint: layers.faint?.length ?? 0, path: layers.path?.length ?? 0, pace: layers.paceLines?.length ?? 0, dot: Boolean(layers.dot), markers: (layers.markers ?? []).map((m) => m.label) }))
  };
});

const mockConfig: { raw: Record<string, unknown> } = { raw: {} };
const mockParams: Record<string, string | undefined> = {};
const mockUnits = { value: 'metric' as 'metric' | 'imperial' };
const mockMotion = { reduced: false };
const mockPicker: { result: unknown } = { result: { canceled: true, assets: [] } };
const mockDetail: { data: unknown; isLoading: boolean; error: unknown; refetch: () => void } = { data: null, isLoading: false, error: null, refetch: () => {} };
const mockServer = {
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  gear: [] as Gear[],
  areas: [] as OwnArea[],
  proposals: [] as unknown[],
  removed: [] as string[]
};
async function mockRpc(fn: string, args: Record<string, unknown>) {
  mockServer.calls.push({ fn, args });
  if (fn === 'my_gear') return mockServer.gear;
  if (fn === 'my_protected_areas') return mockServer.areas;
  if (fn === 'save_gear') return (args.p_id as string | null) ?? 'g-new';
  return null;
}
const called = (fn: string) => mockServer.calls.filter((c) => c.fn === fn).map((c) => c.args);
const events = (name: string) => (track as jest.Mock).mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

const pair = (over: Partial<Gear> = {}): Gear => ({
  id: 'g1', name: 'Blue trainers', photo_path: null, start_distance_m: 0, reminder_m: 700_000, is_default: true, retired_at: null,
  distance_m: 512_000, runs: 64, created_at: '2026-06-01T08:00:00Z', ...over
});

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
const disabled = (label: string) => Boolean(screen.getByLabelText(label).props.accessibilityState?.disabled);

const ORIGIN: LatLng = { lat: 24.8607, lng: 67.0011 };
/** Running west: 600 m to the park, once round it (about 2.5 km), 600 m on. */
const park = destination(ORIGIN, 1200, 90);
const lapCentre = destination(park, 400, 0);
const lap = Array.from({ length: 121 }, (_, i) => destination(lapCentre, 400, 180 + i * 3));
const parkRun = [destination(park, 600, 90), ...lap, destination(park, 600, 270)];
const lapM = pathLengthMeters(lap);
const straight = [ORIGIN, destination(ORIGIN, 3000, 90)];
const activity = (line: LatLng[], over: Record<string, unknown> = {}) => ({
  id: 'a1', status: 'processed', modes: {}, personal_route: encodePolyline(line), distance_m: Math.round(pathLengthMeters(line)), splits: null, gear_id: null, ...over
});

beforeEach(() => {
  mockConfig.raw = {};
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  mockUnits.value = 'metric';
  mockMotion.reduced = false;
  mockPicker.result = { canceled: true, assets: [] };
  Object.assign(mockDetail, { data: null, isLoading: false, error: null });
  Object.assign(mockServer, { calls: [], gear: [], areas: [], proposals: [], removed: [] });
  (track as jest.Mock).mockClear();
  (prepareImage as jest.Mock).mockClear();
  (uploadToBucket as jest.Mock).mockClear();
  queryClient.clear();
});

describe('stage 4 settings and words', () => {
  it('has shoes and replay on, start-to-finish routes off, and sensible limits', () => {
    const s = parseAppConfig(null);
    expect(s.enabled.gear_enabled).toBe(true);
    expect(s.enabled.replay_enabled).toBe(true);
    expect(s.routeProposalsAToB).toBe(false);
    expect([s.gearMaxItems, s.gearReminderDefaultKm]).toEqual([20, 700]);
    expect(parseAppConfig({ route_proposals_a_to_b: true, gear_reminder_default_km: 50, gear_max_items: 900 })).toMatchObject({ routeProposalsAToB: true, gearReminderDefaultKm: 300, gearMaxItems: 100 });
    expect(parseAppConfig({ gear_reminder_default_km: 9000 }).gearReminderDefaultKm).toBe(1500);
    expect(PAUSED_TEXT.gear_enabled).toMatch(/kept/);
    expect(PAUSED_TEXT.replay_enabled).toBe('Replay is paused for now.');
  });

  it('reads distances in the runner\'s units and says how worn a pair is', () => {
    expect(typedMetres('512', 'metric')).toBe(512_000);
    expect(typedMetres('512,5', 'metric')).toBe(512_500);
    expect(typedMetres('300', 'imperial')).toBe(482_803);
    expect(typedMetres('lots', 'metric')).toBeNull();
    expect(typedMetres('', 'metric')).toBeNull();
    expect(wear(pair({ distance_m: 640_000 }))).toEqual({ share: 640 / 700, due: 'soon' });
    expect(wear(pair({ distance_m: 800_000 })).due).toBe('now');
    expect(reminderText(pair(), 'metric')).toBe('Reminder at 700 km.');
    expect(reminderText(pair({ distance_m: 650_000 }), 'metric')).toBe('Nearly at its reminder distance of 700 km.');
    expect(reminderText(pair({ distance_m: 702_000 }), 'metric')).toMatch(/^Past its reminder distance of 700 km/);
    expect(shoesSubtitle([pair(), pair({ id: 'g2', name: 'Racers', is_default: false })])).toBe('2 pairs · new runs: Blue trainers');
    expect(shoesSubtitle([pair({ retired_at: '2026-10-01T00:00:00Z', is_default: false })])).toBe('No pairs in use');
    expect(shoesSubtitle([])).toBe('Keep count of the distance on each pair');
  });
});

describe('a speed route from part of a run: the phone\'s checks', () => {
  it('finds a protected area the part passes near, and parts that clash', () => {
    const home: OwnArea = { id: 'h', label: 'Home', radius_m: 100, lat: park.lat, lng: park.lng };
    expect(touchedArea(lap, [home])?.label).toBe('Home');
    expect(touchedArea(straight, [{ ...home, lat: destination(ORIGIN, 400, 0).lat, lng: ORIGIN.lng }])).toBeNull();
    const parts = [{ id: 'p1', name: 'River bend', status: 'pending_review', from_m: 500, to_m: 2000 }, { id: 'p2', name: 'Old', status: 'declined', from_m: 0, to_m: 4000 }];
    expect(overlapWith(parts, false, 2000, 3500)).toBeNull();
    expect(overlapWith(parts, false, 1900, 3500)?.kind).toBe('overlap');
    expect(overlapWith(parts, true, 0, 4000)?.kind).toBe('parts_taken');
    expect(overlapWith([{ id: 'w', name: 'Whole', status: 'approved', from_m: null, to_m: null }], false, 0, 100)?.kind).toBe('whole_taken');
    expect(defaultPart(8000, 5000)).toEqual([0, 4990]);
    expect(defaultPart(3000, 5000)).toEqual([0, 3000]);
  });

  it('proposes a whole land loop as before, and a whole private run as the part it is', async () => {
    mockDetail.data = { activity: activity(lap, { modes: { territory: true } }) };
    await render(wrap(<ProposeRoute />));
    await flush();
    expect(screen.getByRole('tab', { name: 'Whole run' }).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(disabled('Submit for review')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Route name'), 'Park loop');
    await fireEvent(screen.getByLabelText('Publish this route geometry if approved'), 'valueChange', true);
    expect(disabled('Submit for review')).toBe(false);
    await fireEvent.press(screen.getByLabelText('Submit for review'));
    await flush();
    expect(called('propose_route')).toEqual([{ p_activity: 'a1', p_name: 'Park loop', p_consent_version: expect.any(String), p_score_founding_run: false }]);
    expect(events('route_proposed')).toEqual([{ outcome: 'submitted', from_stretch: false, shape: 'loop' }]);
  });

  it('sends a whole private loop with its ends, since it has no captured loop', async () => {
    mockDetail.data = { activity: activity(lap) };
    await render(wrap(<ProposeRoute />));
    await flush();
    await fireEvent.changeText(screen.getByLabelText('Route name'), 'Park loop');
    await fireEvent(screen.getByLabelText('Publish this route geometry if approved'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Submit for review'));
    await flush();
    const sent = called('propose_route')[0]!;
    expect(sent.p_from_m).toBe(0);
    expect(Math.abs((sent.p_to_m as number) - lapM)).toBeLessThan(3); // the line as stored (to 1e-5°)
  });

  it('chooses a lap out of a longer run with the two sliders, and sends only where it starts and ends', async () => {
    mockDetail.data = { activity: activity(parkRun) };
    await render(wrap(<ProposeRoute />));
    await flush();
    // 3.7 km and not a loop: part of the run is chosen from the start.
    expect(screen.getByRole('tab', { name: 'Part of this run' }).props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByText(/Only loops can be proposed for now/)).toBeTruthy();
    const start = screen.getByTestId('stretch-start');
    const end = screen.getByTestId('stretch-end');
    for (let i = 0; i < 6; i++) await fireEvent(start, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    for (let i = 0; i < 6; i++) await fireEvent(end, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(start.props.accessibilityValue).toEqual({ text: 'Start at 600 m' });
    expect(end.props.accessibilityValue.text).toBe(`End at ${+((Math.round(pathLengthMeters(parkRun) / 10) * 10 - 600) / 1000).toFixed(1)} km`);
    expect(screen.queryByText(/Only loops can be proposed for now/)).toBeNull();
    expect(screen.getByText(/· loop$/)).toBeTruthy();
    expect(JSON.parse(String(screen.getByTestId('map').props.children))).toMatchObject({ faint: parkRun.length, markers: ['Start and finish'] });
    await fireEvent.changeText(screen.getByLabelText('Route name'), 'Park lap');
    await fireEvent(screen.getByLabelText('Publish this route geometry if approved'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Submit for review'));
    await flush();
    const sent = called('propose_route')[0]!;
    expect(sent.p_from_m).toBe(600);
    expect(Math.abs((sent.p_to_m as number) - (600 + lapM))).toBeLessThan(15);
    expect(events('route_proposed')).toEqual([{ outcome: 'submitted', from_stretch: true, shape: 'loop' }]);
  });

  it('holds back a part that touches a protected area or overlaps one already proposed', async () => {
    mockServer.areas = [{ id: 'h', label: 'Home', radius_m: 100, lat: park.lat, lng: park.lng }];
    mockServer.proposals = [{ id: 'p1', name: 'River bend', status: 'pending_review', from_m: 2000, to_m: 3000 }];
    mockDetail.data = { activity: activity(parkRun) };
    await render(wrap(<ProposeRoute />));
    await flush();
    expect(screen.getByText('This passes within 50 m of your protected area “Home”, so it would be declined. Choose a part away from it.')).toBeTruthy();
    expect(screen.getByText('This overlaps “River bend”, which you proposed from 2 km to 3 km.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Route name'), 'Park lap');
    await fireEvent(screen.getByLabelText('Publish this route geometry if approved'), 'valueChange', true);
    expect(disabled('Submit for review')).toBe(true);
  });

  it('offers start-to-finish routes only once the back office turns them on', async () => {
    mockDetail.data = { activity: activity(straight) };
    const first = await render(wrap(<ProposeRoute />));
    await flush();
    expect(screen.getByText(/Only loops can be proposed for now: the start and finish must be within 30 m/)).toBeTruthy();
    await first.unmount();
    mockConfig.raw = { route_proposals_a_to_b: true };
    await render(wrap(<ProposeRoute />));
    await flush();
    expect(screen.queryByText(/Only loops can be proposed/)).toBeNull();
    expect(screen.getByText(/· start to finish$/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Route name'), 'River straight');
    await fireEvent(screen.getByLabelText('Publish this route geometry if approved'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Submit for review'));
    await flush();
    expect(called('propose_route')[0]).toMatchObject({ p_from_m: 0, p_to_m: 3000 });
    expect(events('route_proposed')).toEqual([{ outcome: 'submitted', from_stretch: true, shape: 'start_to_finish' }]);
  });
});

describe('shoes', () => {
  it('lists pairs in use with their distance and reminder, then retired ones', async () => {
    mockServer.gear = [pair(), pair({ id: 'g2', name: 'Racers', is_default: false, distance_m: 640_000, runs: 30 }), pair({ id: 'g3', name: 'Old faithfuls', is_default: false, retired_at: '2026-03-03T10:00:00Z', distance_m: 812_000 })];
    await render(wrap(<ShoesScreen />));
    await flush();
    expect(screen.getByText('Blue trainers')).toBeTruthy();
    expect(screen.getByText('512 km · 64 runs · new runs count here')).toBeTruthy();
    expect(screen.getByText('Nearly at its reminder distance of 700 km.')).toBeTruthy();
    expect(screen.getByText('Retired')).toBeTruthy();
    expect(screen.getByText(/^812 km · retired/)).toBeTruthy();
    expect(disabled('Add shoes')).toBe(false);
    await fireEvent.press(screen.getByText('Racers'));
  });

  it('stops adding at the most pairs in use, and shows only a note while shoes are paused', async () => {
    mockConfig.raw = { gear_max_items: 2 };
    mockServer.gear = [pair(), pair({ id: 'g2', name: 'Racers', is_default: false })];
    const view = await render(wrap(<ShoesScreen />));
    await flush();
    expect(screen.getByText('You have 2 pairs in use, the most at once. Retire one to add another.')).toBeTruthy();
    expect(disabled('Add shoes')).toBe(true);
    await view.unmount();
    mockConfig.raw = { gear_enabled: false };
    mockServer.calls = [];
    await render(wrap(<ShoesScreen />));
    await flush();
    expect(screen.getByText(PAUSED_TEXT.gear_enabled)).toBeTruthy();
    expect(called('my_gear')).toEqual([]);
  });

  it('adds a first pair, counting new runs towards it, with a photo re-encoded small on the phone', async () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      mockParams.id = 'new';
      mockPicker.result = { canceled: false, assets: [{ uri: 'file:///picked.heic' }] };
      await render(wrap(<ShoeScreen />));
      await flush();
      await fireEvent.changeText(screen.getByLabelText('Name'), '  Blue trainers ');
      await fireEvent.changeText(screen.getByLabelText('Distance already on them (km)'), '120');
      expect(screen.getByLabelText('Remind me at (km)').props.value).toBe('700');
      await fireEvent.press(screen.getByLabelText('Add photo'));
      await flush();
      expect(screen.getByText('Photo chosen. It is added when you save.')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Add shoes'));
      await flush();
      expect(called('save_gear')).toEqual([{ p_id: null, p_name: 'Blue trainers', p_start_distance_m: 120_000, p_reminder_m: 700_000, p_default: true }]);
      expect(prepareImage).toHaveBeenCalledWith('file:///picked.heic', { maxEdge: 1024 });
      expect(uploadToBucket).toHaveBeenCalledWith('gear-photos', 'me/g-new-1800000000000.jpg', 'file:///prepared.jpg');
      expect(called('set_gear_photo')).toEqual([{ p_id: 'g-new', p_path: 'me/g-new-1800000000000.jpg' }]);
      expect(events('gear')).toEqual([{ action: 'added' }, { action: 'photo_added' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('changes, retires and deletes a pair (with its photo)', async () => {
    mockParams.id = 'g1';
    mockServer.gear = [pair({ photo_path: 'me/g1-1.jpg' })];
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await render(wrap(<ShoeScreen />));
    await flush();
    expect(screen.getByText('512')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Remind me at (km)'), '800');
    await fireEvent.press(screen.getByLabelText('Save changes'));
    await flush();
    expect(called('save_gear')).toEqual([{ p_id: 'g1', p_name: 'Blue trainers', p_start_distance_m: 0, p_reminder_m: 800_000, p_default: true }]);
    await fireEvent.press(screen.getByLabelText('Retire this pair'));
    await flush();
    expect(called('retire_gear')).toEqual([{ p_id: 'g1', p_retired: true }]);
    await fireEvent.press(screen.getByLabelText('Delete this pair'));
    await flush();
    expect(called('delete_gear')).toEqual([{ p_id: 'g1' }]);
    expect(mockServer.removed).toEqual(['gear-photos/me/g1-1.jpg']);
    expect(events('gear')).toEqual([{ action: 'edited' }, { action: 'retired' }, { action: 'deleted' }]);
    (Alert.alert as jest.Mock).mockRestore();
  });

  it('refuses a reminder distance out of range, and counts a reminder being opened', async () => {
    mockParams.id = 'g1';
    mockParams.from = 'reminder';
    mockServer.gear = [pair()];
    await render(wrap(<ShoeScreen />));
    await flush();
    expect(events('gear')).toEqual([{ action: 'reminder_opened' }]);
    await fireEvent.changeText(screen.getByLabelText('Remind me at (km)'), '20');
    expect(screen.getByText('Choose between 50 km and 5000 km.')).toBeTruthy();
    expect(disabled('Save changes')).toBe(true);
  });

  it('shows and changes the pair a run counts towards', async () => {
    mockServer.gear = [pair(), pair({ id: 'g2', name: 'Racers', is_default: false, distance_m: 210_000 }), pair({ id: 'g3', name: 'Old faithfuls', is_default: false, retired_at: '2026-03-03T10:00:00Z' })];
    await render(wrap(<RunShoesCard activityId="a1" gearId="g1" />));
    await flush();
    expect(screen.getByText('Blue trainers, 512 km')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Change the shoes this run counts towards'));
    expect(screen.getByLabelText('Blue trainers, chosen')).toBeTruthy();
    expect(screen.queryByText('Old faithfuls')).toBeNull(); // retired, and not this run's pair
    await fireEvent.press(screen.getByLabelText('Racers'));
    await flush();
    expect(called('set_run_gear')).toEqual([{ p_activity: 'a1', p_gear: 'g2' }]);
    await fireEvent.press(screen.getByLabelText('Change the shoes this run counts towards'));
    await fireEvent.press(screen.getByLabelText('No shoes'));
    await flush();
    expect(called('set_run_gear')[1]).toEqual({ p_activity: 'a1', p_gear: null });
    expect(events('gear')).toEqual([{ action: 'changed_on_run' }, { action: 'changed_on_run' }]);
  });

  it('shows nothing on a run for a runner without shoes, or while shoes are paused', async () => {
    const view = await render(wrap(<RunShoesCard activityId="a1" gearId={null} />));
    await flush();
    expect(screen.queryByText('Shoes')).toBeNull();
    await view.unmount();
    mockConfig.raw = { gear_enabled: false };
    mockServer.gear = [pair()];
    await render(wrap(<RunShoesCard activityId="a1" gearId="g1" />));
    await flush();
    expect(screen.queryByText('Shoes')).toBeNull();
  });

  it('knows a run\'s pair once the server has processed it, for its highlight', async () => {
    mockServer.gear = [pair({ distance_m: 612_000 })];
    const seen: unknown[] = [];
    function Probe({ a }: { a: { id: string; status: string; gear_id?: string | null } }) {
      const s = useRunShoes(a);
      seen.push(s === undefined ? 'unknown' : s === null ? 'none' : s.distance_m);
      return <Text>probe</Text>;
    }
    const view = await render(wrap(<Probe a={{ id: 'a1', status: 'received', gear_id: 'g1' }} />));
    await view.rerender(wrap(<Probe a={{ id: 'a1', status: 'processed', gear_id: 'g1' }} />));
    await flush();
    await view.rerender(wrap(<Probe a={{ id: 'a2', status: 'processed', gear_id: null }} />));
    expect(seen[0]).toBe('unknown');
    expect(seen).toContain(612_000);
    expect(seen.at(-1)).toBe('none');
  });

  it('says in run_saved only whether a run counts towards a pair', async () => {
    expect(await countsTowardsShoes()).toBe(false);
    queryClient.setQueryData(['gear', 'me'], [pair({ is_default: false }), pair({ id: 'g2', is_default: true })]);
    expect(await countsTowardsShoes()).toBe(true);
    mockConfig.raw = { gear_enabled: false };
    expect(await countsTowardsShoes()).toBe(false);
  });

  it('words reminders without the pair\'s name and opens the pair', () => {
    const n = (percent: number) => ({ category: 'system' as const, kind: 'gear_reminder', object_type: 'gear', data: { percent }, actor: null });
    expect(presentNotification(n(90), 'metric')).toEqual({ icon: 'shoe', title: 'Shoes nearly at their reminder distance', body: 'A pair of your shoes is at 90% of the distance you set.' });
    expect(presentNotification(n(100), 'metric').title).toBe('Shoes at their reminder distance');
    expect(filterOf(n(90))).toBe('milestones');
    expect(routeForNotification({ kind: 'gear_reminder', object_type: 'gear', object_id: 'g1' })).toEqual({ pathname: '/shoes/[id]', params: { id: 'g1', from: 'reminder' } });
  });
});

describe('replay', () => {
  const line = [ORIGIN, destination(ORIGIN, 5000, 90)];
  const splits = [300, 280, 320, 310, 290].map((s, i) => ({ index: i, distanceM: 1000, elapsedMs: s * 1000, containsGap: false }));
  const plan = buildReplay(line, splits)!;

  function drive(fps: number) {
    let now = 0;
    const queue: (() => void)[] = [];
    const log = { camera: [] as { animationMode: string; animationDuration: number }[], positions: [] as number[], ended: 0, slow: 0 };
    const clock = new ReplayClock(plan, {
      onCamera: (c) => log.camera.push(c),
      onPosition: (at) => log.positions.push(at),
      onEnd: () => log.ended++,
      onSlow: () => log.slow++
    }, () => now, (cb) => queue.push(cb), () => {});
    const run = (ms: number) => {
      for (let t = 0; t < ms && queue.length; t += 1000 / fps) {
        now += 1000 / fps;
        queue.shift()!();
      }
    };
    return { clock, run, log };
  }

  it('steps the camera from keyframe to keyframe and finishes in 20 seconds', () => {
    const { clock, run, log } = drive(60);
    clock.play(1);
    run(25_000);
    expect(log.ended).toBe(1);
    expect(clock.position).toBe(20_000);
    expect(log.camera).toHaveLength(plan.frames.length);
    expect(log.camera.every((c) => c.animationMode === 'linearTo')).toBe(true);
    expect(Math.max(...log.camera.map((c) => c.animationDuration))).toBeLessThanOrEqual(500);
    expect(log.positions.length).toBeLessThan(220); // about ten a second, not every frame
    expect(log.slow).toBe(0);
  });

  it('goes twice as fast at double speed, jumps when dragged, and notices a slow phone', () => {
    const fast = drive(60);
    fast.clock.play(2);
    fast.run(10_500);
    expect(fast.log.ended).toBe(1);
    fast.clock.seek(10_000);
    const jump = fast.log.camera.at(-1) as unknown as { animationMode: string; centerCoordinate: [number, number] };
    expect(jump.animationMode).toBe('moveTo');
    expect(jump.centerCoordinate[0]).toBeCloseTo(replayAt(plan, 10_000).center.lng, 6);
    const slow = drive(12);
    slow.clock.play(1);
    slow.run(2500);
    expect(slow.log.slow).toBe(1);
  });

  it('shades by pace in each theme', () => {
    expect(shadeColor(4, 'light')).toBe(PACE_SHADES.light[4]);
    expect(shadeColor(0, 'dark')).toBe(PACE_SHADES.dark[0]);
    expect(shadeColor(null, 'light')).toBe('#8A8F9E');
  });

  it('flies the run with play, pause and speed, and switches to a flat map on request', async () => {
    const raf = jest.spyOn(global, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      const view = await render(<ReplayView plan={plan} runM={5000} units="metric" reduced={false} />);
      expect(screen.getByLabelText('3D replay of your run over the terrain, shaded by pace. The camera follows the run.')).toBeTruthy();
      expect(JSON.parse(String(screen.getByTestId('map').props.children))).toMatchObject({ pace: 5, markers: ['1', '2', '3', '4', 'Start', 'Finish'] });
      expect(screen.getByText('Slower')).toBeTruthy();
      expect(screen.getByText('Pause or gap in that kilometre')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Play'));
      expect(screen.getByLabelText('Pause')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Double'));
      await fireEvent.press(screen.getByLabelText('Pause'));
      await fireEvent(screen.getByTestId('replay-scrub'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
      expect(screen.getByTestId('replay-scrub').props.accessibilityValue).toEqual({ text: '250 m of 5 km' });
      await fireEvent(screen.getByLabelText('Flat map'), 'valueChange', true);
      expect(screen.getByLabelText('Flat map of your run, shaded by pace, with a dot where the replay has got to.')).toBeTruthy();
      expect(events('replay')).toEqual([{ action: 'played', length: '5-10km' }, { action: 'dragged', length: '5-10km' }, { action: 'switched_to_flat', length: '5-10km', cause: 'chosen' }]);
      await view.unmount();
    } finally {
      raf.mockRestore();
    }
  });

  it('with Reduce Motion is a flat map that moves only with the slider', async () => {
    await render(<ReplayView plan={plan} runM={5000} units="imperial" reduced />);
    expect(screen.queryByLabelText('Play')).toBeNull();
    expect(screen.getByText('Reduce Motion is on, so the replay is a flat map that moves only when you drag the slider.')).toBeTruthy();
    expect(events('replay')).toEqual([{ action: 'switched_to_flat', length: '5-10km', cause: 'reduce_motion' }]);
    expect(screen.getByTestId('replay-scrub').props.accessibilityValue.text).toBe('0 ft of 3.1 mi');
  });

  it('is paused by the back office, and waits for a processed route', async () => {
    mockParams.id = 'a1';
    mockConfig.raw = { replay_enabled: false };
    const view = await render(wrap(<ReplayScreen />));
    expect(screen.getByText('Replay is paused for now.')).toBeTruthy();
    await view.unmount();
    mockConfig.raw = {};
    mockDetail.data = { activity: { ...activity(line), personal_route: null } };
    await render(wrap(<ReplayScreen />));
    expect(screen.getByText('Nothing to replay yet')).toBeTruthy();
  });
});
