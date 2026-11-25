import { makeProjector, type LatLng, type XY } from '../geo/geo.ts';

/**
 * Following a route during a run: how far along it the runner is, and whether they have left it. The
 * check is a pure step function over a small snapshot, so the background location task can save the
 * snapshot after each batch of fixes and carry on after the app is restarted.
 *
 * Matching looks near the last matched point first, so a loop that crosses itself or an out-and-back on
 * the same street doesn't jump the runner to the wrong part of the route. Following never changes the game:
 * land, loops and speed times are judged on what was actually run.
 */

export interface FollowOptions {
  /** Further than this from the line counts as off the route. */
  offRouteM: number;
  /** How long the runner must stay off before the alert. */
  offRouteSeconds: number;
  /** Closer than this counts as back on the route (below `offRouteM`, so the state doesn't flicker). */
  backOnM?: number;
  /** Fixes less accurate than this are ignored. */
  maxAccuracyM?: number;
  /** How far behind and ahead of the last match to look first. */
  searchBackM?: number;
  searchAheadM?: number;
}

export const FOLLOW_DEFAULTS = { offRouteM: 40, offRouteSeconds: 15, backOnM: 25, maxAccuracyM: 30, searchBackM: 150, searchAheadM: 400 } as const;

export interface RouteGeometry {
  origin: LatLng;
  xy: XY[];
  /** Distance along the route at each point. */
  cum: number[];
  total: number;
}

export function routeGeometry(route: readonly LatLng[]): RouteGeometry {
  if (!route.length) return { origin: { lat: 0, lng: 0 }, xy: [], cum: [], total: 0 };
  const origin = route[0]!;
  const proj = makeProjector(origin);
  const xy = route.map(proj.toXY);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1]! + Math.hypot(xy[i]!.x - xy[i - 1]!.x, xy[i]!.y - xy[i - 1]!.y));
  return { origin, xy, cum, total: cum[cum.length - 1]! };
}

export type FollowState = 'waiting' | 'on' | 'off';

export interface FollowSnapshot {
  /** `waiting` until the runner first reaches the route; no alerts before that. */
  state: FollowState;
  /** Distance along the route of the last match. */
  progressM: number;
  /** When the runner went beyond `offRouteM` (epoch ms), while still counting towards the alert. */
  offSince: number | null;
  /** Off-route alerts so far in this run. */
  alerts: number;
  /** Time of the last fix used. */
  lastT: number;
  /** Distance from the line at the last fix used. */
  distanceM: number | null;
}

export const FOLLOW_START: FollowSnapshot = { state: 'waiting', progressM: 0, offSince: null, alerts: 0, lastT: 0, distanceM: null };

export type FollowEvent = 'off_route' | 'back_on_route';

export interface FollowFix {
  t: number;
  lat: number;
  lng: number;
  acc: number | null;
}

interface Match {
  distanceM: number;
  alongM: number;
}

/**
 * The closest point of the route between `fromM` and `toM`. With a `progressM`, going backwards along the
 * route costs a little extra, so where the route runs over the same street twice (an out-and-back, a
 * loop that crosses itself) the runner is matched to the part that comes next.
 */
function nearest(geom: RouteGeometry, p: XY, fromM: number, toM: number, progressM: number | null = null): Match | null {
  let best: (Match & { score: number }) | null = null;
  for (let i = 1; i < geom.xy.length; i++) {
    if (geom.cum[i]! < fromM || geom.cum[i - 1]! > toM) continue;
    const a = geom.xy[i - 1]!;
    const b = geom.xy[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    const along = geom.cum[i - 1]! + t * Math.sqrt(len2);
    const score = progressM == null ? d : d + 0.25 * Math.max(0, progressM - along);
    if (!best || score < best.score) best = { distanceM: d, alongM: along, score };
  }
  return best ? { distanceM: best.distanceM, alongM: best.alongM } : null;
}

/** One fix: the new snapshot, and the alert to give, if any. */
export function followStep(geom: RouteGeometry, snap: FollowSnapshot, fix: FollowFix, options: FollowOptions): { snap: FollowSnapshot; event: FollowEvent | null } {
  const o = { ...FOLLOW_DEFAULTS, ...options };
  const backOn = Math.min(o.backOnM, o.offRouteM);
  if (geom.xy.length < 2 || fix.t <= snap.lastT) return { snap, event: null };
  if (fix.acc != null && fix.acc > o.maxAccuracyM) return { snap, event: null };
  const p = makeProjector(geom.origin).toXY(fix);
  let m: Match | null = null;
  if (snap.state !== 'waiting') {
    m = nearest(geom, p, snap.progressM - o.searchBackM, snap.progressM + o.searchAheadM, snap.progressM);
    // Clearly back on another part of the route (a shortcut, or rejoining further on): take that match.
    if (!m || m.distanceM > o.offRouteM) {
      const anywhere = nearest(geom, p, -Infinity, Infinity);
      if (anywhere && anywhere.distanceM <= backOn) m = anywhere;
    }
  } else {
    m = nearest(geom, p, -Infinity, Infinity);
  }
  if (!m) return { snap, event: null };

  const next: FollowSnapshot = { ...snap, lastT: fix.t, distanceM: m.distanceM };
  if (snap.state === 'waiting') {
    if (m.distanceM <= backOn) {
      next.state = 'on';
      next.progressM = m.alongM;
    }
    return { snap: next, event: null };
  }
  if (m.distanceM <= o.offRouteM) {
    next.progressM = m.alongM;
    next.offSince = null;
    if (snap.state === 'off' && m.distanceM <= backOn) {
      next.state = 'on';
      return { snap: next, event: 'back_on_route' };
    }
    return { snap: next, event: null };
  }
  // Beyond the limit: count the time, and alert once it has lasted long enough.
  next.offSince = snap.offSince ?? fix.t;
  if (snap.state === 'on' && fix.t - next.offSince >= o.offRouteSeconds * 1000) {
    next.state = 'off';
    next.alerts = snap.alerts + 1;
    return { snap: next, event: 'off_route' };
  }
  return { snap: next, event: null };
}

/** Several fixes in time order; returns every alert given along the way. */
export function followSteps(geom: RouteGeometry, snap: FollowSnapshot, fixes: readonly FollowFix[], options: FollowOptions): { snap: FollowSnapshot; events: FollowEvent[] } {
  let s = snap;
  const events: FollowEvent[] = [];
  for (const f of [...fixes].sort((a, b) => a.t - b.t)) {
    const r = followStep(geom, s, f, options);
    s = r.snap;
    if (r.event) events.push(r.event);
  }
  return { snap: s, events };
}

/** Distance left to the end of the route from the last match. */
export function remainingM(geom: RouteGeometry, snap: FollowSnapshot): number {
  return Math.max(0, geom.total - snap.progressM);
}
