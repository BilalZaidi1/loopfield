import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, loopEvents, ORIGIN, samplePath, speedEvents } from '../../../packages/core/test/fixtures.ts';
import { destination } from '../../../packages/core/src/index.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import { HttpError } from '../../../supabase/functions/_shared/http.ts';
import { pgArray, type Sql } from '../../../supabase/functions/_shared/clients.ts';
import { COMP, createUser, drain, grantConsent, makeCtx, uploadRun } from './helpers.ts';

const ctx = makeCtx(8);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const asUser = async <T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> =>
  (sql as unknown as { begin<R>(cb: (tx: Sql) => Promise<R>): Promise<R> }).begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    return fn(tx);
  });

const controlSnapshot = async () =>
  (await ctx.sql`select cell::text, controller_id from internal.cell_control where competition_id = ${COMP} and status = 'controlled' order by cell`).map((r) => `${r.cell}:${r.controller_id}`);

describe('recording upload → validation → territory (server-authoritative)', () => {
  let ali = '';
  let aliActivity = '';

  it('awards land for an eligible free-form loop and returns a durable receipt first', async () => {
    ali = await createUser(ctx.sql, 'ali_terr');
    await grantConsent(ctx.sql, ali, ['territory_competition']);
    const start = Date.now() - 3 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, ali, { mode: 'territory', competitionId: COMP }, start - 60_000);
    const samples = samplePath(circlePath(ORIGIN, 300), { startT: start });
    const receipt = await uploadRun(ctx, ali, samples, loopEvents(samples), ticket);
    aliActivity = receipt.activityId;
    expect(receipt.status).toBe('received');
    expect(receipt.competitive.territory).toBe('queued');
    const [before] = await ctx.sql`select status from public.loop_claims where id = ${receipt.territoryClaimId}`;
    expect(before!.status).toBe('processing'); // receipt ≠ award
    await drain(ctx);
    const [claim] = await ctx.sql`select status, eligible_cell_count, reasons, publish_after > completed_at as delayed from public.loop_claims where id = ${receipt.territoryClaimId}`;
    expect(claim!.reasons).toEqual([]);
    expect(claim!.status).toBe('eligible');
    expect(claim!.eligible_cell_count).toBeGreaterThan(60);
    expect(claim!.delayed).toBe(true);
    const [act] = await ctx.sql`select status, summary_source, distance_m, personal_route is not null as has_route from public.activities where id = ${receipt.activityId}`;
    expect(act).toMatchObject({ status: 'processed', summary_source: 'server', has_route: true });
    const [exp] = await ctx.sql`select count(*)::int as n from public.exploration_cells where user_id = ${ali}`;
    expect(exp!.n).toBeGreaterThan(5);
  });

  it('is idempotent for repeated chunk and finalize requests', async () => {
    const u = await createUser(ctx.sql, 'retry_runner');
    const start = Date.now() - 2 * 3600_000;
    const samples = samplePath(circlePath(destination(ORIGIN, 3000, 90), 250), { startT: start });
    const first = await uploadRun(ctx, u, samples, loopEvents(samples), null);
    await expect(uploadRun(ctx, u, samples, loopEvents(samples), null)).rejects.toMatchObject({ code: 'duplicate_activity' });
    const [n] = await ctx.sql`select count(*)::int as n from public.activities where user_id = ${u}`;
    expect(n!.n).toBe(1);
    expect(first.territoryClaimId).toBeNull(); // private run: no ticket, no contest
  });

  it('keeps late uploads in personal history only', async () => {
    const u = await createUser(ctx.sql, 'late_runner');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const start = Date.now() - 2 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, start - 60_000);
    const samples = samplePath(circlePath(destination(ORIGIN, 3000, 180), 250), { startT: start });
    const r = await uploadRun(ctx, u, samples, loopEvents(samples), ticket, { now: Date.now() + 25 * 3600_000 });
    expect(r.competitive.territory).toContain('late_upload');
  });

  it('rejects a ticket reused by a second activity', async () => {
    const u = await createUser(ctx.sql, 'reuse_runner');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const start = Date.now() - 2 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, start - 60_000);
    const s1 = samplePath(circlePath(destination(ORIGIN, 4000, 0), 250), { startT: start });
    const s2 = samplePath(circlePath(destination(ORIGIN, 4000, 30), 250), { startT: start + 1000 });
    await uploadRun(ctx, u, s1, loopEvents(s1), ticket);
    const r2 = await uploadRun(ctx, u, s2, loopEvents(s2), ticket);
    expect(r2.competitive.territory).toContain('ticket_reused');
  });

  it('refuses competitive tickets without explicit consent', async () => {
    const u = await createUser(ctx.sql, 'no_consent');
    await expect(issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP })).rejects.toBeInstanceOf(HttpError);
  });

  it('serializes concurrent overlapping claims deterministically (FR13, FR15)', async () => {
    const users = await Promise.all(['con_a', 'con_b', 'con_c'].map((h) => createUser(ctx.sql, h)));
    const base = destination(ORIGIN, 1500, 45);
    const start = Date.now() - 2.5 * 3600_000;
    for (const [i, u] of users.entries()) {
      await grantConsent(ctx.sql, u, ['territory_competition']);
      const t0 = start + i * 600_000;
      const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
      const s = samplePath(circlePath(destination(base, 120 * i, 90), 280), { startT: t0 });
      await uploadRun(ctx, u, s, loopEvents(s), ticket);
    }
    // Two workers race on separate connections.
    await Promise.all([drain(ctx, 'worker-1'), drain(ctx, 'worker-2'), drain(ctx, 'worker-3')]);
    const incremental = await controlSnapshot();
    await ctx.sql`select internal.replay_season(${COMP}::uuid, '00000000-0000-4000-8000-000000000041'::uuid)`;
    expect(await controlSnapshot()).toEqual(incremental);
    const owners = await ctx.sql`select controller_id, count(*)::int as n from internal.cell_control where controller_id = any(${pgArray(users)}::uuid[]) group by controller_id`;
    expect(owners.length).toBe(3); // later loops took only the overlap; earlier owners keep their remainder
  });

  it('speed titles are independent of land (FR31) and follow the margin rule', async () => {
    // Ali proposes his loop as a route; a reviewer approves it.
    await ctx.sql`update public.activities set status = 'processed' where id = ${aliActivity}`;
    const proposalId = await asUser(ctx.sql, ali, async (tx) => (await tx`select public.propose_route(${aliActivity}::uuid, 'Lake loop', 'route-v1', false) as id`)[0]!.id as string);
    await drain(ctx);
    const [proposal] = await ctx.sql`select status, length_m, decision_reason from public.route_proposals where id = ${proposalId}`;
    expect(proposal!.decision_reason ?? null).toBeNull();
    expect(proposal!.status).toBe('pending_review');
    const reviewer = await createUser(ctx.sql, 'reviewer1');
    await ctx.sql`insert into public.staff_roles (user_id, role) values (${reviewer}, 'route_reviewer')`;
    const courseId = await asUser(ctx.sql, reviewer, async (tx) => (await tx`select public.ops_review_route(${proposalId}::uuid, true, 'safe public path') as id`)[0]!.id as string);
    const [cv] = await ctx.sql`select current_version_id from public.courses where id = ${courseId}`;

    const landBefore = await controlSnapshot();
    const runCourse = async (handle: string, speed: number, offsetMs: number) => {
      const u = await createUser(ctx.sql, handle);
      await grantConsent(ctx.sql, u, ['speed_competition']);
      const t0 = Date.now() - 2 * 3600_000 + offsetMs;
      const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'speed', competitionId: COMP, courseVersionId: cv!.current_version_id }, t0 - 60_000);
      const path = circlePath(ORIGIN, 300);
      const approach = destination(path[0]!, 40, 270);
      const s = samplePath([approach, ...path, ...path.slice(1, 6)], { startT: t0, speedMps: speed });
      const r = await uploadRun(ctx, u, s, speedEvents(s), ticket);
      await drain(ctx);
      const [att] = await ctx.sql`select status, reasons, elapsed_ms from public.speed_attempts where id = ${r.speedAttemptId}`;
      return { user: u, att: att! };
    };
    const fast = await runCourse('speed_fast', 4.0, 0);
    expect(fast.att.reasons).toEqual([]);
    expect(fast.att.status).toBe('eligible');
    const nearTie = await runCourse('speed_close', 4.04, 600_000); // ~1% faster: inside the margin
    expect(nearTie.att.status).toBe('eligible');
    const [title] = await ctx.sql`select champion_id from internal.speed_titles where course_version_id = ${cv!.current_version_id}`;
    expect(title!.champion_id).toBe(fast.user);
    expect(await controlSnapshot()).toEqual(landBefore); // speed-only sessions change no cells
  });
});

describe('private exploration (FR19)', () => {
  it('survives losing the claimed land and is withdrawn only when its source run is deleted', async () => {
    const first = await createUser(ctx.sql, 'explore_first');
    const second = await createUser(ctx.sql, 'explore_second');
    await grantConsent(ctx.sql, first, ['territory_competition']);
    await grantConsent(ctx.sql, second, ['territory_competition']);
    const center = destination(ORIGIN, 5000, 225);
    const start = Date.now() - 3 * 3600_000;
    const run = async (u: string, t0: number) => {
      const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
      const s = samplePath(circlePath(center, 250), { startT: t0 });
      const receipt = await uploadRun(ctx, u, s, loopEvents(s), ticket);
      await drain(ctx);
      return receipt.activityId;
    };
    const explored = async (u: string) => (await ctx.sql`select count(*)::int as n from public.exploration_cells where user_id = ${u}`)[0]!.n as number;
    const controlled = async (u: string) => (await ctx.sql`select count(*)::int as n from internal.cell_control where controller_id = ${u} and competition_id = ${COMP}`)[0]!.n as number;

    const firstRun = await run(first, start);
    const exploredBefore = await explored(first);
    expect(exploredBefore).toBeGreaterThan(0);
    expect(await controlled(first)).toBeGreaterThan(0);

    await run(second, start + 30 * 60_000); // same loop, completed later: takes the land
    expect(await controlled(first)).toBe(0);
    expect(await controlled(second)).toBeGreaterThan(0);
    expect(await explored(first)).toBe(exploredBefore); // losing land leaves private history intact

    await asUser(ctx.sql, first, (tx) => tx`select public.delete_activity(${firstRun}::uuid)`);
    await drain(ctx);
    expect(await explored(first)).toBe(0); // derived history follows its source
    expect(await controlled(second)).toBeGreaterThan(0); // the other runner's result is unaffected
  });
});
