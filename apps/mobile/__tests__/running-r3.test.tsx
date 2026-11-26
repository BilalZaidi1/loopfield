/**
 * Running features, third stage: Bluetooth heart-rate straps (pairing, the strap during a run, the recorder line,
 * where a run's heart rate came from) and maps of imported runs (the switch, reading a route only when asked,
 * keeping and deleting routes, the imported run's page). Bluetooth and Health Connect are replaced at their
 * module boundaries; the health cache by an in-memory stand-in.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { emptyStore, type HealthStore, type QuantitySample } from '@loopfield/core';
import { parseAppConfig, PAUSED_TEXT } from '@/lib/appConfig';
import { track } from '@/lib/analytics';
import { _resetPairedStrapForTests, savePairedStrap } from '@/features/sensors/strap';
import { _resetRunStrapForTests, discardStrapForRun, startStrapForRun, STRAP_TIMING, stopStrapForRun, useStrapLive } from '@/features/sensors/runStrap';
import { batteryWords, signalWords, strapName } from '@/features/sensors/text';
import { heartRateFrom } from '@/recording/heartRateSource';
import { keptRouteFor, routeRecordIds, setImportedMapsOn, showImportedRoute } from '@/health/routes';
import { quantities } from '@/health/useHealth';
import SensorsScreen from '../app/(app)/settings/sensors';
import ImportedRunScreen from '../app/(app)/activities/imported/[id]';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  return {
    ...actual,
    useAppConfig: () => ({ settings: actual.parseAppConfig(mockConfig.raw), loaded: true, error: null }),
    useFeature: (k: string) => actual.parseAppConfig(mockConfig.raw).enabled[k],
    fetchAppConfig: async () => actual.parseAppConfig(mockConfig.raw)
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: 'me', settings: null }), useUnits: () => 'metric' }));
jest.mock('@/features/sensors/ble', () => ({
  bluetoothInBuild: () => mockBle.inBuild,
  ensureBluetoothAccess: jest.fn(async () => mockBle.access),
  scanForStraps: jest.fn(async (_s: number, onFound: (x: unknown) => void, onDone: () => void) => {
    for (const s of mockBle.nearby) onFound(s);
    onDone();
    return () => {};
  }),
  connectStrap: jest.fn(async (id: string) => {
    mockBle.connects.push(id);
    if (mockBle.failNext > 0) {
      mockBle.failNext--;
      throw new Error('gatt 133');
    }
  }),
  disconnectStrap: jest.fn(async () => {}),
  readStrapBattery: jest.fn(async () => 87),
  listenToStrap: (_id: string, onPacket: (b: number[], at: number) => void, onLost: () => void) => {
    mockBle.packet = onPacket;
    mockBle.lost = onLost;
    return () => {
      mockBle.packet = null;
      mockBle.lost = null;
    };
  }
}));
jest.mock('@/health/cache', () => ({
  persistChanges: jest.fn((changes: { record: QuantitySample }[]) => {
    for (const c of changes) mockCache.samples.push(c.record);
  }),
  deleteOwnHeartRate: jest.fn((from: number, to: number) => {
    mockCache.samples = mockCache.samples.filter((s) => !(s.id.startsWith('strap:') && s.end >= from && s.end <= to));
  }),
  getZoneConfig: () => jest.requireActual('@loopfield/core').zonesFromMaxHr(190, 1),
  getConnection: () => mockCache.connection,
  getImportedMapsFlag: () => mockCache.mapsOn,
  setImportedMapsFlag: (on: boolean) => {
    mockCache.mapsOn = on;
  },
  getKeptRoute: (id: string) => (mockCache.routes.has(id) ? mockCache.routes.get(id) : undefined),
  keepRoute: (id: string, points: [number, number][] | null) => mockCache.routes.set(id, points),
  deleteKeptRoutes: () => mockCache.routes.clear()
}));
jest.mock('@/health/changes', () => ({ notifyHealthChanged: jest.fn(), onHealthChange: () => () => {}, healthVersion: () => 0 }));
jest.mock('@/health/healthconnect', () => ({ readExerciseRoute: jest.fn(async (id: string) => mockHc.routes[id] ?? { kind: 'none' }) }));
jest.mock('@/health/useHealth', () => {
  const actual = jest.requireActual('@/health/useHealth');
  return { ...actual, useHealthDerived: () => mockHealth.derived };
});
jest.mock('@/health/sync', () => ({ PLATFORM_LABEL: 'Health Connect' }));
jest.mock('@/features/map/MapCanvas', () => {
  const { Text } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return { MapCanvas: ({ layers, accessibilityLabel }: { layers: { path?: unknown[] }; accessibilityLabel: string }) => createElement(Text, { accessibilityLabel }, `map of ${layers.path?.length ?? 0} points`) };
});

const mockConfig: { raw: Record<string, unknown> } = { raw: {} };
const mockParams: { id?: string } = {};
const mockBle = {
  inBuild: true,
  access: 'granted' as string,
  nearby: [] as { id: string; name: string | null; rssi: number }[],
  connects: [] as string[],
  failNext: 0,
  packet: null as ((b: number[], at: number) => void) | null,
  lost: null as (() => void) | null
};
const mockCache = {
  samples: [] as QuantitySample[],
  connection: { connected: false, enabledCards: [] as string[] },
  mapsOn: false,
  routes: new Map<string, [number, number][] | null>()
};
const mockHc: { routes: Record<string, unknown> } = { routes: {} };
const mockHealth: { derived: { store: HealthStore; sessions: unknown[] } } = { derived: { store: emptyStore(), sessions: [] } };

const flush = () => act(async () => {
  await Promise.resolve();
});
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

beforeEach(async () => {
  mockConfig.raw = {};
  Object.assign(mockBle, { inBuild: true, access: 'granted', nearby: [], connects: [], failNext: 0, packet: null, lost: null });
  Object.assign(mockCache, { samples: [], connection: { connected: false, enabledCards: [] }, mapsOn: false });
  mockCache.routes.clear();
  mockHc.routes = {};
  mockHealth.derived = { store: emptyStore(), sessions: [] };
  delete mockParams.id;
  (track as jest.Mock).mockClear();
  _resetRunStrapForTests();
  _resetPairedStrapForTests();
  await AsyncStorage.clear();
});

describe('heart-rate strap settings and wording', () => {
  it('turns straps on by default and has a paused note', () => {
    expect(parseAppConfig(null).enabled.ble_sensors_enabled).toBe(true);
    expect(PAUSED_TEXT.ble_sensors_enabled).toMatch(/heart rate from your health app still counts/);
  });

  it('names straps, signals and batteries plainly', () => {
    expect([strapName(null), strapName(' H10 1A2B3C '), strapName('')]).toEqual(['Heart-rate strap', 'H10 1A2B3C', 'Heart-rate strap']);
    expect([signalWords(-55), signalWords(-72), signalWords(-90)]).toEqual(['Strong signal', 'Good signal', 'Weak signal']);
    expect(batteryWords(87, '2 min ago')).toBe('Battery 87% · checked 2 min ago');
    expect(batteryWords(null, null)).toBe('Battery level not reported');
  });
});

describe('the strap during a run', () => {
  const packet = (bpm: number) => [0x16, bpm, 0x2c, 0x03]; // 8-bit value, on the skin, one RR interval

  it('does nothing without a paired strap, or while straps are switched off', async () => {
    expect(await startStrapForRun('run1', true)).toBe(false);
    await savePairedStrap({ id: 'AA:BB', name: 'H10', battery: 80, batteryAt: 1 });
    expect(await startStrapForRun('run1', false)).toBe(false);
    expect(mockBle.connects).toEqual([]);
  });

  it('connects at the start, keeps one reading a second as the app’s own heart rate, and lets go at the end', async () => {
    await savePairedStrap({ id: 'AA:BB', name: 'H10', battery: 80, batteryAt: 1 });
    expect(await startStrapForRun('run1', true)).toBe(true);
    expect(mockBle.connects).toEqual(['AA:BB']);
    mockBle.packet!(packet(150), 10_000);
    mockBle.packet!(packet(151), 10_400); // within the same second: shown, not kept twice
    mockBle.packet!([0x04, 0], 11_000); // off the skin: ignored
    mockBle.packet!(packet(153), 12_000);
    expect(await stopStrapForRun()).toBe(2);
    expect(mockCache.samples.map((s) => [s.start, s.value, s.sourceKind, s.type])).toEqual([[10_000, 150, 'self', 'heart_rate'], [12_000, 153, 'self', 'heart_rate']]);
    expect(mockBle.packet).toBeNull();
    expect(heartRateFrom(2)).toBe('strap');
  });

  it('says when the strap drops out, keeps trying, and counts the reconnection once', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      await savePairedStrap({ id: 'AA:BB', name: null, battery: null, batteryAt: null });
      await startStrapForRun('run2', true);
      mockBle.packet!(packet(140), Date.now());
      mockBle.lost!();
      expect(track).toHaveBeenCalledWith('sensor', { action: 'dropped' });
      mockBle.failNext = 1;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(STRAP_TIMING.retryMs);
      });
      expect(mockBle.connects).toHaveLength(2);
      expect(track).not.toHaveBeenCalledWith('sensor', { action: 'reconnected' });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(STRAP_TIMING.retryMs);
      });
      expect(mockBle.connects).toHaveLength(3);
      expect(track).toHaveBeenCalledWith('sensor', { action: 'reconnected' });
      expect((track as jest.Mock).mock.calls.filter((c) => c[1]?.action === 'dropped')).toHaveLength(1);
      await stopStrapForRun();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a strap that never connects once, and retries quietly', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      await savePairedStrap({ id: 'AA:BB', name: null, battery: null, batteryAt: null });
      mockBle.failNext = 2;
      await startStrapForRun('run3', true);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(STRAP_TIMING.retryMs * 2);
      });
      expect((track as jest.Mock).mock.calls.filter((c) => c[1]?.action === 'connection_failed')).toHaveLength(1);
      expect(mockBle.connects).toHaveLength(3);
      await stopStrapForRun();
    } finally {
      jest.useRealTimers();
    }
  });

  it('deletes a discarded run’s strap readings', async () => {
    // A reading from an earlier run stays.
    mockCache.samples.push({ id: 'strap:1', type: 'heart_rate', value: 120, start: 1, end: 1, sourceId: 'loopfield-strap', sourceKind: 'self' } as QuantitySample);
    await savePairedStrap({ id: 'AA:BB', name: null, battery: null, batteryAt: null });
    await startStrapForRun('run4', true);
    // One reading already written during the run, one still waiting to be written.
    const t = Date.now();
    mockCache.samples.push({ id: `strap:${t}`, type: 'heart_rate', value: 148, start: t, end: t, sourceId: 'loopfield-strap', sourceKind: 'self' } as QuantitySample);
    mockBle.packet!(packet(150), t + 1000);
    await discardStrapForRun();
    expect(mockCache.samples.map((s) => s.id)).toEqual(['strap:1']);
  });

  it('shows the live value and zone, then the dropout warning', async () => {
    await savePairedStrap({ id: 'AA:BB', name: null, battery: null, batteryAt: null });
    await startStrapForRun('run5', true);
    function Probe() {
      const s = useStrapLive();
      return <Text>{`${s.status}:${s.bpm ?? '-'}`}</Text>;
    }
    await render(<Probe />);
    await act(async () => {
      mockBle.packet!(packet(163), Date.now());
    });
    expect(screen.getByText('connected:163')).toBeTruthy();
    await act(async () => {
      mockBle.lost!();
    });
    expect(screen.getByText('lost:163')).toBeTruthy();
    await act(async () => {
      await stopStrapForRun();
    });
    expect(screen.getByText('idle:-')).toBeTruthy();
  });

  it('says where a run’s heart rate came from', () => {
    expect(heartRateFrom(0)).toBe('none');
    mockCache.connection = { connected: true, enabledCards: ['workouts', 'heart_rate'] };
    expect(heartRateFrom(0)).toBe('health_app');
    expect(heartRateFrom(5)).toBe('strap');
  });

  it('counts the strap before a watch for the same minutes', () => {
    const store = emptyStore();
    const add = (s: Partial<QuantitySample> & { id: string; start: number; sourceKind: QuantitySample['sourceKind'] }) =>
      store.quantity.set(s.id, { type: 'heart_rate', value: 150, end: s.start, sourceId: s.sourceKind, ...s } as QuantitySample);
    add({ id: 'strap:0', start: 0, sourceKind: 'self' });
    add({ id: 'w1', start: 5000, sourceKind: 'watch' });
    add({ id: 'w2', start: 60_000, sourceKind: 'watch' });
    expect(quantities(store, 'heart_rate').map((s) => s.id).sort()).toEqual(['strap:0', 'w2']);
  });
});

describe('Settings → Sensors', () => {
  it('finds straps, pairs the one tapped, and shows it with its battery', async () => {
    mockBle.nearby = [{ id: 'far', name: null, rssi: -88 }, { id: 'near', name: 'TICKR 1234', rssi: -50 }];
    await render(<SensorsScreen />);
    await fireEvent.press(await screen.findByText('Add a heart-rate strap'));
    const rows = screen.getAllByLabelText(/Pair this strap$/);
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(['TICKR 1234, Strong signal. Pair this strap', 'Heart-rate strap, Weak signal. Pair this strap']);
    await fireEvent.press(rows[0]!);
    expect(await screen.findByText('TICKR 1234')).toBeTruthy();
    expect(screen.getByText(/^Battery 87% · checked/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('sensor', { action: 'paired' });
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toMatch(/TICKR|near|87/);
  });

  it('asks for Nearby devices when it was refused, and says when nothing was found', async () => {
    mockBle.access = 'denied';
    await render(<SensorsScreen />);
    await fireEvent.press(await screen.findByText('Add a heart-rate strap'));
    expect(screen.getByText(/needs the Nearby devices permission/)).toBeTruthy();
    mockBle.access = 'granted';
    await fireEvent.press(screen.getByText('Add a heart-rate strap'));
    expect(screen.getByText(/No strap found/)).toBeTruthy();
  });

  it('forgets a strap', async () => {
    await savePairedStrap({ id: 'AA:BB', name: 'H10', battery: null, batteryAt: null });
    await render(<SensorsScreen />);
    await fireEvent.press(await screen.findByText('Forget this strap'));
    expect(await screen.findByText('Add a heart-rate strap')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('sensor', { action: 'forgotten' });
  });

  it('shows the paused note and no way to add a strap while straps are switched off', async () => {
    mockConfig.raw = { ble_sensors_enabled: false };
    await render(<SensorsScreen />);
    await flush();
    expect(screen.getByText(PAUSED_TEXT.ble_sensors_enabled)).toBeTruthy();
    expect(screen.queryByText('Add a heart-rate strap')).toBeNull();
  });

  it('says the newer app is needed in builds without Bluetooth', async () => {
    mockBle.inBuild = false;
    await render(<SensorsScreen />);
    expect(screen.getByText('Needs the newer app')).toBeTruthy();
  });
});

describe('maps of imported runs', () => {
  let restoreOs: (() => void) | null = null;
  beforeEach(() => {
    const r = jest.replaceProperty(Platform, 'OS', 'android');
    restoreOs = () => r.restore();
  });
  afterEach(() => restoreOs?.());

  const route: [number, number][] = [[67.0, 24.86], [67.001, 24.861], [67.002, 24.862]];

  it('reads nothing while maps are off', async () => {
    expect(await showImportedRoute(['w1'], 0)).toEqual({ kind: 'unavailable' });
  });

  it('keeps a route once read, and says when a run has none or Android was not allowed to share it', async () => {
    setImportedMapsOn(true);
    expect(track).toHaveBeenCalledWith('imported_map', { action: 'turned_on' });
    mockHc.routes = { w1: { kind: 'route', points: route }, w2: { kind: 'none' }, w3: { kind: 'declined' } };
    expect(await showImportedRoute(['w1'], 0)).toEqual({ kind: 'route', points: route });
    expect(keptRouteFor(['w1'])).toEqual({ kind: 'route', points: route });
    expect(await showImportedRoute(['w2'], 0)).toEqual({ kind: 'none' });
    expect(keptRouteFor(['w2'])).toEqual({ kind: 'none' });
    expect(await showImportedRoute(['w3'], 0)).toEqual({ kind: 'declined' });
    expect(keptRouteFor(['w3'])).toBeNull();
    expect((track as jest.Mock).mock.calls.map((c) => c[1].action)).toEqual(['turned_on', 'shown', 'no_route', 'permission_declined']);
  });

  it('deletes every kept route when maps are turned off', async () => {
    setImportedMapsOn(true);
    mockHc.routes = { w1: { kind: 'route', points: route } };
    await showImportedRoute(['w1'], 0);
    setImportedMapsOn(false);
    expect(mockCache.routes.size).toBe(0);
    expect(track).toHaveBeenLastCalledWith('imported_map', { action: 'turned_off' });
  });

  it('asks for the primary source’s record first', () => {
    const store = emptyStore();
    store.workout.set('a', { id: 'a', activity: 'running', start: 0, end: 1, sourceId: 'phone', sourceKind: 'phone' });
    store.workout.set('b', { id: 'b', activity: 'running', start: 0, end: 1, sourceId: 'watch', sourceKind: 'watch' });
    expect(routeRecordIds({ recordIds: ['a', 'b'], primarySourceId: 'watch' }, store)).toEqual(['b', 'a']);
  });

  describe('the imported run page', () => {
    const session = { id: 'hs:w1', imported: true, activity: 'running', start: Date.UTC(2026, 10, 20, 6), end: Date.UTC(2026, 10, 20, 6, 40), distanceM: 8000, primarySourceId: 'com.example.runner', recordIds: ['w1'] };
    beforeEach(() => {
      mockParams.id = 'hs:w1';
      mockHealth.derived = { store: emptyStore(), sessions: [session] };
    });

    it('shows the numbers and asks for maps to be turned on first', async () => {
      await render(wrap(<ImportedRunScreen />));
      expect(screen.getByText('8.00 km')).toBeTruthy();
      expect(screen.getByText(/Turn on Show maps for imported runs/)).toBeTruthy();
      expect(screen.getByText(/never earn land, titles, points or challenges/)).toBeTruthy();
    });

    it('shows the map when asked, and keeps it for next time', async () => {
      mockCache.mapsOn = true;
      mockHc.routes = { w1: { kind: 'route', points: route } };
      const first = await render(wrap(<ImportedRunScreen />));
      await fireEvent.press(screen.getByText('Show map'));
      expect(await screen.findByText('map of 3 points')).toBeTruthy();
      await first.unmount();
      await render(wrap(<ImportedRunScreen />));
      expect(screen.getByText('map of 3 points')).toBeTruthy();
    });

    it('says when the run was saved without a map', async () => {
      mockCache.mapsOn = true;
      await render(wrap(<ImportedRunScreen />));
      await fireEvent.press(screen.getByText('Show map'));
      expect(await screen.findByText('This run was saved without a map.')).toBeTruthy();
    });

    it('hides maps while the back office suspends them', async () => {
      mockCache.mapsOn = true;
      mockConfig.raw = { disabled_health_cards: ['imported_routes'] };
      await render(wrap(<ImportedRunScreen />));
      expect(screen.queryByText('Show map')).toBeNull();
      expect(screen.queryByText('Map')).toBeNull();
    });

    it('says when the run is no longer on the phone', async () => {
      mockParams.id = 'hs:gone';
      await render(wrap(<ImportedRunScreen />));
      expect(screen.getByText("This run isn't on this phone any more")).toBeTruthy();
    });
  });
});
