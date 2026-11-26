import * as SQLite from 'expo-sqlite';
import { Paths } from 'expo-file-system';
import {
  applyChanges,
  emptyStore,
  RETENTION_RULES,
  type HealthChange,
  type HealthStore,
  type QuantitySample,
  type SleepSegment,
  type WorkoutRecord,
  type ZoneConfig
} from '@loopfield/core';

/**
 * Protected on-device health cache (PRD §9/§11): stored in the OS cache directory, which is excluded
 * from iCloud backup on iOS; Android app backup is disabled (allowBackup=false). Nothing in this
 * module is ever sent to the backend, analytics or crash reporting. Missing data stays missing.
 */
export type HealthCardId = 'heart_rate' | 'zones' | 'steps' | 'calories' | 'sleep' | 'resting_hr' | 'hrv' | 'vo2_max' | 'cadence' | 'elevation' | 'workouts';

export interface ConnectionState {
  platform: 'healthkit' | 'health_connect';
  connected: boolean;
  enabledCards: HealthCardId[];
  exportEnabled: boolean;
  lastSyncAt: number | null;
  lastResult: 'ok' | 'partial' | 'no_data' | 'unavailable' | 'error' | null;
  historyLimitedTo: number | null;
}

let db: SQLite.SQLiteDatabase | null = null;

function cacheDir(): string {
  return Paths.cache.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
}

export function healthDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync('health-cache.db', undefined, cacheDir());
  db.execSync(`
    create table if not exists records (tbl text not null, id text not null, json text not null, end_at integer not null, version integer, primary key (tbl, id));
    create index if not exists records_end on records (tbl, end_at);
    create table if not exists sync_cursor (key text primary key, value text not null, updated_at integer not null);
    create table if not exists kv (key text primary key, value text not null);
    create table if not exists routes (id text primary key, json text, end_at integer not null);
    create index if not exists routes_end on routes (end_at);
  `);
  return db;
}

export function loadStore(sinceMs = Date.now() - RETENTION_RULES.healthCacheDays.value * 86_400_000): HealthStore {
  const store = emptyStore();
  for (const r of healthDb().getAllSync<{ tbl: 'quantity' | 'workout' | 'sleep'; id: string; json: string }>('select tbl, id, json from records where end_at >= ?', [sinceMs])) {
    (store[r.tbl] as Map<string, unknown>).set(r.id, JSON.parse(r.json));
  }
  return store;
}

/** Persist upserts and deletions from the source store; older versions never overwrite newer ones. */
export function persistChanges(changes: HealthChange[]): void {
  const d = healthDb();
  const store = emptyStore();
  d.withTransactionSync(() => {
    for (const c of changes) {
      if (c.kind === 'delete') {
        d.runSync('delete from records where tbl = ? and id = ?', [c.table, c.id]);
        continue;
      }
      const rec = c.record as QuantitySample | WorkoutRecord | SleepSegment;
      const existing = d.getFirstSync<{ version: number | null }>('select version from records where tbl = ? and id = ?', [c.table, rec.id]);
      const incoming = (rec as { version?: number | null }).version ?? 0;
      if (existing && (existing.version ?? 0) > incoming) continue;
      d.runSync('insert or replace into records (tbl, id, json, end_at, version) values (?, ?, ?, ?, ?)', [c.table, rec.id, JSON.stringify(rec), rec.end, incoming]);
    }
  });
  applyChanges(store, changes); // validates the change set against the shared rules
}

export function pruneOld(): void {
  const cutoff = Date.now() - RETENTION_RULES.healthCacheDays.value * 86_400_000;
  healthDb().runSync('delete from records where end_at < ?', [cutoff]);
  healthDb().runSync('delete from routes where end_at < ?', [cutoff]);
}

/** Removes the app's own heart-rate readings (from a paired strap) taken between two times: a discarded run's. */
export function deleteOwnHeartRate(from: number, to: number): void {
  healthDb().runSync("delete from records where tbl = 'quantity' and id like 'strap:%' and end_at >= ? and end_at <= ?", [from, to]);
}

export function getCursor(key: string): string | null {
  return healthDb().getFirstSync<{ value: string }>('select value from sync_cursor where key = ?', [key])?.value ?? null;
}

export function setCursor(key: string, value: string): void {
  healthDb().runSync('insert or replace into sync_cursor (key, value, updated_at) values (?, ?, ?)', [key, value, Date.now()]);
}

function kvGet<T>(key: string, fallback: T): T {
  const r = healthDb().getFirstSync<{ value: string }>('select value from kv where key = ?', [key]);
  return r ? (JSON.parse(r.value) as T) : fallback;
}
function kvSet(key: string, value: unknown): void {
  healthDb().runSync('insert or replace into kv (key, value) values (?, ?)', [key, JSON.stringify(value)]);
}

export function getConnection(platform: ConnectionState['platform']): ConnectionState {
  return kvGet<ConnectionState>('connection', { platform, connected: false, enabledCards: [], exportEnabled: false, lastSyncAt: null, lastResult: null, historyLimitedTo: null });
}
export function saveConnection(c: ConnectionState): void {
  kvSet('connection', c);
}

export function getZoneConfig(): ZoneConfig | null {
  return kvGet<ZoneConfig | null>('zones', null);
}
export function saveZoneConfig(z: ZoneConfig): void {
  kvSet('zones', z);
}

export function getGoals(): { weeklyRuns: number | null; weeklyDistanceM: number | null } {
  return kvGet('goals', { weeklyRuns: 3, weeklyDistanceM: null });
}
export function saveGoals(g: { weeklyRuns: number | null; weeklyDistanceM: number | null }): void {
  kvSet('goals', g);
}

/** Maps of imported runs (R3): whether the runner turned them on, on this phone. */
export function getImportedMapsFlag(): boolean {
  return kvGet<boolean>('imported_maps', false) === true;
}
export function setImportedMapsFlag(on: boolean): void {
  kvSet('imported_maps', on);
}

/** A route kept for an imported workout: its points as [lng, lat], null when the run has none, undefined when not read yet. */
export function getKeptRoute(workoutId: string): [number, number][] | null | undefined {
  const r = healthDb().getFirstSync<{ json: string | null }>('select json from routes where id = ?', [workoutId]);
  return r ? (r.json ? (JSON.parse(r.json) as [number, number][] | null) : null) : undefined;
}
export function keepRoute(workoutId: string, points: [number, number][] | null, endAt: number): void {
  healthDb().runSync('insert or replace into routes (id, json, end_at) values (?, ?, ?)', [workoutId, points ? JSON.stringify(points) : null, endAt]);
}
export function deleteKeptRoutes(): void {
  healthDb().runSync('delete from routes where true');
}

/** Disconnect / sign-out / account deletion: remove every imported reading, route and derived value (FR51). */
export async function clearHealthCache(): Promise<void> {
  const d = healthDb();
  d.execSync('delete from records; delete from sync_cursor; delete from kv; delete from routes;');
}
