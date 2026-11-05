/* eslint-disable @typescript-eslint/no-require-imports -- each test loads the modules afresh for one runtime */
/**
 * Expo Go ships without Mapbox, HealthKit, Health Connect and background location. These tests load the app's
 * modules as they would run there (and in a real build) and check that nothing missing is loaded, that the
 * features say they are unavailable, and that recording falls back to foreground-only location updates.
 */
type Env = 'storeClient' | 'bare';

const mockLoaded = { healthkit: 0, healthConnect: 0, mapbox: 0 };
const mockLocation = {
  hasServicesEnabledAsync: jest.fn(async () => true),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  watchPositionAsync: jest.fn(async (_opts: unknown, _cb: (loc: unknown) => void) => ({ remove: mockWatchRemove })),
  Accuracy: { BestForNavigation: 6, Balanced: 3 },
  ActivityType: { Fitness: 3 }
};
const mockWatchRemove = jest.fn();
const mockKeepAwake = { activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) };
const mockDb = {
  session: null as null | { id: string; state: string; mode: string; capture_state: string; speed_state: string },
  appendSamples: jest.fn(() => 1),
  addEvent: jest.fn(),
  setSessionState: jest.fn((id: string, patch: { state?: string }) => {
    if (mockDb.session && mockDb.session.id === id && patch.state) mockDb.session.state = patch.state;
  })
};

function load(env: Env) {
  jest.resetModules();
  Object.assign(mockLoaded, { healthkit: 0, healthConnect: 0, mapbox: 0 });
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { executionEnvironment: env, expoConfig: { version: '0.1.0', extra: { appEnv: 'preview' } } },
    ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' }
  }));
  // Loading these in Expo Go throws, as the real packages do there.
  jest.doMock('@kingstinct/react-native-healthkit', () => {
    mockLoaded.healthkit++;
    throw new Error('NitroModules are not supported in Expo Go!');
  });
  jest.doMock('react-native-health-connect', () => {
    mockLoaded.healthConnect++;
    throw new Error('native module RNHealthConnect not found');
  });
  jest.doMock('@rnmapbox/maps', () => {
    mockLoaded.mapbox++;
    throw new Error("TurboModuleRegistry.getEnforcing(...): 'RNMBXModule' could not be found");
  });
  jest.doMock('@/health/cache', () => ({ getCursor: () => null, setCursor: () => {}, getConnection: () => ({ connected: false }), saveConnection: () => {}, clearHealthCache: async () => {}, persistChanges: () => {}, pruneOld: () => {} }));
  jest.doMock('@/lib/analytics', () => ({ track: jest.fn() }));
  jest.doMock('@/lib/cues', () => ({ emitCue: jest.fn() }));
  jest.doMock('@/lib/api', () => ({ callFunction: jest.fn() }));
  jest.doMock('expo-crypto', () => ({ randomUUID: () => 'session-1' }));
  jest.doMock('expo-location', () => mockLocation);
  jest.doMock('expo-keep-awake', () => mockKeepAwake);
  jest.doMock('@/recording/task', () => ({ LOCATION_TASK: 'loopfield-run-recording' }));
  jest.doMock('@/recording/db', () => ({
    activeSession: () => mockDb.session,
    getSession: (id: string) => (mockDb.session?.id === id ? mockDb.session : null),
    appendSamples: mockDb.appendSamples,
    addEvent: mockDb.addEvent,
    setSessionState: mockDb.setSessionState,
    eventsFor: () => [],
    samplesFor: () => [],
    recordingDb: () => ({ runSync: jest.fn() })
  }));
}

const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation.startLocationUpdatesAsync.mockImplementation(async () => {});
  mockDb.session = { id: 'session-1', state: 'ready', mode: 'private', capture_state: 'none', speed_state: 'none' };
});

afterAll(() => warn.mockRestore());

describe('in Expo Go', () => {
  it('detects Expo Go', () => {
    load('storeClient');
    expect(require('@/lib/runtime').isExpoGo).toBe(true);
  });

  it('never loads the health modules and reports health as unavailable, saying why', async () => {
    load('storeClient');
    const sync = require('@/health/sync');
    await expect(sync.platformAvailability()).resolves.toBe('unavailable');
    expect(mockLoaded.healthkit).toBe(0);
    expect(mockLoaded.healthConnect).toBe(0);
    expect(sync.UNAVAILABLE_BADGE).toBe('Not in Expo Go');
    expect(sync.UNAVAILABLE_TEXT).toMatch(/not included in Expo Go/);
  });

  it('never loads Mapbox and explains that maps need the installed app', () => {
    load('storeClient');
    const { mapAvailability } = require('@/features/map/MapCanvas');
    expect(mockLoaded.mapbox).toBe(0);
    expect(mapAvailability()).toEqual({ ok: false, reason: expect.stringMatching(/not included in Expo Go/) });
  });

  it('does not ask for background location, which Expo Go cannot use', async () => {
    load('storeClient');
    const { ensureLocationPermission } = require('@/recording/recorder');
    await expect(ensureLocationPermission()).resolves.toBe('foreground_only');
    expect(mockLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('records with foreground location updates, keeps the screen on, and stops both on pause', async () => {
    load('storeClient');
    const recorder = require('@/recording/recorder');
    await recorder.startRun('session-1', { startCaptureNow: false, startSpeedNow: false });
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(mockKeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('loopfield-recording');
    expect(recorder.recordingInForegroundOnly()).toBe(true);

    const deliver = mockLocation.watchPositionAsync.mock.calls[0]![1];
    const fix = { timestamp: 1_700_000_000_000, coords: { latitude: 24.9, longitude: 67.05, accuracy: 5, altitude: null, altitudeAccuracy: null, speed: 3, heading: 90 } };
    deliver(fix);
    expect(mockDb.appendSamples).toHaveBeenCalledWith('session-1', [fix]);

    await expect(recorder.checkRecovery()).resolves.toEqual({ kind: 'running', sessionId: 'session-1' });

    await recorder.pauseRun('session-1');
    expect(mockWatchRemove).toHaveBeenCalledTimes(1);
    expect(mockKeepAwake.deactivateKeepAwake).toHaveBeenCalledWith('loopfield-recording');
    expect(recorder.recordingInForegroundOnly()).toBe(false);
  });

  it('marks a run as interrupted after a reload instead of pretending it kept recording', async () => {
    load('storeClient');
    const recorder = require('@/recording/recorder');
    mockDb.session!.state = 'recording';
    await expect(recorder.checkRecovery()).resolves.toMatchObject({ kind: 'interrupted', sessionId: 'session-1' });
    expect(mockLocation.hasStartedLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockDb.addEvent).toHaveBeenCalledWith('session-1', 'interrupted', null, expect.any(Number));
  });
});

describe('in a Loopfield build', () => {
  it('logs a missing native module instead of crashing', () => {
    load('bare');
    const { optionalNativeModule } = require('@/lib/runtime');
    expect(optionalNativeModule('@kingstinct/react-native-healthkit', () => require('@kingstinct/react-native-healthkit'))).toBeNull();
    expect(mockLoaded.healthkit).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('native module @kingstinct/react-native-healthkit unavailable'));
  });

  it('records with background location updates when the phone allows them', async () => {
    load('bare');
    const recorder = require('@/recording/recorder');
    await expect(recorder.ensureLocationPermission()).resolves.toBe('granted');
    await recorder.startRun('session-1', { startCaptureNow: false, startSpeedNow: false });
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledWith('loopfield-run-recording', expect.objectContaining({ showsBackgroundLocationIndicator: true }));
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    expect(recorder.recordingInForegroundOnly()).toBe(false);
  });

  it('falls back to recording while the app is open when background updates are refused', async () => {
    load('bare');
    mockLocation.startLocationUpdatesAsync.mockImplementation(async () => {
      throw new Error('Background location has not been configured');
    });
    const recorder = require('@/recording/recorder');
    await recorder.startRun('session-1', { startCaptureNow: false, startSpeedNow: false });
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(recorder.recordingInForegroundOnly()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('background location updates unavailable'));
    await recorder.finishRun('session-1');
    expect(mockWatchRemove).toHaveBeenCalledTimes(1);
    expect(recorder.recordingInForegroundOnly()).toBe(false);
  });
});
