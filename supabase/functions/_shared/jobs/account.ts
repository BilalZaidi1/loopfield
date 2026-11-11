import { BUCKETS } from '../blobs.ts';
import { accountDeletedEmail, exportReadyEmail, sha256Hex } from '../email.ts';
import { NonRetryableError, type JobContext, type JobHandler } from './context.ts';

async function withdrawActivityResults(ctx: JobContext, activityId: string, reason: string) {
  const claims = await ctx.sql`select id from public.loop_claims where activity_id = ${activityId} and status in ('eligible', 'pending_review', 'processing')`;
  for (const c of claims) await ctx.sql`select internal.invalidate_claim(${c.id}::uuid, 'withdrawn', ${reason}, null)`;
  const attempts = await ctx.sql`select id from public.speed_attempts where activity_id = ${activityId} and status in ('eligible', 'pending_review', 'processing')`;
  for (const a of attempts) await ctx.sql`select internal.invalidate_attempt(${a.id}::uuid, 'withdrawn', ${reason}, null)`;
}

/**
 * Deleting a source activity removes its claims and attempts and recomputes each dependent ledger
 * separately (FR16), updates exploration (FR19) and deletes the raw evidence.
 */
export const deleteActivity: JobHandler = async (payload, ctx) => {
  const activityId = String(payload.activity_id ?? '');
  const userId = String(payload.user_id ?? '');
  const [a] = await ctx.sql`select id, user_id from public.activities where id = ${activityId} and user_id = ${userId}`;
  if (!a) return;
  await withdrawActivityResults(ctx, activityId, 'source_deleted');
  // A deleted run no longer earns points; spent points are not given back, so the balance may go below zero.
  await ctx.sql`select internal.revoke_movement_points(${activityId}::uuid, 'source_deleted')`;
  await ctx.sql`select internal.remove_exploration(${activityId}::uuid)`;
  await ctx.sql`update public.route_proposals set status = 'withdrawn', decided_at = coalesce(decided_at, now())
                 where source_activity_id = ${activityId} and status in ('processing', 'pending_review')`;
  const chunks = await ctx.sql`select storage_path from internal.activity_chunks where activity_id = ${activityId}`;
  await ctx.blobs.remove(BUCKETS.evidence, chunks.map((c) => c.storage_path as string));
  // Attempt rows that seeded titles are kept only as withdrawn records until the row is removed below.
  const titles = await ctx.sql`select distinct course_version_id, competition_id, season_id from public.speed_attempts where activity_id = ${activityId} and season_id is not null`;
  await ctx.sql`delete from public.activities where id = ${activityId}`;
  for (const t of titles) await ctx.sql`select internal.refresh_title(${t.course_version_id}::uuid, ${t.competition_id}::uuid, ${t.season_id}::uuid, 'correction')`;
};

/** Consent withdrawal removes the runner's contest results everywhere (PRD §6, §11). */
export const withdrawCompetition: JobHandler = async (payload, ctx) => {
  const userId = String(payload.user_id ?? '');
  const kind = String(payload.kind ?? '');
  if (kind === 'territory_competition') {
    const claims = await ctx.sql`select id from public.loop_claims where user_id = ${userId} and status in ('eligible', 'pending_review', 'processing')`;
    for (const c of claims) await ctx.sql`select internal.invalidate_claim(${c.id}::uuid, 'withdrawn', 'consent_withdrawn', null)`;
  } else if (kind === 'speed_competition') {
    const attempts = await ctx.sql`select id from public.speed_attempts where user_id = ${userId} and status in ('eligible', 'pending_review', 'processing')`;
    for (const a of attempts) await ctx.sql`select internal.invalidate_attempt(${a.id}::uuid, 'withdrawn', 'consent_withdrawn', null)`;
  } else throw new NonRetryableError(`unknown consent kind ${kind}`);
};

/** Owner-only export (FR09): the runner's own data, never another person's raw route. */
export const exportData: JobHandler = async (payload, ctx) => {
  const exportId = String(payload.export_id ?? '');
  const userId = String(payload.user_id ?? '');
  await ctx.sql`update public.data_exports set status = 'running' where id = ${exportId}`;
  const data = {
    format: 'loopfield-export-v1',
    generated_at: new Date().toISOString(),
    notes: [
      'Imported health data is stored only on your phone and is not part of this export.',
      'Direct messages are held by our messaging provider and can be viewed in the app.'
    ],
    profile: (await ctx.sql`select id, handle, display_name, bio, city_label, visibility, discoverable, created_at from public.profiles where id = ${userId}`)[0],
    settings: (await ctx.sql`select * from public.user_settings where user_id = ${userId}`)[0],
    notification_preferences: (await ctx.sql`select * from public.notification_prefs where user_id = ${userId}`)[0],
    consents: await ctx.sql`select kind, version, granted, created_at from public.consents where user_id = ${userId} order by created_at`,
    protected_areas: await ctx.sql`select label, radius_m, extensions.st_asgeojson(center)::jsonb as center, created_at from public.protected_areas where user_id = ${userId}`,
    activities: await ctx.sql`select id, started_at, ended_at, distance_m, elapsed_ms, moving_ms, avg_pace_s_per_km, elevation_gain_m, splits, gaps, personal_route, title, notes, perceived_effort, modes from public.activities where user_id = ${userId} and deleted_at is null order by started_at`,
    territory_claims: await ctx.sql`select id, activity_id, status, reasons, eligible_area_m2, eligible_cell_count, completed_at, extensions.st_asgeojson(polygon)::jsonb as polygon from public.loop_claims where user_id = ${userId}`,
    speed_attempts: await ctx.sql`select id, activity_id, course_version_id, status, reasons, elapsed_ms, completed_at from public.speed_attempts where user_id = ${userId}`,
    exploration_cells: await ctx.sql`select cell::text, first_visited_at, last_visited_at, visits from public.exploration_cells where user_id = ${userId}`,
    route_proposals: await ctx.sql`select id, name, status, decision_reason, created_at from public.route_proposals where creator_id = ${userId}`,
    posts: await ctx.sql`select id, audience, body, shared_summary, status, created_at from public.posts where author_id = ${userId} and status <> 'deleted'`,
    comments: await ctx.sql`select id, post_id, body, created_at from public.comments where author_id = ${userId} and status = 'visible'`,
    follows: await ctx.sql`select follower_id, followee_id, state, created_at from public.follows where follower_id = ${userId} or followee_id = ${userId}`,
    blocks: await ctx.sql`select blocked_id, created_at from public.blocks where blocker_id = ${userId}`,
    clubs: await ctx.sql`select club_id, role, state, created_at from public.club_memberships where user_id = ${userId}`,
    reports: await ctx.sql`select object_type, category, status, created_at from public.reports where reporter_id = ${userId}`,
    appeals: await ctx.sql`select object_type, status, response, created_at from public.appeals where user_id = ${userId}`,
    entitlements: await ctx.sql`select entitlement, status, product_id, store, expires_at from public.entitlements where user_id = ${userId}`
  };
  const path = `${userId}/${exportId}.json`;
  await ctx.blobs.put(BUCKETS.exports, path, JSON.stringify(data, null, 2), 'application/json');
  await ctx.sql`update public.data_exports set status = 'ready', storage_path = ${path}, completed_at = now(), expires_at = now() + interval '72 hours' where id = ${exportId}`;
  await ctx.sql`select internal.notify(${userId}::uuid, 'system', 'export_ready', null, 'data_export', ${exportId}, '{}'::jsonb, ${'export:' + exportId})`;
};

type Step = 'results' | 'courses' | 'social' | 'chat' | 'billing' | 'storage' | 'auth';
const STEPS: Step[] = ['results', 'courses', 'social', 'chat', 'billing', 'storage', 'auth'];

/**
 * Account deletion (FR23): checkpointed, idempotent steps so a retried job continues where it stopped.
 * Auth, routes, ownership identity, social content and server-held data are removed; device health
 * caches are cleared by the app on sign-out; external health stores are not touched.
 */
export const deleteAccount: JobHandler = async (payload, ctx) => {
  const requestId = String(payload.request_id ?? '');
  const userId = String(payload.user_id ?? '');
  const [req] = await ctx.sql`select id, steps, status from public.deletion_requests where id = ${requestId} and user_id = ${userId}`;
  if (!req || req.status === 'completed') return;
  await ctx.sql`update public.deletion_requests set status = 'running' where id = ${requestId}`;
  const done = new Set<string>(Object.keys(req.steps ?? {}));
  const mark = (s: Step) => ctx.sql`update public.deletion_requests set steps = steps || ${ctx.sql.json({ [s]: new Date().toISOString() })}::jsonb where id = ${requestId}`;
  const email = await ctx.integrations.auth.getEmail(userId);

  for (const step of STEPS) {
    if (done.has(step)) continue;
    switch (step) {
      case 'results': {
        const claims = await ctx.sql`select id from public.loop_claims where user_id = ${userId} and status in ('eligible', 'pending_review', 'processing')`;
        for (const c of claims) await ctx.sql`select internal.invalidate_claim(${c.id}::uuid, 'withdrawn', 'source_deleted', null)`;
        const attempts = await ctx.sql`select id from public.speed_attempts where user_id = ${userId} and status in ('eligible', 'pending_review', 'processing')`;
        for (const a of attempts) await ctx.sql`select internal.invalidate_attempt(${a.id}::uuid, 'withdrawn', 'source_deleted', null)`;
        break;
      }
      case 'courses': {
        const courses = await ctx.sql`select id from public.courses where creator_id = ${userId} and status <> 'withdrawn'`;
        for (const c of courses) await ctx.sql`select internal.withdraw_course(${c.id}::uuid, 'account_deleted', null)`;
        break;
      }
      case 'social': {
        // Clubs owned by the runner pass to the longest-standing organizer, otherwise member, otherwise archive.
        const owned = await ctx.sql`select club_id from public.club_memberships where user_id = ${userId} and role = 'owner' and state = 'active'`;
        for (const o of owned) {
          const [next] = await ctx.sql`select user_id from public.club_memberships where club_id = ${o.club_id} and user_id <> ${userId} and state = 'active'
                                        order by case role when 'organizer' then 0 else 1 end, created_at limit 1`;
          if (next) await ctx.sql`update public.club_memberships set role = 'owner' where club_id = ${o.club_id} and user_id = ${next.user_id}`;
          else await ctx.sql`update public.clubs set status = 'archived' where id = ${o.club_id}`;
        }
        const posts = await ctx.sql`select id from public.posts where author_id = ${userId}`;
        for (const p of posts) {
          const media = await ctx.sql`select derivative_path, upload_path from public.post_media where post_id = ${p.id}`;
          await ctx.blobs.remove(BUCKETS.media, media.map((m) => m.derivative_path).filter(Boolean) as string[]);
          await ctx.blobs.remove(BUCKETS.uploads, media.map((m) => m.upload_path as string));
        }
        await ctx.sql`delete from public.posts where author_id = ${userId}`;
        await ctx.sql`delete from public.comments where author_id = ${userId}`;
        await ctx.sql`delete from public.reactions where user_id = ${userId}`;
        await ctx.sql`delete from public.follows where follower_id = ${userId} or followee_id = ${userId}`;
        await ctx.sql`delete from public.club_memberships where user_id = ${userId}`;
        break;
      }
      case 'chat':
        if (ctx.integrations.chat) await ctx.integrations.chat.deleteUser(userId);
        else ctx.log('chat not configured; Stream user deletion skipped', { userId: 'redacted' });
        break;
      case 'billing':
        if (ctx.integrations.revenuecat) await ctx.integrations.revenuecat.deleteSubscriber(userId);
        break;
      case 'storage': {
        for (const bucket of [BUCKETS.evidence, BUCKETS.avatars, BUCKETS.exports, BUCKETS.uploads]) {
          const files = await ctx.blobs.list(bucket, userId);
          if (files.length) await ctx.blobs.remove(bucket, files);
        }
        break;
      }
      case 'auth':
        // Cascades to the profile and every row keyed to it.
        await ctx.integrations.auth.deleteUser(userId);
        break;
    }
    await mark(step);
  }
  await ctx.sql`update public.deletion_requests set status = 'completed', completed_at = now() where id = ${requestId}`;
  if (email) {
    try {
      const mail = accountDeletedEmail(ctx.env.APP_NAME);
      await ctx.integrations.sendEmail({ to: email, ...mail, tag: 'account_deleted', idempotencyKey: `account-deleted-${requestId}` });
      await ctx.sql`insert into internal.email_log (to_hash, template, status) values (${await sha256Hex(email.toLowerCase())}, 'account_deleted', 'sent')`;
    } catch (e) {
      ctx.log('deletion confirmation email not sent', { error: String((e as Error).message) });
    }
  }
};

export const exportReadyEmailTemplate = exportReadyEmail;

/** Raw evidence retention: purge after the season plus 30 days unless an integrity case is open (PRD §11). */
export const purgeRawEvidence: JobHandler = async (_payload, ctx) => {
  const due = await ctx.sql`
    select a.id from public.activities a left join public.seasons s on s.id = a.season_id
     where a.raw_evidence_purged_at is null
       and ((s.id is not null and s.settled_at is not null and s.settled_at + interval '30 days' < now()) or (s.id is null and a.ended_at + interval '30 days' < now()))
       and not exists (select 1 from public.integrity_cases ic where ic.status <> 'resolved'
                        and ic.object_id in (select id from public.loop_claims where activity_id = a.id union select id from public.speed_attempts where activity_id = a.id))
     limit 200`;
  for (const a of due) {
    const chunks = await ctx.sql`select storage_path from internal.activity_chunks where activity_id = ${a.id}`;
    await ctx.blobs.remove(BUCKETS.evidence, chunks.map((c) => c.storage_path as string));
    await ctx.sql`delete from internal.activity_chunks where activity_id = ${a.id}`;
    await ctx.sql`update public.activities set raw_evidence_purged_at = now(), events = null where id = ${a.id}`;
  }
};
