import { Platform } from 'react-native';
import type { HealthChange } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { isExpoGo } from '@/lib/runtime';
import { clearHealthCache, getConnection, persistChanges, pruneOld, saveConnection, type ConnectionState, type HealthCardId } from './cache';
import { healthKitAvailable, requestHealthKit, syncHealthKit } from './healthkit';
import { healthConnectStatus, requestHealthConnect, revokeHealthConnect, syncHealthConnect } from './healthconnect';

const isWeb = Platform.OS === 'web';
export const HEALTH_PLATFORM: ConnectionState['platform'] = Platform.OS === 'ios' ? 'healthkit' : 'health_connect';
export const PLATFORM_LABEL = Platform.OS === 'ios' ? 'Apple Health' : isWeb ? 'Apple Health / Health Connect' : 'Health Connect';
export const STALE_AFTER_MS = 24 * 3_600_000;

/** Why health data cannot be connected here: the device, Expo Go (no health modules), or the browser version. */
export const UNAVAILABLE_BADGE = isWeb ? 'Phone app only' : isExpoGo ? 'Not in Expo Go' : 'Not supported on this device';
export const UNAVAILABLE_TEXT = isWeb
  ? 'Apple Health and Health Connect connect only in the Loopfield phone app, so the browser version cannot show health data. Competition and social features work without them.'
  : isExpoGo
    ? `${PLATFORM_LABEL} is not included in Expo Go, so it cannot be connected here. The installed Loopfield app can connect it. Recording, competition and social features work without it.`
    : `${PLATFORM_LABEL} is not available on this device. Recording, competition and social features work without it.`;

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

/** Lightweight change signal so on-device health views refresh after a sync or a clear. */
export function onHealthChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function healthVersion(): number {
  return version;
}
function bump(): void {
  version++;
  for (const l of listeners) l();
}

export type Availability = 'available' | 'needs_update' | 'unavailable';

export async function platformAvailability(): Promise<Availability> {
  if (Platform.OS === 'ios') return (await healthKitAvailable()) ? 'available' : 'unavailable';
  if (Platform.OS === 'android') return healthConnectStatus();
  return 'unavailable';
}

/** Connect with only the data types needed for the chosen cards (FR46). Write access is a separate, optional choice. */
export async function connectHealth(cards: HealthCardId[], exportWorkouts: boolean): Promise<ConnectionState> {
  const availability = await platformAvailability();
  if (availability !== 'available') {
    const c = { ...getConnection(HEALTH_PLATFORM), connected: false, lastResult: 'unavailable' as const };
    saveConnection(c);
    track('health_sync_status', { connector: HEALTH_PLATFORM, result: 'unavailable', failure_category: 'platform_unavailable' });
    return c;
  }
  if (Platform.OS === 'ios') {
    await requestHealthKit(cards, exportWorkouts);
  } else {
    await requestHealthConnect(cards, exportWorkouts);
  }
  track('permission_outcome', { category: 'health_read', outcome: 'unknown', os_family: Platform.OS === 'ios' ? 'ios' : 'android' });
  const c: ConnectionState = { ...getConnection(HEALTH_PLATFORM), platform: HEALTH_PLATFORM, connected: true, enabledCards: cards, exportEnabled: exportWorkouts };
  saveConnection(c);
  bump();
  await syncHealth().catch((e) => log.warn(`initial health sync failed: ${String(e)}`));
  return getConnection(HEALTH_PLATFORM);
}

let syncing: Promise<ConnectionState> | null = null;

/** Incremental sync: applies updates and deletions from the platform store; never uploads anything. */
export function syncHealth(): Promise<ConnectionState> {
  if (syncing) return syncing;
  syncing = (async () => {
    const c = getConnection(HEALTH_PLATFORM);
    if (!c.connected) return c;
    let changes: HealthChange[] = [];
    let historyLimitedTo: number | null = c.historyLimitedTo;
    let result: ConnectionState['lastResult'] = 'ok';
    let failure: 'none' | 'permission' | 'platform_unavailable' | 'timeout' | 'unknown' = 'none';
    try {
      if (Platform.OS === 'ios') {
        changes = await syncHealthKit(c.enabledCards);
        historyLimitedTo = 90;
      } else {
        const r = await syncHealthConnect(c.enabledCards);
        changes = r.changes;
        historyLimitedTo = r.historyLimitedTo;
      }
      persistChanges(changes);
      pruneOld();
      if (!changes.length && c.lastSyncAt == null) result = 'no_data';
    } catch (e) {
      result = 'error';
      const msg = String(e);
      failure = /permission|authoriz|SecurityException/i.test(msg) ? 'permission' : /timeout/i.test(msg) ? 'timeout' : 'unknown';
      log.warn(`health sync failed (${failure})`);
    }
    const next: ConnectionState = { ...c, lastSyncAt: result === 'error' ? c.lastSyncAt : Date.now(), lastResult: result, historyLimitedTo };
    saveConnection(next);
    track('health_sync_status', { connector: HEALTH_PLATFORM, result: result ?? 'error', failure_category: failure });
    bump();
    return next;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export function setEnabledCards(cards: HealthCardId[]): void {
  saveConnection({ ...getConnection(HEALTH_PLATFORM), enabledCards: cards });
  bump();
}

/**
 * Disconnect: stop syncing and delete every imported reading and derived value from this device
 * (FR51). Health Connect permissions are revoked programmatically; iOS requires the Health app.
 */
export async function disconnectHealth(): Promise<{ revokedInApp: boolean }> {
  let revokedInApp = false;
  if (Platform.OS === 'android') {
    try {
      revokedInApp = await revokeHealthConnect();
    } catch (e) {
      log.warn(`health connect revoke failed: ${String(e)}`);
    }
  }
  await clearHealthCache();
  saveConnection({ platform: HEALTH_PLATFORM, connected: false, enabledCards: [], exportEnabled: false, lastSyncAt: null, lastResult: null, historyLimitedTo: null });
  bump();
  return { revokedInApp };
}

export async function clearHealthData(): Promise<void> {
  const c = getConnection(HEALTH_PLATFORM);
  await clearHealthCache();
  saveConnection({ ...c, lastSyncAt: null, lastResult: null });
  bump();
}
