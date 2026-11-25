import { afterAll, describe, expect, it } from 'vitest';
import { fetchWalkingLeg, parseSnapRequest, snapLeg } from '../../../supabase/functions/_shared/api/routeSnap.ts';
import { createUser, makeCtx } from './helpers.ts';

const A = { lat: 24.8607, lng: 67.0011 };
const B = { lat: 24.865, lng: 67.006 };
const LINE = 'mkvvCan~xKgEeB_DmF';
const answer = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });
const mapboxOk = answer(200, { routes: [{ geometry: LINE, distance: 812.4 }] });

describe('path following (route-snap)', () => {
  const ctx = makeCtx(2);
  afterAll(async () => {
    await ctx.sql`update public.app_config set value = '200' where key = 'route_snap_daily_cap'`;
    await ctx.sql.end();
  });

  it('reads only two valid points', () => {
    expect(parseSnapRequest({ from: A, to: B })).toEqual({ from: A, to: B });
    expect(() => parseSnapRequest({ from: A })).toThrow('bad_request');
    expect(() => parseSnapRequest({ from: { lat: 91, lng: 0 }, to: B })).toThrow('bad_request');
    expect(() => parseSnapRequest({ from: { lat: '24.8', lng: 67 }, to: B })).toThrow('bad_request');
  });

  it('asks Mapbox for a walking line and passes back only the line and its length', async () => {
    let asked = '';
    const r = await fetchWalkingLeg(async (url) => {
      asked = url;
      return mapboxOk();
    }, 'pk.test', { from: A, to: B });
    expect(asked).toContain('/directions/v5/mapbox/walking/67.001100,24.860700;67.006000,24.865000?');
    expect(asked).toContain('geometries=polyline');
    expect(r).toEqual({ snapped: true, path: LINE, distance_m: 812 });
  });

  it('falls back to a straight leg when Mapbox is busy, refuses, finds nothing or is unreachable', async () => {
    const req = { from: A, to: B };
    expect(await fetchWalkingLeg(answer(429), 'pk.test', req)).toEqual({ snapped: false, reason: 'busy' });
    expect(await fetchWalkingLeg(answer(401), 'pk.test', req)).toEqual({ snapped: false, reason: 'unavailable' });
    expect(await fetchWalkingLeg(answer(422), 'pk.test', req)).toEqual({ snapped: false, reason: 'no_route' });
    expect(await fetchWalkingLeg(answer(200, { routes: [] }), 'pk.test', req)).toEqual({ snapped: false, reason: 'no_route' });
    expect(await fetchWalkingLeg(async () => { throw new Error('offline'); }, 'pk.test', req)).toEqual({ snapped: false, reason: 'error' });
  });

  it("counts each request against the runner's daily cap, and needs a token", async () => {
    const user = await createUser(ctx.sql, `snapper_${Date.now()}`);
    await ctx.sql`update public.app_config set value = '2' where key = 'route_snap_daily_cap'`;
    expect(await snapLeg(ctx.sql, undefined, user, { from: A, to: B }, mapboxOk)).toEqual({ snapped: false, reason: 'unavailable' });
    expect((await snapLeg(ctx.sql, 'pk.test', user, { from: A, to: B }, mapboxOk)).snapped).toBe(true);
    expect((await snapLeg(ctx.sql, 'pk.test', user, { from: A, to: B }, mapboxOk)).snapped).toBe(true);
    expect(await snapLeg(ctx.sql, 'pk.test', user, { from: A, to: B }, mapboxOk)).toEqual({ snapped: false, reason: 'capped' });
    const [row] = await ctx.sql`select requests from internal.route_snap_usage where user_id = ${user}`;
    expect(row?.requests).toBe(2);
  });

  it('never asks for very long legs', async () => {
    const user = await createUser(ctx.sql, `far_${Date.now()}`);
    let called = false;
    const r = await snapLeg(ctx.sql, 'pk.test', user, { from: A, to: { lat: 25.2, lng: 67.4 } }, async () => {
      called = true;
      return mapboxOk();
    });
    expect(r).toEqual({ snapped: false, reason: 'no_route' });
    expect(called).toBe(false);
  });
});
