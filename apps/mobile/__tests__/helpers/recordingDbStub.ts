/**
 * A small in-memory stand-in for the phone's recording database (SQLite), for tests of the modules that keep
 * per-run state there (following a route, live shares, check-ins). It understands only the statements those
 * modules use: insert or replace, update by run (and by run and link), delete by run, one row or every row of
 * a run, and the samples of a run since a time. Use it with
 *   jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
 */
import type { LocationSample } from '@loopfield/core';

type RowMap = Map<string, Record<string, unknown>>;
export const tables: Record<string, RowMap> = {};
export const samples: Record<string, LocationSample[]> = {};

const table = (name: string): RowMap => (tables[name] ??= new Map());
/** Rows are keyed by run, and by run and link where a table has a token (a run can have several shares). */
const keyOf = (row: Record<string, unknown>) => (row.token != null ? `${String(row.session_id)}|${String(row.token)}` : String(row.session_id));

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
    const t = table(ins[1]!);
    t.delete(keyOf(row)); // replaced rows move to the end, as SQLite gives them a new rowid
    t.set(keyOf(row), row);
    return;
  }
  const upd = /^update (\w+) set (.+) where session_id = \?( and token = \?)?$/.exec(sql);
  if (upd) {
    // Each assignment is `col = ?` (the next parameter) or `col = <number>`.
    let i = 0;
    const sets = upd[2]!.split(',').map((c) => {
      const [col, v] = c.trim().split(' = ') as [string, string];
      return [col, v.trim() === '?' ? params[i++] : Number(v)] as const;
    });
    const session = String(params[i]);
    const token = upd[3] ? String(params[i + 1]) : null;
    for (const row of table(upd[1]!).values()) {
      if (String(row.session_id) !== session || (token != null && String(row.token) !== token)) continue;
      for (const [c, v] of sets) row[c] = v;
    }
    return;
  }
  const del = /^delete from (\w+) where session_id = \?$/.exec(sql);
  if (del) {
    const t = table(del[1]!);
    for (const [k, row] of [...t.entries()]) if (String(row.session_id) === String(params[0])) t.delete(k);
    return;
  }
  throw new Error(`unexpected statement: ${sql}`);
}

export function allRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const m = /^select \* from (\w+) where session_id = \?( order by rowid desc)?$/.exec(sql);
  if (!m) throw new Error(`unexpected query: ${sql}`);
  const rows = [...table(m[1]!).values()].filter((r) => String(r.session_id) === String(params[0]));
  return m[2] ? rows.reverse() : rows;
}

export function firstRow(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  return allRows(sql, params)[0] ?? null;
}

export const dbModule = {
  recordingDb: () => ({
    runSync: (sql: string, params?: unknown[]) => runSql(sql, params),
    getFirstSync: (sql: string, params?: unknown[]) => firstRow(sql, params),
    getAllSync: (sql: string, params?: unknown[]) => allRows(sql, params),
    withTransactionSync: (fn: () => void) => fn()
  }),
  samplesSince: (sessionId: string, sinceT: number) => (samples[sessionId] ?? []).filter((s) => s.t >= sinceT)
};

let seq = 0;
/** A location fix for tests. */
export function fix(p: { lat: number; lng: number }, t: number, acc = 5): LocationSample {
  return { seq: seq++, t, mono: null, lat: p.lat, lng: p.lng, acc, alt: null, altAcc: null, spd: null, hdg: null, mocked: false };
}
