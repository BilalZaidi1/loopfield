import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, ORIGIN, samplePath } from '../../../packages/core/test/fixtures.ts';
import { decodePolyline, destination, pathLengthMeters, type LatLng, type LocationSample, type RecordingEvent } from '../../../packages/core/src/index.ts';
import type { Sql } from '../../../supabase/functions/_shared/clients.ts';
import { deleteAccount, exportData } from '../../../supabase/functions/_shared/jobs/account.ts';
import type { JobRow } from '../../../supabase/functions/_shared/jobs/context.ts';
import { createUser, drain, makeCtx, uploadRun } from './helpers.ts';

const ctx = makeCtx(4);
afterAll(async () => {
  await ctx.sql`update public.app_config set value = 'false' where key = 'route_proposals_a_to_b'`;
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const asUser = async <T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> =>
  (sql as unknown as { begin<R>(cb: (tx: Sql) => Promise<R>): Promise<R> }).begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    return fn(tx);
  });

/** A private run (no ticket): start and finish only, as most runs are. */
const privateEvents = (s: readonly LocationSample[], extra: RecordingEvent[] = []): RecordingEvent[] => [
  { kind: 'start', t: s[0]!.t - 1000, afterSeq: -1 },
  ...extra,
  { kind: 'finish', t: s[s.length - 1]!.t + 1000, afterSeq: s[s.length - 1]!.seq }
];

async function processedRun(user: string, path: LatLng[], startT: number, extra?: (s: LocationSample[]) => RecordingEvent[]) {
  const samples = samplePath(path, { startT });
  const r = await uploadRun(ctx, user, samples, privateEvents(samples, extra?.(samples) ?? []), null);
  await drain(ctx);
  const [a] = await ctx.sql`select status, personal_route from public.activities where id = ${r.activityId}`;
  expect(a!.status).toBe('processed');
  return { id: r.activityId, line: decodePolyline(a!.personal_route as string) };
}

const propose = (user: string, activity: string, name: string, fromM: number, toM: number) =>
  asUser(ctx.sql, user, async (tx) => (await tx`select public.propose_route(${activity}::uuid, ${name}, 'route-v1', false, ${fromM}, ${toM}) as id`)[0]!.id as string);

const outcome = async (id: string) => {
  await drain(ctx);
  const [p] = await ctx.sql`select status, closed, length_m, decision_reason, from_m, to_m from public.route_proposals where id = ${id}`;
  return p!;
};

// Away from the routes other test files publish, inside the development region.
const BASE = destination(ORIGIN, 4000, 30);

describe('a speed route from part of a run', () => {
  let runner = '';
  it('cuts a lap out of a longer private run and sends it for review as a loop', async () => {
    runner = await createUser(ctx.sql, 'stretch_runner');
    // Running west: 600 m to the park, once round it, 600 m on.
    const lapPath = circlePath(destination(BASE, 350, 0), 350, 120, true, 180);
    const lap = pathLengthMeters(lapPath);
    const run = await processedRun(runner, [destination(BASE, 600, 90), ...lapPath, destination(BASE, 600, 270)], Date.now() - 5 * 3600_000);
    const id = await propose(runner, run.id, 'Park lap', 600, 600 + lap);
    const p = await outcome(id);
    expect(p.decision_reason).toBeNull();
    expect(p).toMatchObject({ status: 'pending_review', closed: true, from_m: 600 });
    expect(Math.abs(Number(p.length_m) - lap)).toBeLessThan(30);
    // The whole run (3.4 km, not a captured loop) was never proposed: only the lap's geometry is in the proposal.
    const [geo] = await ctx.sql`select extensions.st_length(path::extensions.geography) as m from public.route_proposals where id = ${id}`;
    expect(Math.abs(Number(geo!.m) - lap)).toBeLessThan(30);
  });

  it('declines a start-to-finish part while those are off, and sends it for review once they are on', async () => {
    const start = destination(BASE, 2500, 120);
    const run = await processedRun(runner, [start, destination(start, 3000, 90)], Date.now() - 4 * 3600_000);
    const off = await outcome(await propose(runner, run.id, 'River straight', 500, 2200));
    expect(off.status).toBe('declined');
    expect(off.decision_reason).toMatch(/only loops/);
    await ctx.sql`update public.app_config set value = 'true' where key = 'route_proposals_a_to_b'`;
    const on = await outcome(await propose(runner, run.id, 'River straight', 500, 2200));
    expect(on.decision_reason).toBeNull();
    expect(on).toMatchObject({ status: 'pending_review', closed: false });
    expect(Math.abs(Number(on.length_m) - 1700)).toBeLessThan(25);
    await ctx.sql`update public.app_config set value = 'false' where key = 'route_proposals_a_to_b'`;
  });

  it('declines a part with a pause in it, but not another part of the same run', async () => {
    runner = await createUser(ctx.sql, 'stretch_pauser');
    const start = destination(BASE, 2500, 200);
    const lapPath = circlePath(destination(start, 350, 0), 350, 120, true, 180);
    const lap = pathLengthMeters(lapPath);
    const run = await processedRun(runner, [destination(start, 600, 90), ...lapPath, ...lapPath.slice(1), destination(start, 600, 270)], Date.now() - 3 * 3600_000, (s) => {
      const at = s[Math.round(s.length * 0.3)]!; // inside the first lap
      return [{ kind: 'pause', t: at.t + 100, afterSeq: at.seq }, { kind: 'resume', t: at.t + 900, afterSeq: at.seq }];
    });
    const paused = await outcome(await propose(runner, run.id, 'Paused lap', 600, 600 + lap));
    expect(paused.status).toBe('declined');
    expect(paused.decision_reason).toContain('paused_interval');
    const second = await outcome(await propose(runner, run.id, 'Second lap', 600 + lap, 600 + 2 * lap));
    expect(second.decision_reason).toBeNull();
    expect(second.status).toBe('pending_review');
  });
});

describe('shoes in the data export and account deletion', () => {
  it('exports the runner\'s shoes with their totals, and deleting the account deletes them and their photos', async () => {
    const runner = await createUser(ctx.sql, 'shoe_leaver');
    const gearId = await asUser(ctx.sql, runner, async (tx) => (await tx`select public.save_gear(null, 'Blue trainers', 120000, null, true) as id`)[0]!.id as string);
    const photo = `${runner}/${gearId}-1.jpg`;
    await ctx.blobs.put('gear-photos', photo, new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
    await asUser(ctx.sql, runner, (tx) => tx`select public.set_gear_photo(${gearId}::uuid, ${photo})`);
    const run = await processedRun(runner, [BASE, destination(BASE, 2000, 90)], Date.now() - 2 * 3600_000);
    const [a] = await ctx.sql`select gear_id from public.activities where id = ${run.id}`;
    expect(a!.gear_id).toBe(gearId); // the default pair, given by the database

    const [exp] = await ctx.sql`insert into public.data_exports (user_id) values (${runner}) returning id`;
    const job = (kind: string): JobRow => ({ id: 0, queue: 'account', kind, payload: {}, attempts: 1, max_attempts: 5 });
    await exportData({ export_id: exp!.id, user_id: runner }, ctx, job('export_data'));
    const [row] = await ctx.sql`select storage_path from public.data_exports where id = ${exp!.id}`;
    const data = JSON.parse(new TextDecoder().decode((await ctx.blobs.get('exports', row!.storage_path as string))!));
    expect(data.gear).toEqual([expect.objectContaining({ id: gearId, name: 'Blue trainers', has_photo: true, is_default: true, start_distance_m: 120000 })]);
    expect(Number(data.gear[0].distance_m)).toBeGreaterThan(121_900);
    expect(data.gear[0].photo_path).toBeUndefined();
    expect(data.activities.find((x: { id: string }) => x.id === run.id).gear_id).toBe(gearId);

    const [req] = await ctx.sql`insert into public.deletion_requests (user_id) values (${runner}) returning id`;
    await deleteAccount({ request_id: req!.id, user_id: runner }, ctx, job('delete_account'));
    expect(await ctx.blobs.list('gear-photos', runner)).toEqual([]);
    const [left] = await ctx.sql`select count(*)::int as n from public.gear where user_id = ${runner}`;
    expect(left!.n).toBe(0);
  });
});
