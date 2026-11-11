import { useQuery } from '@tanstack/react-query';
import type { ActivitySummary } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { recordingDb } from '@/recording/db';
import type { AttemptJson, ClaimJson } from './ResultCards';

export interface ActivityJson {
  id: string;
  status: 'receiving' | 'received' | 'processing' | 'processed' | 'failed' | 'deleted';
  modes: { territory?: boolean; speed?: boolean };
  competition_id: string | null;
  season_id: string | null;
  started_at: string;
  ended_at: string;
  distance_m: number | null;
  elapsed_ms: number | null;
  moving_ms: number | null;
  paused_ms: number | null;
  avg_pace_s_per_km: number | null;
  elevation_gain_m: number | null;
  splits: { index: number; distanceM: number; elapsedMs: number; containsGap: boolean }[] | null;
  gaps: { startT: number; endT: number; seconds: number }[] | null;
  sample_count: number | null;
  usable_sample_count: number | null;
  summary_source: string;
  personal_route: string | null;
  title: string | null;
  notes: string | null;
  perceived_effort: number | null;
  received_at: string | null;
  /** Server reasons this run moved unlike a runner (implausible or vehicle-like speed, no running steps). */
  integrity_flags?: string[];
  integrity_cleared_at?: string | null;
  raw_evidence_purged_at: string | null;
}

export interface ActivityDetail {
  activity: ActivityJson;
  claim: ClaimJson | null;
  attempts: AttemptJson[];
  title_context: { attempt_id: string; benchmark_ms: number; champion_is_me: boolean }[];
  proposals: { id: string; status: string; name: string }[];
}

const FINAL_CLAIM = new Set(['eligible', 'pending_review', 'unranked', 'invalid', 'withheld_privacy', 'withdrawn']);

export function isSettled(d: ActivityDetail | null | undefined): boolean {
  if (!d) return false;
  if (d.activity.status === 'receiving' || d.activity.status === 'received' || d.activity.status === 'processing') return false;
  if (d.activity.modes?.territory && (!d.claim || !FINAL_CLAIM.has(d.claim.status))) return false;
  if (d.attempts.some((a) => a.status === 'processing')) return false;
  return true;
}

/** Server-authoritative activity detail; polls while validation is still running. */
export function useActivityDetail(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['activity', id],
    enabled: Boolean(id) && enabled,
    queryFn: () => rpc<ActivityDetail | null>('activity_detail', { p_activity: id }),
    refetchInterval: (q) => (isSettled(q.state.data as ActivityDetail | null) ? false : 5_000)
  });
}

export interface LocalRun {
  sessionId: string;
  mode: string;
  startedAt: number | null;
  endedAt: number | null;
  uploadState: string | null;
  lastError: string | null;
  summary: ActivitySummary | null;
  receipt: { activityId: string; receivedAt: string } | null;
}

export function readLocalRun(sessionId: string): LocalRun | null {
  const row = recordingDb().getFirstSync<{ id: string; mode: string; started_at: number | null; ended_at: number | null; state: string | null; last_error: string | null; summary: string | null; receipt: string | null }>(
    'select s.id, s.mode, s.started_at, s.ended_at, u.state, u.last_error, u.summary, u.receipt from sessions s left join uploads u on u.session_id = s.id where s.id = ?',
    [sessionId]
  );
  if (!row) return null;
  return {
    sessionId: row.id,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    uploadState: row.state,
    lastError: row.last_error,
    summary: row.summary ? (JSON.parse(row.summary) as ActivitySummary) : null,
    receipt: row.receipt ? JSON.parse(row.receipt) : null
  };
}
