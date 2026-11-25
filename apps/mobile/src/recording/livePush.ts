import type { LocationSample } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { recordingDb, samplesSince } from './db';

/**
 * Sending the runner's position while a run is shared (R1 live links, R2 live runs with friends). Each share
 * is kept with the run on the phone; after fixes are saved (in the background task too) one push sends the
 * newest fixes to every share of the run: at most one fix every ten seconds and ten per push, no more often
 * than the update interval. There is no queue: with no signal, the next push simply sends the newest fixes.
 * Positions go only to the run's shares, never to analytics or logs.
 */

/** A live link the runner sends (for this run, or the standing link). */
export type LiveKind = 'run' | 'standing';
/** Every way a run can be shared live: a live link, or friends who follow each other. */
export type ShareKind = LiveKind | 'friends';
export type LiveState = 'running' | 'paused' | 'finished';

export interface LiveShareRow {
  session_id: string;
  token: string;
  kind: ShareKind;
  every_s: number;
  last_push_at: number;
  last_sent_t: number;
  state: LiveState;
  views: number;
  ended: number;
}

/** The link chosen before GO, waiting for the run to start. */
let pending: { token: string; kind: LiveKind } | null = null;

export function setPendingLiveShare(share: { token: string; kind: LiveKind } | null): void {
  pending = share;
}

export function pendingLiveShare(): { token: string; kind: LiveKind } | null {
  return pending;
}

export function attachLiveShare(sessionId: string, token: string, kind: ShareKind, everyS: number): void {
  try {
    recordingDb().runSync(
      'insert or replace into live_shares (session_id, token, kind, every_s, last_push_at, last_sent_t, state, views, ended) values (?, ?, ?, ?, 0, 0, ?, 0, 0)',
      [sessionId, token, kind, everyS, 'running']
    );
  } catch (e) {
    log.warn(`could not keep the live share: ${String(e)}`);
  }
}

/** Every share of a run, newest first. */
export function liveSharesFor(sessionId: string): LiveShareRow[] {
  return recordingDb().getAllSync<LiveShareRow>('select * from live_shares where session_id = ? order by rowid desc', [sessionId]);
}

/** The run's live link (the one the runner sent), if any. */
export function liveShareFor(sessionId: string): LiveShareRow | null {
  return liveSharesFor(sessionId).find((s) => s.kind !== 'friends') ?? null;
}

/** The run's share with friends, if any. */
export function friendsShareFor(sessionId: string): LiveShareRow | null {
  return liveSharesFor(sessionId).find((s) => s.kind === 'friends') ?? null;
}

function update(sessionId: string, token: string, patch: Partial<Pick<LiveShareRow, 'last_push_at' | 'last_sent_t' | 'every_s' | 'state' | 'ended'>>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  recordingDb().runSync(`update live_shares set ${keys.map((k) => `${k} = ?`).join(', ')} where session_id = ? and token = ?`, [...keys.map((k) => patch[k] as never), sessionId, token]);
}

/** The newest fixes worth sending: at most one every `minGapMs`, always the latest, at most `max`. */
export function thinFixes(samples: readonly LocationSample[], minGapMs = 10_000, max = 10): LocationSample[] {
  const out: LocationSample[] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    if (!last || s.t - last.t >= minGapMs) out.push(s);
  }
  const newest = samples[samples.length - 1];
  if (newest && out[out.length - 1] !== newest) out.push(newest);
  return out.slice(-max);
}

let pushing = false;

/**
 * Sends what is new to every open share of the run in one request. `force` skips the interval (start, pause,
 * resume, finish); the server still refuses pushes that come too fast, and the phone just waits for the next.
 */
export async function pushLive(sessionId: string, opts: { state?: LiveState; force?: boolean } = {}, now = Date.now()): Promise<void> {
  if (pushing) return;
  let open: LiveShareRow[];
  try {
    open = liveSharesFor(sessionId).filter((s) => !s.ended);
  } catch {
    return;
  }
  if (!open.length) return;
  const every = Math.min(...open.map((s) => s.every_s));
  const lastPush = Math.max(...open.map((s) => s.last_push_at));
  if (!opts.force && now - lastPush < every * 1000) return;
  const state = opts.state ?? open[0]!.state ?? 'running';
  pushing = true;
  try {
    const since = Math.min(...open.map((s) => s.last_sent_t));
    const picked = thinFixes(samplesSince(sessionId, since + 1));
    const res = await rpc<{ ok: boolean; every_seconds?: number; links?: Record<string, string> }>('live_push', {
      p_session: sessionId,
      p_tokens: open.map((s) => s.token),
      p_state: state,
      p_points: picked.map((s) => ({ t: s.t, lat: Math.round(s.lat * 1e6) / 1e6, lng: Math.round(s.lng * 1e6) / 1e6, acc: s.acc }))
    });
    for (const share of open) {
      const answer = res.links?.[share.token] ?? (res.ok ? 'ok' : 'error');
      if (answer === 'ok') {
        update(sessionId, share.token, { last_push_at: now, last_sent_t: picked.length ? picked[picked.length - 1]!.t : share.last_sent_t, every_s: res.every_seconds ?? share.every_s, state, ended: state === 'finished' ? 1 : 0 });
      } else if (answer === 'ended') {
        update(sessionId, share.token, { ended: 1 });
      } else {
        update(sessionId, share.token, { last_push_at: now });
      }
    }
  } catch (e) {
    // Offline or a server error: try again at the next interval. Never logs the position.
    log.warn(`live update not sent: ${e instanceof Error ? e.name : 'error'}`);
    try {
      for (const share of open) update(sessionId, share.token, { last_push_at: now });
    } catch {
      // nothing more to do
    }
  } finally {
    pushing = false;
  }
}

/** Stop the live link now (the runner tapped Stop sharing). Sharing with friends carries on. */
export async function stopLiveShare(sessionId: string): Promise<void> {
  const share = liveShareFor(sessionId);
  if (!share) return;
  try {
    update(sessionId, share.token, { ended: 1 });
  } catch {
    // keep going: the server call still ends the link
  }
  await rpc('live_link_end', { p_token: share.token }).catch(() => {});
}

/** Stop sharing this run with friends now (the live link, if any, carries on). */
export async function stopFriendsShare(sessionId: string): Promise<void> {
  const share = friendsShareFor(sessionId);
  if (!share || share.ended) return;
  try {
    update(sessionId, share.token, { ended: 1 });
  } catch {
    // the server call still ends it
  }
  await rpc('live_link_end', { p_token: share.token }).catch(() => {});
}

/** Stop every share of the run (the run was discarded). */
export async function stopAllShares(sessionId: string): Promise<void> {
  let shares: LiveShareRow[] = [];
  try {
    shares = liveSharesFor(sessionId).filter((s) => !s.ended);
  } catch {
    return;
  }
  for (const share of shares) {
    try {
      update(sessionId, share.token, { ended: 1 });
    } catch {
      // the server call below still ends it
    }
    await rpc('live_link_end', { p_token: share.token }).catch(() => {});
  }
}

/**
 * Live runs with friends (R2): when the runner shares with friends, the run gets its own share at the start.
 * Nothing is shared when sharing is off or nobody is chosen; a failure never stops the run.
 */
export async function startFriendsShare(sessionId: string, audience: 'all' | 'chosen'): Promise<boolean> {
  try {
    const r = await rpc<{ ok: boolean; token?: string; every_seconds?: number }>('friends_live_start', { p_session: sessionId });
    if (!r.ok || !r.token) return false;
    attachLiveShare(sessionId, r.token, 'friends', r.every_seconds ?? 30);
    track('friends_live', { action: 'run_shared', audience });
    return true;
  } catch (e) {
    log.warn(`friends share not started: ${e instanceof Error ? e.name : 'error'}`);
    return false;
  }
}

/** Test-only reset of module state. */
export function _resetLivePushForTests(): void {
  pushing = false;
  pending = null;
}
