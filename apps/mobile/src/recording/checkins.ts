import { rpc } from '@/lib/api';
import { log } from '@/lib/log';
import { recordingDb } from './db';

/**
 * Runners out right now (R2): while a run records, the phone tells the server "still running" when the run
 * starts, about every five minutes after that (from the background task too) and when it ends. No position,
 * route or health data is sent: only the run's id. The server counts the runner under the city and country
 * on their profile. A runner who opted out sends nothing; the server also ignores them.
 */
export const CHECKIN_EVERY_MS = 5 * 60_000;

interface CheckinRow {
  session_id: string;
  counted: number;
  last_ping_at: number;
  ended: number;
}

export function attachCheckins(sessionId: string, counted: boolean): void {
  try {
    recordingDb().runSync('insert or replace into checkins (session_id, counted, last_ping_at, ended) values (?, ?, 0, 0)', [sessionId, counted ? 1 : 0]);
  } catch (e) {
    log.warn(`check-ins not kept: ${e instanceof Error ? e.name : 'error'}`);
  }
}

function checkinFor(sessionId: string): CheckinRow | null {
  try {
    return recordingDb().getFirstSync<CheckinRow>('select * from checkins where session_id = ?', [sessionId]);
  } catch {
    return null;
  }
}

let sending = false;

/** "Still running", at most every five minutes unless forced (start and resume). */
export async function pingRunningNow(sessionId: string, opts: { force?: boolean } = {}, now = Date.now()): Promise<void> {
  const row = checkinFor(sessionId);
  if (!row || !row.counted || row.ended || sending) return;
  if (!opts.force && now - row.last_ping_at < CHECKIN_EVERY_MS) return;
  sending = true;
  try {
    recordingDb().runSync('update checkins set last_ping_at = ? where session_id = ?', [now, sessionId]);
    const r = await rpc<{ ok: boolean; reason?: string }>('running_now_ping', { p_session: sessionId });
    // Opted out on another phone, or the feature is off: stop for this run.
    if (!r.ok && (r.reason === 'opted_out' || r.reason === 'inactive')) recordingDb().runSync('update checkins set ended = 1 where session_id = ?', [sessionId]);
  } catch (e) {
    log.warn(`check-in not sent: ${e instanceof Error ? e.name : 'error'}`);
  } finally {
    sending = false;
  }
}

/** The run finished or was discarded: the runner stops counting at once. */
export async function endRunningNow(sessionId: string): Promise<void> {
  const row = checkinFor(sessionId);
  if (!row || row.ended) return;
  try {
    recordingDb().runSync('update checkins set ended = 1 where session_id = ?', [sessionId]);
  } catch {
    // the server call still takes the runner out
  }
  if (row.counted) await rpc('running_now_end', { p_session: sessionId }).catch(() => {});
}

/** Test-only reset of module state. */
export function _resetCheckinsForTests(): void {
  sending = false;
}
