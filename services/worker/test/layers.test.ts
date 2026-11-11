import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, loopEvents, ORIGIN, samplePath } from '../../../packages/core/test/fixtures.ts';
import { destination, type RecordingEvent } from '../../../packages/core/src/index.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import { COMP, createUser, drain, grantConsent, makeCtx, uploadRun } from './helpers.ts';

const ctx = makeCtx(6);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const REGION = '00000000-0000-4000-8000-000000000001';

async function layersOf(primary: string) {
  return ctx.sql`
    select c.kind, lc.status, lc.reasons, lc.eligible_cell_count as cells
      from public.loop_claims lc join public.competitions c on c.id = lc.competition_id
     where lc.id = ${primary} or lc.parent_claim_id = ${primary}
     order by c.kind`;
}

describe('one run, every layer (all-time map, season race, events)', () => {
  it('evaluates a race loop once and counts it on the all-time map and in a joined territory event', async () => {
    const u = await createUser(ctx.sql, 'layer_runner');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const t0 = Date.now() - 3 * 3600_000;
    const [ev] = await ctx.sql`
      select internal.create_event(null, null, 'Weekend Takeover', null, 'territory', 'individual', ${REGION}::uuid,
                                   ${new Date(t0 - 3600_000)}, ${new Date(Date.now() + 2 * 86_400_000)}, null) as id`;
    await ctx.sql`insert into public.event_participants (competition_id, user_id, joined_at) values (${ev!.id}, ${u}, ${new Date(t0 - 600_000)})`;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
    const s = samplePath(circlePath(destination(ORIGIN, 8000, 60), 260), { startT: t0 });
    const receipt = await uploadRun(ctx, u, s, loopEvents(s), ticket);
    await drain(ctx);

    const layers = await layersOf(receipt.territoryClaimId!);
    expect(layers.map((l) => l.kind)).toEqual(['event', 'permanent', 'public']);
    expect(layers.every((l) => l.status === 'eligible')).toBe(true);
    expect(new Set(layers.map((l) => l.cells)).size).toBe(1); // the same loop, the same cells, in every layer
    expect(layers[0]!.cells).toBeGreaterThan(10);
    // Only the run's race claim is attached to the activity (posts, history and exports see one result).
    const [n] = await ctx.sql`select count(*)::int as n from public.loop_claims where activity_id = ${receipt.activityId}`;
    expect(n!.n).toBe(1);
  });

  it('holds every layer while the run is reviewed, keeps one case, and evaluates again when cleared', async () => {
    const u = await createUser(ctx.sql, 'layer_cyclist');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const t0 = Date.now() - 2 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
    const s = samplePath(circlePath(destination(ORIGIN, 10_000, 30), 260), { startT: t0, speedMps: 5 });
    const flag: RecordingEvent = { kind: 'steps_check', t: s[200]!.t, afterSeq: 200, data: { result: 'no_running_steps', from: s[100]!.t, to: s[200]!.t } };
    const receipt = await uploadRun(ctx, u, s, loopEvents(s, [flag]), ticket);
    await drain(ctx);

    const held = await layersOf(receipt.territoryClaimId!);
    expect(held.map((l) => `${l.kind}:${l.status}`)).toEqual(['permanent:pending_review', 'public:pending_review']);
    const cases = await ctx.sql`select object_id from public.integrity_cases where subject_user_id = ${u} and kind = 'loop_claim'`;
    expect(cases.map((c) => c.object_id)).toEqual([receipt.territoryClaimId]); // the review trail sits on the race claim

    // A reviewer finds the phone was in a pocket while the runner ran: the run is evaluated again.
    await ctx.sql`select internal.restore_claim(${receipt.territoryClaimId}::uuid, null)`;
    await drain(ctx);
    const cleared = await layersOf(receipt.territoryClaimId!);
    expect(cleared.map((l) => `${l.kind}:${l.status}`)).toEqual(['permanent:eligible', 'public:eligible']);
    expect(cleared[0]!.reasons).not.toContain('no_running_steps');
  });

  it('heals a run whose other layers were left waiting', async () => {
    const u = await createUser(ctx.sql, 'layer_waiting');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const t0 = Date.now() - 4 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
    const s = samplePath(circlePath(destination(ORIGIN, 9000, 120), 240), { startT: t0 });
    const receipt = await uploadRun(ctx, u, s, loopEvents(s), ticket);
    await drain(ctx);
    // Simulate a deploy between upload and evaluation: the map claim missed its evaluation.
    await ctx.sql`delete from internal.cell_control where claim_id in (select id from public.loop_claims where parent_claim_id = ${receipt.territoryClaimId})`;
    await ctx.sql`delete from internal.territory_events where claim_id in (select id from public.loop_claims where parent_claim_id = ${receipt.territoryClaimId})`;
    await ctx.sql`delete from internal.claim_cells where claim_id in (select id from public.loop_claims where parent_claim_id = ${receipt.territoryClaimId})`;
    await ctx.sql`update public.loop_claims set status = 'processing', created_at = now() - interval '20 minutes' where parent_claim_id = ${receipt.territoryClaimId}`;
    const [swept] = await ctx.sql`select internal.enqueue_waiting_layers(50) as n`;
    expect(swept!.n).toBeGreaterThanOrEqual(1);
    await drain(ctx);
    const layers = await layersOf(receipt.territoryClaimId!);
    expect(layers.map((l) => `${l.kind}:${l.status}`)).toEqual(['permanent:eligible', 'public:eligible']);
  });
});
