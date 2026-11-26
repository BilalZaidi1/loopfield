import type { LocationSample } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { log } from '@/lib/log';
import { recordingDb, samplesSince } from './db';

/**
 * Sending the runner's position to their live link (R1). The link is kept with the run on the phone; after
 * fixes are saved (in the background task too) the newest fixes since the last push are sent, at most one
 * every ten seconds and ten per push, no more often than the update interval. There is no queue: if the phone
 * has no signal, the next push simply sends the newest fixes. Positions go only to the live link, never to
 * analytics or logs.
 */

export type LiveKind = 'run' | 'standing';
export type LiveState = 'running' | 'paused' | 'finished';

export interface LiveShareRow {
  session_id: string;
  token: string;
  kind: LiveKind;
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

export function attachLiveShare(sessionId: string, token: string, kind: LiveKind, everyS: number): void {
  try {
    recordingDb().runSync(
      'insert or replace into live_shares (session_id, token, kind, every_s, last_push_at, last_sent_t, state, views, ended) values (?, ?, ?, ?, 0, 0, ?, 0, 0)',
      [sessionId, token, kind, everyS, 'running']
    );
  } catch (e) {
    log.warn(`could not keep the live link: ${String(e)}`);
  }
}

export function liveShareFor(sessionId: string): LiveShareRow | null {
  return recordingDb().getFirstSync<LiveShareRow>('select * from live_shares where session_id = ?', [sessionId]);
}

function update(sessionId: string, patch: Partial<Pick<LiveShareRow, 'last_push_at' | 'last_sent_t' | 'every_s' | 'state' | 'ended'>>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  recordingDb().runSync(`update live_shares set ${keys.map((k) => `${k} = ?`).join(', ')} where session_id = ?`, [...keys.map((k) => patch[k] as never), sessionId]);
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
 * Sends what is new. `force` skips the interval (pause, resume, finish); the server still refuses pushes that
 * come too fast, and the phone just waits for the next one.
 */
export async function pushLive(sessionId: string, opts: { state?: LiveState; force?: boolean } = {}, now = Date.now()): Promise<void> {
  if (pushing) return;
  let share: LiveShareRow | null;
  try {
    share = liveShareFor(sessionId);
  } catch {
    return;
  }
  if (!share || share.ended) return;
  const state = opts.state ?? share.state ?? 'running';
  if (!opts.force && now - share.last_push_at < share.every_s * 1000) return;
  pushing = true;
  try {
    const picked = thinFixes(samplesSince(sessionId, share.last_sent_t + 1));
    const res = await rpc<{ ok: boolean; reason?: string; every_seconds?: number }>('live_link_push', {
      p_token: share.token,
      p_session: sessionId,
      p_state: state,
      p_points: picked.map((s) => ({ t: s.t, lat: Math.round(s.lat * 1e6) / 1e6, lng: Math.round(s.lng * 1e6) / 1e6, acc: s.acc }))
    });
    if (res.ok) {
      update(sessionId, { last_push_at: now, last_sent_t: picked.length ? picked[picked.length - 1]!.t : share.last_sent_t, every_s: res.every_seconds ?? share.every_s, state, ended: state === 'finished' ? 1 : 0 });
    } else if (res.reason === 'ended') {
      update(sessionId, { ended: 1 });
    } else {
      update(sessionId, { last_push_at: now });
    }
  } catch (e) {
    // Offline or a server error: try again at the next interval. Never logs the position.
    log.warn(`live link update not sent: ${e instanceof Error ? e.name : 'error'}`);
    try {
      update(sessionId, { last_push_at: now });
    } catch {
      // nothing more to do
    }
  } finally {
    pushing = false;
  }
}

/** Stop sharing now (the runner tapped Stop, or discarded the run). */
export async function stopLiveShare(sessionId: string): Promise<void> {
  const share = liveShareFor(sessionId);
  if (!share) return;
  try {
    update(sessionId, { ended: 1 });
  } catch {
    // keep going: the server call still ends the link
  }
  await rpc('live_link_end', { p_token: share.token }).catch(() => {});
}

/** Test-only reset of module state. */
export function _resetLivePushForTests(): void {
  pushing = false;
  pending = null;
}
