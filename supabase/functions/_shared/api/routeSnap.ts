import { haversineMeters, type LatLng } from '../core/index.ts';
import { HttpError } from '../http.ts';
import type { Sql } from '../clients.ts';

/**
 * Path following for the route builder: one leg between two tapped points, along streets, footpaths and
 * trails (Mapbox walking directions). The runner's daily count and the switches are checked first; the
 * points are passed to Mapbox and never stored or logged here. Anything that stops path following
 * (switched off, the daily cap, Mapbox busy or down, no token) answers `snapped: false` with a reason, and the
 * app draws a straight leg instead.
 */

export interface SnapRequest {
  from: LatLng;
  to: LatLng;
}

export type SnapResult =
  | { snapped: true; path: string; distance_m: number }
  | { snapped: false; reason: 'paused' | 'capped' | 'unavailable' | 'busy' | 'no_route' | 'error' };

/** The longest single leg we ask for; longer gaps are drawn straight. */
export const MAX_LEG_M = 10_000;

function point(v: unknown): LatLng | null {
  if (!v || typeof v !== 'object') return null;
  const { lat, lng } = v as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function parseSnapRequest(body: unknown): SnapRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const from = point(b.from);
  const to = point(b.to);
  if (!from || !to) throw new HttpError(400, 'bad_request');
  return { from, to };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Asks Mapbox for the walking line between two points. */
export async function fetchWalkingLeg(fetcher: Fetch, token: string, req: SnapRequest): Promise<SnapResult> {
  const coords = `${req.from.lng.toFixed(6)},${req.from.lat.toFixed(6)};${req.to.lng.toFixed(6)},${req.to.lat.toFixed(6)}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=polyline&overview=full&alternatives=false&access_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    return { snapped: false, reason: 'error' };
  }
  if (res.status === 429) return { snapped: false, reason: 'busy' };
  if (res.status === 401 || res.status === 403) return { snapped: false, reason: 'unavailable' };
  if (!res.ok) return { snapped: false, reason: res.status === 422 ? 'no_route' : 'error' };
  const data = (await res.json().catch(() => null)) as { routes?: { geometry?: unknown; distance?: unknown }[] } | null;
  const route = data?.routes?.[0];
  if (!route || typeof route.geometry !== 'string' || !route.geometry || typeof route.distance !== 'number') return { snapped: false, reason: 'no_route' };
  return { snapped: true, path: route.geometry, distance_m: Math.round(route.distance) };
}

/** The whole request: checks, the runner's count, then Mapbox. */
export async function snapLeg(sql: Sql, token: string | undefined, userId: string, req: SnapRequest, fetcher: Fetch = fetch): Promise<SnapResult> {
  if (haversineMeters(req.from, req.to) > MAX_LEG_M) return { snapped: false, reason: 'no_route' };
  if (!token) return { snapped: false, reason: 'unavailable' };
  const [row] = await sql`select internal.take_route_snap(${userId}::uuid) as outcome`;
  const outcome = String(row?.outcome ?? 'paused');
  if (outcome !== 'ok') return { snapped: false, reason: outcome === 'capped' ? 'capped' : 'paused' };
  return fetchWalkingLeg(fetcher, token, req);
}
