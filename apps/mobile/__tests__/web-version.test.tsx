/* eslint-disable @typescript-eslint/no-require-imports -- the browser-only modules are loaded by path */
/**
 * The browser version swaps three phone-only pieces for web ones: the recording store (no recording in a
 * browser), the health cache (no health data in a browser; goals and zone setup in browser storage) and the
 * system alert (an in-app dialog, because React Native's Alert does nothing on the web).
 */
import { Alert, Linking, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});
afterAll(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('browser health cache', () => {
  const cache = require('@/health/cache.web') as typeof import('@/health/cache');

  it('keeps goals and heart-rate zone setup in browser storage and clears them on request', async () => {
    expect(cache.getGoals()).toEqual({ weeklyRuns: 3, weeklyDistanceM: null });
    cache.saveGoals({ weeklyRuns: 4, weeklyDistanceM: 20_000 });
    expect(cache.getGoals()).toEqual({ weeklyRuns: 4, weeklyDistanceM: 20_000 });
    await cache.clearHealthCache();
    expect(cache.getGoals()).toEqual({ weeklyRuns: 3, weeklyDistanceM: null });
  });

  it('never holds health readings', () => {
    expect(cache.loadStore().quantity.size).toBe(0);
    expect(cache.getConnection('healthkit').connected).toBe(false);
    expect(() => cache.persistChanges([{ kind: 'delete', table: 'quantity', id: 'x' } as never])).toThrow(/phone app/);
  });
});

describe('browser recording store', () => {
  const db = require('@/recording/db.web') as typeof import('@/recording/db');

  it('has no local runs and refuses to record instead of pretending to', () => {
    expect(db.activeSession()).toBeNull();
    expect(db.recentLocalRuns('u1')).toEqual([]);
    expect(db.pendingUploads('u1')).toEqual([]);
    expect(db.recordingDb().getFirstSync('select 1')).toBeNull();
    expect(() => db.addEvent('s1', 'start')).toThrow(/phone app/);
    expect(() => db.recordingDb().runSync('insert into sessions values (1)')).toThrow(/phone app/);
  });
});

describe('browser alerts', () => {
  const originalAlert = Alert.alert;
  const originalOpenSettings = Linking.openSettings;
  afterEach(() => {
    Alert.alert = originalAlert;
    Linking.openSettings = originalOpenSettings;
    jest.restoreAllMocks();
  });

  it('shows Alert.alert as an in-app dialog and runs the chosen button', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const { installWebShims, WebAlertHost } = require('@/components/WebAlertHost');
    installWebShims();
    await render(<WebAlertHost />);
    const onLeave = jest.fn();
    await act(async () => Alert.alert('Leave this club?', 'You can ask to join again later.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: onLeave }]));
    expect(screen.getByText('Leave this club?')).toBeTruthy();
    expect(screen.getByText('You can ask to join again later.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Leave this club?')).toBeNull();
  });

  it('explains browser site settings instead of failing when the app asks to open settings', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const { installWebShims, WebAlertHost } = require('@/components/WebAlertHost');
    installWebShims();
    await render(<WebAlertHost />);
    await act(async () => Linking.openSettings());
    expect(screen.getByText('Browser settings')).toBeTruthy();
  });

  it('leaves the system alert alone on phones', () => {
    const { installWebShims } = require('@/components/WebAlertHost');
    installWebShims();
    expect(Alert.alert).toBe(originalAlert);
  });
});
