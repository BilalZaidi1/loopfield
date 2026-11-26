/**
 * A small in-memory stand-in for the phone's recording database (SQLite), for tests of the modules that keep
 * per-run state there (following a route, live links, check-ins). It understands only the statements those
 * modules use: insert or replace, update by session, delete by session, select one row by session, and the
 * samples of a run since a time. Use it with
 *   jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
 */
import type { LocationSample } from '@loopfield/core';

export const tables: Record<string, Map<string, Record<string, unknown>>> = {};
export const samples: Record<string, LocationSample[]> = {};

const table = (name: string) => (tables[name] ??= new Map());

export function resetDb(): void {
  for (const t of Object.values(tables)) t.clear();
  for (const k of Object.keys(samples)) delete samples[k];
}

export function runSql(sql: string, params: unknown[] = []): void {
  const ins = /^insert or replace into (\w+) \(([^)]+)\) values \(([^)]+)\)$/.exec(sql);
  if (ins) {
    const cols = ins[2]!.split(',').map((c) => c.trim());
    let i = 0;
    const vals = ins[3]!.split(',').map((v) => v.trim()).map((v) => (v === '?' ? params[i++] : Number(v)));
    const row = Object.fromEntries(cols.map((c, k) => [c, vals[k]]));
    table(ins[1]!).set(String(row.session_id), row);
    return;
  }
  const upd = /^update (\w+) set (.+) where session_id = \?$/.exec(sql);
  if (upd) {
    const cols = upd[2]!.split(',').map((c) => c.trim().split(' = ')[0]!);
    const row = table(upd[1]!).get(String(params[cols.length]));
    if (row) cols.forEach((c, k) => (row[c] = params[k]));
    return;
  }
  const del = /^delete from (\w+) where session_id = \?$/.exec(sql);
  if (del) {
    table(del[1]!).delete(String(params[0]));
    return;
  }
  throw new Error(`unexpected statement: ${sql}`);
}

export function firstRow(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  const m = /^select \* from (\w+) where session_id = \?$/.exec(sql);
  if (!m) throw new Error(`unexpected query: ${sql}`);
  return table(m[1]!).get(String(params[0])) ?? null;
}

export const dbModule = {
  recordingDb: () => ({
    runSync: (sql: string, params?: unknown[]) => runSql(sql, params),
    getFirstSync: (sql: string, params?: unknown[]) => firstRow(sql, params),
    withTransactionSync: (fn: () => void) => fn()
  }),
  samplesSince: (sessionId: string, sinceT: number) => (samples[sessionId] ?? []).filter((s) => s.t >= sinceT)
};

let seq = 0;
/** A location fix for tests. */
export function fix(p: { lat: number; lng: number }, t: number, acc = 5): LocationSample {
  return { seq: seq++, t, mono: null, lat: p.lat, lng: p.lng, acc, alt: null, altAcc: null, spd: null, hdg: null, mocked: false };
}
