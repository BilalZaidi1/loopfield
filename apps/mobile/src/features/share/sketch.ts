import { decodePolyline } from '@loopfield/core';
import { cellPolygon } from '@/territory/h3';

/** What a shared run may show: route parts (encoded polylines, already trimmed by the server) and cells. */
export interface SketchInput {
  route?: readonly string[] | null;
  cells?: readonly string[] | null;
  /** Cells this run took from other runners (drawn with an edge). */
  taken?: readonly string[] | null;
}

export interface SketchArrow {
  x: number;
  y: number;
  /** Degrees, 0 = pointing right, clockwise (SVG). */
  angle: number;
}

/** The map view a sketch was drawn for: a street map with this centre and zoom lines up with it exactly. */
export interface SketchView {
  lng: number;
  lat: number;
  /** Mapbox zoom (the world is 512 × 2^zoom pixels wide). */
  zoom: number;
}

export interface Sketch {
  routes: string[];
  cells: string[];
  taken: string[];
  start: [number, number] | null;
  finish: [number, number] | null;
  arrows: SketchArrow[];
  view: SketchView;
}

/** Mapbox draws the world 512 pixels wide at zoom 0. */
const WORLD_PX = 512;
/** Closest a sketch zooms in, so a short route is not blown up to the size of a single building. */
export const MAX_SKETCH_ZOOM = 17;
const MAX_LAT = 85.05112878;

/** Web Mercator world coordinates in [0, 1] (x east, y south), the projection of the street map. */
export function mercator(lng: number, lat: number): [number, number] {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

function fromMercator(x: number, y: number): [number, number] {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

/**
 * Projects a shared route and its cells into a `width` × `height` box with Web Mercator (the street map's
 * projection), centred with `pad` pixels to spare and never closer than zoom 17. Direction arrows sit at
 * even steps along the route; start and finish are the visible ends of the route (the server already left
 * out the first and last 200 m). `view` is the centre and zoom of the box, for a street map underneath.
 * Returns null when there is nothing to draw.
 */
export function buildSketch(input: SketchInput, width: number, height: number, pad = 16, maxCells = 800): Sketch | null {
  const parts = (input.route ?? []).map((r) => decodePolyline(r).map((p) => [p.lng, p.lat] as [number, number])).filter((x) => x.length > 1);
  const cellSet = new Set(input.taken ?? []);
  const cellRings: { ring: [number, number][]; taken: boolean }[] = [];
  for (const c of (input.cells ?? []).slice(0, maxCells)) {
    const poly = cellPolygon(c);
    if (poly) cellRings.push({ ring: poly.coordinates[0] as [number, number][], taken: cellSet.has(c) });
  }
  const all = [...parts.flat(), ...cellRings.flatMap((c) => c.ring)];
  if (!all.length || width <= 0 || height <= 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lng, lat] of all) {
    const [x, y] = mercator(lng, lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(maxX - minX, 1e-12);
  const spanY = Math.max(maxY - minY, 1e-12);
  const fit = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY, WORLD_PX * 2 ** MAX_SKETCH_ZOOM);
  // The street map takes zoom to two decimals: draw at exactly that zoom (rounded down, so it still fits).
  const zoom = Math.floor(Math.log2(fit / WORLD_PX) * 100) / 100;
  const scale = WORLD_PX * 2 ** zoom;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const xy = ([lng, lat]: [number, number]): [number, number] => {
    const [x, y] = mercator(lng, lat);
    return [width / 2 + (x - cx) * scale, height / 2 + (y - cy) * scale];
  };
  const r = (n: number) => Math.round(n * 10) / 10;
  const pts = (ring: [number, number][]) => ring.map((c) => xy(c).map(r).join(',')).join(' ');

  const projected = parts.map((x) => x.map(xy));
  const routes = projected.map((x) => x.map(([a, b], i) => `${i ? 'L' : 'M'}${r(a)} ${r(b)}`).join(' '));
  const arrows: SketchArrow[] = [];
  const total = projected.reduce((sum, x) => sum + x.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - x[i - 1]![0], p[1] - x[i - 1]![1]) : s), 0), 0);
  const count = Math.min(6, Math.max(0, Math.floor(total / 70)));
  if (count) {
    const step = total / (count + 1);
    let next = step;
    let walked = 0;
    for (const x of projected) {
      for (let i = 1; i < x.length && arrows.length < count; i++) {
        const [ax, ay] = x[i - 1]!;
        const [bx, by] = x[i]!;
        const seg = Math.hypot(bx - ax, by - ay);
        while (seg > 0 && walked + seg >= next && arrows.length < count) {
          const t = (next - walked) / seg;
          arrows.push({ x: r(ax + (bx - ax) * t), y: r(ay + (by - ay) * t), angle: Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI) });
          next += step;
        }
        walked += seg;
      }
    }
  }
  const first = projected[0]?.[0] ?? null;
  const lastPart = projected[projected.length - 1];
  const last = lastPart ? lastPart[lastPart.length - 1]! : null;
  const [lng, lat] = fromMercator(cx, cy);
  return {
    routes,
    cells: cellRings.filter((c) => !c.taken).map((c) => pts(c.ring)),
    taken: cellRings.filter((c) => c.taken).map((c) => pts(c.ring)),
    start: first ? [r(first[0]), r(first[1])] : null,
    finish: last ? [r(last[0]), r(last[1])] : null,
    arrows,
    view: { lng, lat, zoom }
  };
}

/** Mapbox's dark base map: it suits the card's dark ground and the white route drawn over it. */
export const SHARE_MAP_STYLE = 'mapbox/dark-v11';

/**
 * A Mapbox static image of exactly the sketch's box (same centre and zoom), at twice the resolution, with
 * Mapbox's own logo and attribution. Null without a public token or for a box the API cannot draw.
 */
export function staticMapUrl(view: SketchView, width: number, height: number, token: string | null | undefined, style = SHARE_MAP_STYLE): string | null {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!token || w < 1 || h < 1 || w > 1280 || h > 1280 || !Number.isFinite(view.zoom)) return null;
  const zoom = Math.max(0, Math.min(22, view.zoom));
  return `https://api.mapbox.com/styles/v1/${style}/static/${view.lng.toFixed(6)},${view.lat.toFixed(6)},${zoom.toFixed(2)},0,0/${w}x${h}@2x?access_token=${encodeURIComponent(token)}`;
}
