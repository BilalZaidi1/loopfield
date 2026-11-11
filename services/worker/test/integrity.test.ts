import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, loopEvents, ORIGIN, samplePath } from '../../../packages/core/test/fixtures.ts';
import { destination, type LocationSample, type RecordingEvent } from '../../../packages/core/src/index.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import { COMP, createUser, drain, grantConsent, makeCtx, uploadRun } from './helpers.ts';

const ctx = makeCtx(8);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const runEvents = (s: readonly LocationSample[]): RecordingEvent[] => [
  { kind: 'start', t: s[0]!.t, afterSeq: -1 },
  { kind: 'finish', t: s[s.length - 1]!.t, afterSeq: s[s.length - 1]!.seq }
];

describe('movement integrity on the server', () => {
  it('marks a run that drove part of the way, keeps it on the review trail and pays only the running', async () => {
    const u = await createUser(ctx.sql, 'car_passenger');
    const t0 = Date.now() - 7 * 3600_000;
    const a = destination(ORIGIN, 20_000, 0);
    const b = destination(a, 1000, 0);
    const c = destination(b, 3000, 0);
    const run1 = samplePath([a, b], { speedMps: 3, startT: t0 });
    const car = samplePath([b, c], { speedMps: 14, startT: run1[run1.length - 1]!.t + 1000 }, run1.length);
    const s = [...run1, ...car];
    const receipt = await uploadRun(ctx, u, s, runEvents(s), null);
    await drain(ctx);
    const [act] = await ctx.sql`select integrity_flags from public.activities where id = ${receipt.activityId}`;
    expect(act!.integrity_flags).toEqual(expect.arrayContaining(['implausible_speed', 'suspicious_speed']));
    const [cs] = await ctx.sql`select kind, opened_by, hold_from_competition, signals from public.integrity_cases where object_id = ${receipt.activityId}`;
    expect(cs).toMatchObject({ kind: 'activity', opened_by: 'system', hold_from_competition: false });
    expect((cs!.signals as { reasons: string[] }).reasons).toContain('implausible_speed');
    const [m] = await ctx.sql`select coalesce(sum(amount), 0)::int as pts from internal.movement_ledger where activity_id = ${receipt.activityId}`;
    expect(m!.pts).toBeGreaterThan(5);
    expect(m!.pts).toBeLessThanOrEqual(10); // ~1 km of running, never the 3 km in the car
  });

  it('holds a loop for review when the phone counted no running steps, and opens a case', async () => {
    const u = await createUser(ctx.sql, 'quiet_cyclist');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const t0 = Date.now() - 3 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
    const s = samplePath(circlePath(destination(ORIGIN, 9000, 200), 260), { startT: t0, speedMps: 5 });
    const flag: RecordingEvent = { kind: 'steps_check', t: s[200]!.t, afterSeq: 200, data: { result: 'no_running_steps', from: s[100]!.t, to: s[200]!.t } };
    const receipt = await uploadRun(ctx, u, s, loopEvents(s, [flag]), ticket);
    await drain(ctx);
    const [claim] = await ctx.sql`select status, reasons from public.loop_claims where id = ${receipt.territoryClaimId}`;
    expect(claim).toMatchObject({ status: 'pending_review', reasons: ['no_running_steps'] });
    const [cs] = await ctx.sql`select hold_from_competition, signals from public.integrity_cases where object_id = ${receipt.territoryClaimId}`;
    expect(cs!.hold_from_competition).toBe(true);
    expect((cs!.signals as { reasons: string[] }).reasons).toEqual(['no_running_steps']);
    const [owned] = await ctx.sql`select count(*)::int as n from internal.cell_control where controller_id = ${u}`;
    expect(owned!.n).toBe(0); // held runs capture nothing
  });

  it('applies thresholds tuned from the backend', async () => {
    await ctx.sql`update public.app_config set value = '{"version": "strict", "stepsMinCadence": 160}'::jsonb where key = 'integrity_overrides'`;
    try {
      const u = await createUser(ctx.sql, 'tuned_runner');
      const t0 = Date.now() - 2 * 3600_000;
      const s = samplePath([destination(ORIGIN, 30_000, 90), destination(ORIGIN, 32_000, 90)], { startT: t0 });
      const receipt = await uploadRun(ctx, u, s, runEvents(s), null);
      await drain(ctx);
      const [row] = await ctx.sql`select rule_version from internal.movement_ledger where activity_id = ${receipt.activityId} and kind = 'run'`;
      expect(row!.rule_version).toBe('movement-2026.11.0-proposed');
      const [act] = await ctx.sql`select integrity_flags from public.activities where id = ${receipt.activityId}`;
      expect(act!.integrity_flags).toEqual([]);
    } finally {
      await ctx.sql`update public.app_config set value = '{}'::jsonb where key = 'integrity_overrides'`;
    }
  });
});
