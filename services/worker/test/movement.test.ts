import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, loopEvents, ORIGIN, samplePath } from '../../../packages/core/test/fixtures.ts';
import { destination, type LocationSample, type RecordingEvent } from '../../../packages/core/src/index.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import type { Sql } from '../../../supabase/functions/_shared/clients.ts';
import { COMP, createUser, drain, grantConsent, makeCtx, SEASON, uploadRun } from './helpers.ts';

const ctx = makeCtx(8);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const asUser = async <T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> =>
  (sql as unknown as { begin<R>(cb: (tx: Sql) => Promise<R>): Promise<R> }).begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    return fn(tx);
  });

const runEvents = (s: readonly LocationSample[]): RecordingEvent[] => [
  { kind: 'start', t: s[0]!.t, afterSeq: -1 },
  { kind: 'finish', t: s[s.length - 1]!.t, afterSeq: s[s.length - 1]!.seq }
];
const balance = async (u: string) => (await asUser(ctx.sql, u, (tx) => tx`select balance from public.my_movement()`))[0]!.balance as number;
const earned = async (u: string, activityId: string) =>
  (await asUser(ctx.sql, u, (tx) => tx`select points, verified_distance_m from public.activity_movement(${activityId}::uuid)`))[0]!;

describe('movement points from the upload pipeline', () => {
  it('a private run (no ticket, no contest) earns points from its server-verified distance', async () => {
    const u = await createUser(ctx.sql, 'quiet_runner');
    const s = samplePath([destination(ORIGIN, 9000, 0), destination(ORIGIN, 11_500, 0)], { speedMps: 3, startT: Date.now() - 5 * 3600_000 });
    const receipt = await uploadRun(ctx, u, s, runEvents(s), null);
    expect(receipt.territoryClaimId).toBeNull();
    await drain(ctx);
    const e = await earned(u, receipt.activityId);
    expect(e.verified_distance_m).toBeGreaterThan(2450);
    expect(e.points).toBe(Math.floor(e.verified_distance_m / 100));
    expect(await balance(u)).toBe(e.points);
    // The run itself stays private: no claim, no post.
    const [claims] = await ctx.sql`select count(*)::int as n from public.loop_claims where user_id = ${u}`;
    expect(claims!.n).toBe(0);
  });

  it('mocked locations earn nothing, and deleting a run takes its points back', async () => {
    const u = await createUser(ctx.sql, 'spoofer');
    const start = Date.now() - 6 * 3600_000;
    const fake = samplePath([destination(ORIGIN, 12_000, 0), destination(ORIGIN, 15_000, 0)], { speedMps: 3, startT: start, mocked: true });
    const fakeReceipt = await uploadRun(ctx, u, fake, runEvents(fake), null);
    const real = samplePath([destination(ORIGIN, 16_000, 0), destination(ORIGIN, 18_000, 0)], { speedMps: 3, startT: start + 3600_000 });
    const realReceipt = await uploadRun(ctx, u, real, runEvents(real), null);
    await drain(ctx);
    expect((await earned(u, fakeReceipt.activityId)).points).toBe(0);
    const realPoints = (await earned(u, realReceipt.activityId)).points as number;
    expect(realPoints).toBeGreaterThan(15);
    expect(await balance(u)).toBe(realPoints);

    await asUser(ctx.sql, u, (tx) => tx`select public.delete_activity(${realReceipt.activityId}::uuid)`);
    await drain(ctx);
    expect(await balance(u)).toBe(0);
  });
});

describe('reclaiming land lost to another runner (end to end)', () => {
  it('returns cells the runner held, charges the exact cost once, and blocks points ping-pong', async () => {
    const first = await createUser(ctx.sql, 'reclaim_first');
    const second = await createUser(ctx.sql, 'reclaim_second');
    await grantConsent(ctx.sql, first, ['territory_competition']);
    await grantConsent(ctx.sql, second, ['territory_competition']);
    const center = destination(ORIGIN, 6000, 135);
    const start = Date.now() - 4 * 3600_000;
    const run = async (u: string, t0: number) => {
      const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, t0 - 60_000);
      const s = samplePath(circlePath(center, 260), { startT: t0 });
      await uploadRun(ctx, u, s, loopEvents(s), ticket);
      await drain(ctx);
    };
    await run(first, start);
    await run(second, start + 40 * 60_000); // the same loop later takes the ground
    await ctx.sql`select internal.publish_due_territory(500)`;

    const lost = await asUser(ctx.sql, first, (tx) => tx`select cell, reclaimable, cost from public.my_lost_cells(${COMP}::uuid, ${SEASON}::uuid)`);
    expect(lost.length).toBeGreaterThan(20);
    expect(lost.every((c) => c.reclaimable && c.cost === 3)).toBe(true);
    const before = await balance(first);
    expect(before).toBeGreaterThanOrEqual(9); // the loop run itself earned points

    const pick = lost.slice(0, 3).map((c) => c.cell as string);
    const request = crypto.randomUUID();
    const reclaim = () => asUser(ctx.sql, first, (tx) => tx`select public.reclaim_cells(${request}::uuid, ${COMP}::uuid, ${SEASON}::uuid, ${pick}::text[]) as r`);
    const [{ r }] = (await reclaim()) as unknown as [{ r: { reclaimed: number; spent: number; balance: number } }];
    expect(r).toMatchObject({ reclaimed: 3, spent: 9, balance: before - 9 });
    await reclaim(); // a retried tap is answered, not charged again
    expect(await balance(first)).toBe(before - 9);

    const [held] = await ctx.sql`select count(*)::int as n from internal.cell_control_public where competition_id = ${COMP} and controller_id = ${first} and cell = any(${pick}::bigint[])`;
    expect(held!.n).toBe(3);
    const blocked = await asUser(ctx.sql, second, (tx) => tx`select blocked_reason from public.my_lost_cells(${COMP}::uuid, ${SEASON}::uuid) where cell = any(${pick}::text[])`);
    expect(blocked.map((b) => b.blocked_reason)).toEqual(['taken_with_points', 'taken_with_points', 'taken_with_points']);
  });
});
