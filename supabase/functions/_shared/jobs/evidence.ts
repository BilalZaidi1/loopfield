import { BUCKETS } from '../blobs.ts';
import { canonicalSamples, parseSerializedSamples, serializeSamples, sha256Hex, type LocationSample, type RecordingEvent } from '../core/index.ts';
import { NonRetryableError, type JobContext } from './context.ts';

export interface Evidence {
  activityId: string;
  userId: string;
  samples: LocationSample[];
  events: RecordingEvent[];
  startedAt: Date;
  endedAt: Date;
  receivedAt: Date;
  modes: { territory: boolean; speed: boolean };
  competitionId: string | null;
  seasonId: string | null;
  courseVersionId: string | null;
  ticketId: string | null;
}

/** Load and verify the immutable sample sequence for an activity from private storage. */
export async function loadEvidence(ctx: JobContext, activityId: string): Promise<Evidence> {
  const [a] = await ctx.sql`
    select id, user_id, events, started_at, ended_at, received_at, modes, competition_id, season_id, course_version_id, ticket_id,
           evidence_digest, raw_evidence_purged_at, deleted_at
      from public.activities where id = ${activityId}`;
  if (!a) throw new NonRetryableError('activity not found');
  if (a.deleted_at) throw new NonRetryableError('activity deleted');
  if (a.raw_evidence_purged_at) throw new NonRetryableError('raw evidence already purged');
  const chunks = await ctx.sql`select idx, digest, storage_path from internal.activity_chunks where activity_id = ${activityId} order by idx`;
  const all: LocationSample[] = [];
  for (const c of chunks) {
    const bytes = await ctx.blobs.get(BUCKETS.evidence, c.storage_path as string);
    if (!bytes) throw new Error(`missing evidence chunk ${c.idx}`);
    const text = new TextDecoder().decode(bytes);
    if ((await sha256Hex(text)) !== c.digest) throw new NonRetryableError(`evidence chunk ${c.idx} digest mismatch`);
    all.push(...parseSerializedSamples(text));
  }
  const samples = canonicalSamples(all);
  if (a.evidence_digest && (await sha256Hex(serializeSamples(samples))) !== a.evidence_digest) {
    throw new NonRetryableError('evidence digest mismatch');
  }
  return {
    activityId,
    userId: a.user_id,
    samples,
    events: (a.events ?? []) as RecordingEvent[],
    startedAt: a.started_at,
    endedAt: a.ended_at,
    receivedAt: a.received_at,
    modes: a.modes ?? { territory: false, speed: false },
    competitionId: a.competition_id,
    seasonId: a.season_id,
    courseVersionId: a.course_version_id,
    ticketId: a.ticket_id
  };
}
