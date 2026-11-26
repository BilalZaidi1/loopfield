import type { SQLiteDatabase } from 'expo-sqlite';
import { emptyStore, type HealthChange, type HealthStore, type ZoneConfig } from '@loopfield/core';
import type * as PhoneCache from './cache';

export type { ConnectionState, HealthCardId } from './cache';

/**
 * Browser version of the on-device health cache. Apple Health and Health Connect exist only in the phone
 * app, so the browser never holds health readings: the store is always empty and importing readings fails.
 * Personal settings that are not health data (weekly goals, heart-rate zone setup, the "not connected"
 * state) are kept in this browser's local storage under the same keys the phone app uses.
 */
const PREFIX = 'loopfield.health.';
const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown): void => {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the setting lasts until the page reloads.
  }
};

export function healthDb(): SQLiteDatabase {
  throw new Error('Health data is stored only in the Loopfield phone app.');
}
export function loadStore(_sinceMs?: number): HealthStore {
  return emptyStore();
}
export function persistChanges(changes: HealthChange[]): void {
  if (changes.length) throw new Error('Health data is stored only in the Loopfield phone app.');
}
export function pruneOld(): void {}
export function getCursor(_key: string): string | null {
  return null;
}
export function setCursor(_key: string, _value: string): void {}

export function getConnection(platform: PhoneCache.ConnectionState['platform']): PhoneCache.ConnectionState {
  return read<PhoneCache.ConnectionState>('connection', { platform, connected: false, enabledCards: [], exportEnabled: false, lastSyncAt: null, lastResult: null, historyLimitedTo: null });
}
export function saveConnection(c: PhoneCache.ConnectionState): void {
  write('connection', c);
}
export function getZoneConfig(): ZoneConfig | null {
  return read<ZoneConfig | null>('zones', null);
}
export function saveZoneConfig(z: ZoneConfig): void {
  write('zones', z);
}
export function getGoals(): { weeklyRuns: number | null; weeklyDistanceM: number | null } {
  return read('goals', { weeklyRuns: 3, weeklyDistanceM: null });
}
export function saveGoals(g: { weeklyRuns: number | null; weeklyDistanceM: number | null }): void {
  write('goals', g);
}
export function deleteOwnHeartRate(_from: number, _to: number): void {}
export function getImportedMapsFlag(): boolean {
  return false;
}
export function setImportedMapsFlag(_on: boolean): void {}
export function getKeptRoute(_workoutId: string): [number, number][] | null | undefined {
  return undefined;
}
export function keepRoute(_workoutId: string, _points: [number, number][] | null, _endAt: number): void {
  throw new Error('Health data is stored only in the Loopfield phone app.');
}
export function deleteKeptRoutes(): void {}
export async function clearHealthCache(): Promise<void> {
  try {
    for (const key of ['connection', 'zones', 'goals']) globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    // Nothing stored.
  }
}

// Compile-time check that this file offers every function the phone version does, with compatible types.
const sameShape = { healthDb, loadStore, persistChanges, pruneOld, deleteOwnHeartRate, getCursor, setCursor, getConnection, saveConnection, getZoneConfig, saveZoneConfig, getGoals, saveGoals, getImportedMapsFlag, setImportedMapsFlag, getKeptRoute, keepRoute, deleteKeptRoutes, clearHealthCache } satisfies {
  [K in keyof typeof PhoneCache]: (...args: never[]) => ReturnType<(typeof PhoneCache)[K]>;
};
void sameShape;
