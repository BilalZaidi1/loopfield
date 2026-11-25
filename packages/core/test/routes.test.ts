import { describe, expect, it } from 'vitest';
import { destination, haversineMeters, pathLengthMeters, type LatLng } from '../src/geo/geo.ts';
import {
  EMPTY_PLAN,
  appendPoint,
  closingPoint,
  estimateSeconds,
  isLoopPath,
  outAndBackPlan,
  planDistance,
  planPath,
  planProblem,
  removeLastPoint,
  reversePlan,
  straightLeg,
  usualPace
} from '../src/routes/plan.ts';
import { FOLLOW_START, followSteps, remainingM, routeGeometry, type FollowFix } from '../src/routes/follow.ts';
import { alertBucket, sanitizeEvent } from '../src/analytics/events.ts';
import { ORIGIN, T0 } from './fixtures.ts';

/** A point `m` metres east (90°) or north (0°) of the origin. */
const east = (m: number, from: LatLng = ORIGIN) => destination(from, m, 90);
const north = (m: number, from: LatLng = ORIGIN) => destination(from, m, 0);

/** Fixes along a path at a steady speed, one per second, optionally pushed sideways by `offsetM` metres between two times. */
function run(path: LatLng[], opts: { speed?: number; acc?: number; startT?: number } = {}): FollowFix[] {
  const speed = opts.speed ?? 3;
  const out: FollowFix[] = [];
  const total = pathLengthMeters(path);
  for (let s = 0; s * speed <= total; s++) {
    let d = s * speed;
    let i = 1;
    while (i < path.length && d > haversineMeters(path[i - 1]!, path[i]!)) {
      d -= haversineMeters(path[i - 1]!, path[i]!);
      i++;
    }
    const a = path[Math.min(i - 1, path.length - 1)]!;
    const b = path[Math.min(i, path.length - 1)]!;
    const seg = haversineMeters(a, b);
    const f = seg > 0 ? d / seg : 0;
    out.push({ t: (opts.startT ?? T0) + s * 1000, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, acc: opts.acc ?? 5 });
  }
  return out;
}

const OPTS = { offRouteM: 40, offRouteSeconds: 15 };

describe('planning a route', () => {
  it('joins legs without repeating the shared points, and measures the line', () => {
    let plan = appendPoint(EMPTY_PLAN, ORIGIN, null);
    plan = appendPoint(plan, east(500), null);
    plan = appendPoint(plan, north(500, east(500)), { path: [east(500), north(250, east(520)), north(500, east(500))], snapped: true });
    const path = planPath(plan);
    expect(path).toHaveLength(4);
    expect(planDistance(plan)).toBeGreaterThan(1000);
    expect(plan.legs).toHaveLength(2);
    expect(removeLastPoint(plan).points).toHaveLength(2);
    expect(removeLastPoint(appendPoint(EMPTY_PLAN, ORIGIN, null))).toEqual(EMPTY_PLAN);
  });

  it('reverses, runs out and back, and closes a loop', () => {
    let plan = appendPoint(EMPTY_PLAN, ORIGIN, null);
    plan = appendPoint(plan, east(600), null);
    plan = appendPoint(plan, north(400, east(600)), null);
    const d = planDistance(plan);
    expect(planDistance(reversePlan(plan))).toBeCloseTo(d, 3);
    expect(reversePlan(plan).points[0]).toEqual(plan.points[2]);
    const oab = outAndBackPlan(plan);
    expect(planDistance(oab)).toBeCloseTo(2 * d, 3);
    expect(isLoopPath(planPath(oab))).toBe(true);
    expect(isLoopPath(planPath(plan))).toBe(false);
    const back = closingPoint(plan)!;
    expect(back).toEqual(ORIGIN);
    expect(isLoopPath(planPath(appendPoint(plan, back, straightLeg(plan.points[2]!, back))))).toBe(true);
  });

  it('estimates time at the usual pace and ignores faulty paces', () => {
    expect(usualPace([])).toBe(390);
    expect(usualPace([300, 360, 330, 20, 5000, null])).toBe(330);
    expect(usualPace([300, 360])).toBe(330);
    expect(estimateSeconds(5000, 330)).toBe(1650);
    expect(estimateSeconds(0, 330)).toBe(0);
  });

  it('says why a plan cannot be saved', () => {
    const line = [ORIGIN, east(800)];
    expect(planProblem('Morning loop', line)).toBeNull();
    expect(planProblem('  ', line)).toBe('name_missing');
    expect(planProblem('x'.repeat(61), line)).toBe('name_too_long');
    expect(planProblem('Short', [ORIGIN, east(20)])).toBe('too_short');
    expect(planProblem('Far', [ORIGIN, east(250_000)])).toBe('too_long');
  });
});

describe('following a route', () => {
  const route = [ORIGIN, east(1000), north(600, east(1000))];
  const geom = routeGeometry(route);

  it('stays quiet while the runner keeps to the line, and tracks progress', () => {
    const r = followSteps(geom, FOLLOW_START, run(route), OPTS);
    expect(r.events).toEqual([]);
    expect(r.snap.state).toBe('on');
    expect(remainingM(geom, r.snap)).toBeLessThan(5);
  });

  it('alerts after 15 seconds beyond 40 m, and once the runner is back', () => {
    const along = run([ORIGIN, east(400)]);
    const t1 = along[along.length - 1]!.t;
    // A detour 80 m north of the line for 30 seconds, then back onto it.
    const away = run([north(80, east(400)), north(80, east(480))], { startT: t1 + 1000 });
    const t2 = away[away.length - 1]!.t;
    const back = run([east(490), east(700)], { startT: t2 + 1000 });
    const r = followSteps(geom, FOLLOW_START, [...along, ...away, ...back], OPTS);
    expect(r.events).toEqual(['off_route', 'back_on_route']);
    expect(r.snap.alerts).toBe(1);
  });

  it('ignores short GPS jumps and inaccurate fixes', () => {
    const fixes = run([ORIGIN, east(600)]);
    // Ten seconds of fixes thrown 60 m sideways: shorter than the 15-second wait.
    for (let i = 50; i < 60; i++) fixes[i] = { ...fixes[i]!, ...north(60, fixes[i]!) };
    // Fixes 100 m out but with 80 m accuracy are ignored entirely.
    for (let i = 100; i < 130; i++) fixes[i] = { ...fixes[i]!, ...north(100, fixes[i]!), acc: 80 };
    expect(followSteps(geom, FOLLOW_START, fixes, OPTS).events).toEqual([]);
  });

  it('waits until the runner reaches the route before checking', () => {
    const toStart = run([north(300), ORIGIN]);
    const r = followSteps(geom, FOLLOW_START, toStart, OPTS);
    expect(r.events).toEqual([]);
    expect(r.snap.state).toBe('on');
    expect(followSteps(geom, FOLLOW_START, run([north(500), north(300)]), OPTS).snap.state).toBe('waiting');
  });

  it('follows an out-and-back on the same street without false alerts, to the end', () => {
    const out = [ORIGIN, east(800), ORIGIN];
    const g = routeGeometry(out);
    const r = followSteps(g, FOLLOW_START, run(out), OPTS);
    expect(r.events).toEqual([]);
    expect(remainingM(g, r.snap)).toBeLessThan(10);
  });

  it('carries on from a saved snapshot exactly as in one go', () => {
    const fixes = run(route);
    const half = Math.floor(fixes.length / 2);
    const a = followSteps(geom, FOLLOW_START, fixes.slice(0, half), OPTS);
    const b = followSteps(geom, JSON.parse(JSON.stringify(a.snap)), fixes.slice(half), OPTS);
    expect(b.snap).toEqual(followSteps(geom, FOLLOW_START, fixes, OPTS).snap);
  });
});

describe('analytics for routes', () => {
  it('sends buckets only', () => {
    expect(alertBucket(0)).toBe('0');
    expect(alertBucket(3)).toBe('2-5');
    expect(alertBucket(9)).toBe('6+');
    const e = sanitizeEvent('run_saved', { followed: 'planned', off_route_alerts: '1', marker: 'picture', route_name: 'Home loop' });
    expect(e.properties).toEqual({ followed: 'planned', off_route_alerts: '1', marker: 'picture' });
    expect(sanitizeEvent('route_planned', { action: 'created', distance_bucket: '5-10km', loop: true, snapped: false }).dropped).toEqual([]);
  });
});
