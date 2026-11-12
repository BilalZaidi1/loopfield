import {
  canonicalSamples,
  checkTicketTiming,
  findCaptureInterval,
  parseSerializedSamples,
  SEASON_RULES,
  serializeSamples,
  sha256Hex,
  verifyTicket,
  type ReasonCode,
  type RecordingEvent,
  type SessionTicketClaims
} from '../core/index.ts';
import { BUCKETS, evidenceChunkPath, type BlobStore } from '../blobs.ts';
import { pgArray, serverSecret, type Sql } from '../clients.ts';
import type { ServerEnv } from '../env.ts';
import { HttpError, isUuid } from '../http.ts';

export interface ChunkRequest {
  activityId: string;
  idx: number;
  seqFrom: number;
  seqTo: number;
  digest: string;
  data: string;
  startedAt: number;
}

const MAX_CHUNK_BYTES = 2_000_000;
const MAX_CHUNKS = 400;

/** Store one immutable evidence chunk. Retries with identical content are accepted exactly once in effect. */
export async function storeChunk(sql: Sql, blobs: BlobStore, userId: string, req: ChunkRequest): Promise<{ stored: boolean }> {
  if (!isUuid(req.activityId)) throw new HttpError(400, 'invalid_activity');
  if (!Number.isInteger(req.idx) || req.idx < 0 || req.idx >= MAX_CHUNKS) throw new HttpError(400, 'invalid_chunk_index');
  if (typeof req.data !== 'string' || req.data.length > MAX_CHUNK_BYTES) throw new HttpError(413, 'chunk_too_large');
  if ((await sha256Hex(req.data)) !== req.digest) throw new HttpError(400, 'digest_mismatch');
  const samples = parseSerializedSamples(req.data);
  if (!samples.length || samples[0]!.seq !== req.seqFrom || samples[samples.length - 1]!.seq !== req.seqTo) throw new HttpError(400, 'sequence_mismatch');
  for (let i = 1; i < samples.length; i++) if (samples[i]!.seq !== samples[i - 1]!.seq + 1) throw new HttpError(400, 'sequence_gap_in_chunk');
  if (samples.some((s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180)) throw new HttpError(400, 'invalid_coordinates');

  const [rl] = await sql`select internal.check_rate_limit(${userId}, 'upload_chunk', 120, 60) as allowed`;
  if (!rl?.allowed) throw new HttpError(429, 'rate_limited');

  const startedAt = new Date(Number.isFinite(req.startedAt) ? req.startedAt : samples[0]!.t);
  await sql`insert into public.activities (id, user_id, started_at, ended_at, status) values (${req.activityId}, ${userId}, ${startedAt}, ${startedAt}, 'receiving')
            on conflict (id) do nothing`;
  const [act] = await sql`select user_id, status from public.activities where id = ${req.activityId}`;
  if (!act || act.user_id !== userId) throw new HttpError(403, 'forbidden');

  const [existing] = await sql`select digest from internal.activity_chunks where activity_id = ${req.activityId} and idx = ${req.idx}`;
  if (existing) {
    if (existing.digest !== req.digest) throw new HttpError(409, 'chunk_conflict');
    return { stored: false };
  }
  if (act.status !== 'receiving') throw new HttpError(409, 'activity_finalized');
  const path = evidenceChunkPath(userId, req.activityId, req.idx);
  await blobs.put(BUCKETS.evidence, path, req.data, 'text/plain');
  await sql`insert into internal.activity_chunks (activity_id, idx, seq_from, seq_to, digest, storage_path, bytes)
            values (${req.activityId}, ${req.idx}, ${req.seqFrom}, ${req.seqTo}, ${req.digest}, ${path}, ${req.data.length})
            on conflict (activity_id, idx) do nothing`;
  return { stored: true };
}

export interface FinalizeRequest {
  activityId: string;
  startedAt: number;
  endedAt: number;
  events: RecordingEvent[];
  sampleCount: number;
  chunkCount: number;
  evidenceDigest: string;
  device: { platform: 'ios' | 'android'; osVersion: string; model: string | null; appVersion: string };
  ticket: { claims: SessionTicketClaims; signature: string } | null;
}

export interface Receipt {
  activityId: string;
  receivedAt: string;
  status: string;
  territoryClaimId: string | null;
  speedAttemptId: string | null;
  competitive: { territory: ReasonCode[] | 'queued' | null; speed: ReasonCode[] | 'queued' | null };
}

/**
 * Finalize an upload into a durable receipt. A receipt means the evidence is stored — not that land
 * or a title has been awarded. Competitive branches are queued as independent jobs.
 */
export async function finalizeActivity(sql: Sql, blobs: BlobStore, env: ServerEnv, userId: string, req: FinalizeRequest, now = Date.now()): Promise<Receipt> {
  if (!isUuid(req.activityId)) throw new HttpError(400, 'invalid_activity');
  if (!Array.isArray(req.events) || req.events.length > 500) throw new HttpError(400, 'invalid_events');
  if (!(req.endedAt >= req.startedAt)) throw new HttpError(400, 'invalid_times');
  const [act] = await sql`select id, user_id, status, received_at, evidence_digest from public.activities where id = ${req.activityId}`;
  if (!act || act.user_id !== userId) throw new HttpError(404, 'activity_not_found');
  if (act.status !== 'receiving') {
    if (act.evidence_digest !== req.evidenceDigest) throw new HttpError(409, 'activity_finalized');
    return existingReceipt(sql, req.activityId);
  }

  const chunks = await sql`select idx, seq_from, seq_to, storage_path, digest from internal.activity_chunks where activity_id = ${req.activityId} order by idx`;
  if (chunks.length !== req.chunkCount) throw new HttpError(409, 'chunks_incomplete');
  let expected = 0;
  for (const c of chunks) {
    if (c.seq_from !== expected) throw new HttpError(409, 'chunks_not_contiguous');
    expected = c.seq_to + 1;
  }
  if (expected !== req.sampleCount) throw new HttpError(409, 'sample_count_mismatch');
  const texts: string[] = [];
  for (const c of chunks) {
    const bytes = await blobs.get(BUCKETS.evidence, c.storage_path);
    if (!bytes) throw new HttpError(409, 'chunk_missing');
    texts.push(new TextDecoder().decode(bytes));
  }
  const samples = canonicalSamples(texts.flatMap(parseSerializedSamples));
  if ((await sha256Hex(serializeSamples(samples))) !== req.evidenceDigest) throw new HttpError(400, 'evidence_digest_mismatch');

  const shared: ReasonCode[] = [];
  const [dup] = await sql`select user_id from public.activities where evidence_digest = ${req.evidenceDigest} and id <> ${req.activityId} limit 1`;
  if (dup && dup.user_id === userId) {
    // Same runner resubmitted identical evidence under a new id: keep one logical activity.
    await sql`delete from public.activities where id = ${req.activityId}`;
    throw new HttpError(409, 'duplicate_activity');
  }
  if (dup) shared.push('duplicate_evidence');
  // Late-upload window: the season's own value (set when the season was created), else the built-in one.
  const [lateRow] = req.ticket?.claims?.seasonId
    ? await sql`select late_upload_hours from public.seasons where id = ${req.ticket.claims.seasonId}`
    : [];
  const lateHours = Number(lateRow?.late_upload_hours ?? SEASON_RULES.lateUploadWindowHours.value);
  if (now - req.endedAt > lateHours * 3_600_000) shared.push('late_upload');

  // Ticket: server-signed modes are the only source of competitive intent.
  let ticket: SessionTicketClaims | null = null;
  if (req.ticket) {
    const signingSecret = await serverSecret(sql, env.TICKET_SIGNING_SECRET, 'ticket_signing_secret').catch(() => null);
    const valid = signingSecret ? await verifyTicket(req.ticket.claims, req.ticket.signature, signingSecret) : false;
    const [row] = await sql`select * from internal.recording_sessions where ticket_id = ${req.ticket.claims.ticketId}`;
    if (!valid || !row || row.user_id !== userId || row.signature !== req.ticket.signature) shared.push('ticket_invalid');
    else if (row.consumed_by_activity && row.consumed_by_activity !== req.activityId) shared.push('ticket_reused');
    else {
      ticket = req.ticket.claims;
      await sql`update internal.recording_sessions set consumed_by_activity = ${req.activityId} where ticket_id = ${ticket.ticketId} and consumed_by_activity is null`;
    }
  }

  const receivedAt = new Date(now);
  await sql`
    update public.activities set
      started_at = ${new Date(req.startedAt)}, ended_at = ${new Date(req.endedAt)}, events = ${sql.json(req.events as never)},
      evidence_digest = ${req.evidenceDigest}, sample_count = ${req.sampleCount}, expected_chunks = ${req.chunkCount},
      device = ${sql.json(req.device as never)}, received_at = ${receivedAt}, status = 'received',
      ticket_id = ${ticket?.ticketId ?? null}, modes = ${sql.json((ticket?.modes ?? { territory: false, speed: false }) as never)},
      competition_id = ${ticket?.competitionId ?? null}, season_id = ${ticket?.seasonId ?? null}, course_version_id = ${ticket?.courseVersionId ?? null}
    where id = ${req.activityId}`;
  await sql`select internal.enqueue_job('territory', 'reconcile_activity', ${sql.json({ activity_id: req.activityId })}::jsonb, ${'reconcile:' + req.activityId})`;
  // Optional run summary email (off by default). Sent after the privacy delay so it can include published land.
  await sql`select internal.enqueue_email(${userId}::uuid, 'run_summary', ${sql.json({ activity_id: req.activityId })}::jsonb, ${'runsum:' + req.activityId},
                                         ${new Date(Math.max(now, req.endedAt) + 35 * 60_000)})`;

  const receipt: Receipt = { activityId: req.activityId, receivedAt: receivedAt.toISOString(), status: 'received', territoryClaimId: null, speedAttemptId: null, competitive: { territory: null, speed: null } };
  if (!ticket) {
    if (req.ticket) receipt.competitive = { territory: shared, speed: shared };
    return receipt;
  }

  const timing = (kind: 'capture_start' | 'speed_start'): ReasonCode[] => {
    const evt = [...req.events].sort((a, b) => a.t - b.t).find((e) => e.kind === kind);
    if (!evt) return ['interval_missing'];
    const check = checkTicketTiming(ticket!, evt.t, SEASON_RULES.maxClockSkewSeconds.value * 1000);
    return check.ok ? [] : [check.reason];
  };

  if (ticket.modes.territory) {
    const reasons = [...shared, ...timing('capture_start')];
    if (!findCaptureInterval(req.events, samples)) reasons.push('interval_missing');
    const status = reasons.length ? (reasons.includes('duplicate_evidence') || reasons.includes('ticket_reused') ? 'invalid' : 'unranked') : 'processing';
    const [claim] = await sql`
      insert into public.loop_claims (activity_id, user_id, competition_id, season_id, status, reasons, rule_version, received_at)
      values (${req.activityId}, ${userId}, ${ticket.competitionId}, ${ticket.seasonId}, ${status}, ${pgArray(reasons)}::text[], ${ticket.territoryRulesVersion}, ${receivedAt})
      on conflict (activity_id) do update set received_at = excluded.received_at returning id`;
    receipt.territoryClaimId = claim!.id;
    receipt.competitive.territory = reasons.length ? reasons : 'queued';
    if (!reasons.length) {
      // The same loop also counts on the region's all-time map and in territory events the runner joined
      // (claims derived from this one, evaluated in the same job). Club races stay inside their club.
      await sql`select internal.derive_layer_claims(${claim!.id}::uuid)`;
      await sql`select internal.enqueue_job('territory', 'evaluate_loop', ${sql.json({ claim_id: claim!.id })}::jsonb, ${'loop:' + claim!.id})`;
    }
  }
  if (ticket.modes.speed && ticket.courseVersionId) {
    const reasons = [...shared, ...timing('speed_start')];
    const status = reasons.length ? (reasons.includes('duplicate_evidence') || reasons.includes('ticket_reused') ? 'invalid' : 'unranked') : 'processing';
    const [att] = await sql`
      insert into public.speed_attempts (activity_id, user_id, course_version_id, competition_id, season_id, status, reasons, rule_version, received_at)
      values (${req.activityId}, ${userId}, ${ticket.courseVersionId}, ${ticket.competitionId}, ${ticket.seasonId}, ${status}, ${pgArray(reasons)}::text[], ${ticket.speedRulesVersion}, ${receivedAt})
      on conflict (activity_id, course_version_id) do update set received_at = excluded.received_at returning id`;
    receipt.speedAttemptId = att!.id;
    receipt.competitive.speed = reasons.length ? reasons : 'queued';
    if (!reasons.length) await sql`select internal.enqueue_job('speed', 'evaluate_attempt', ${sql.json({ attempt_id: att!.id })}::jsonb, ${'attempt:' + att!.id})`;
  }
  return receipt;
}

async function existingReceipt(sql: Sql, activityId: string): Promise<Receipt> {
  const [a] = await sql`
    select a.id, a.received_at, a.status, lc.id as claim_id, lc.status as claim_status, sa.id as attempt_id, sa.status as attempt_status
      from public.activities a left join public.loop_claims lc on lc.activity_id = a.id left join public.speed_attempts sa on sa.activity_id = a.id
     where a.id = ${activityId} limit 1`;
  if (!a) throw new HttpError(404, 'activity_not_found');
  return {
    activityId,
    receivedAt: new Date(a.received_at).toISOString(),
    status: a.status,
    territoryClaimId: a.claim_id ?? null,
    speedAttemptId: a.attempt_id ?? null,
    competitive: { territory: a.claim_id ? 'queued' : null, speed: a.attempt_id ? 'queued' : null }
  };
}
