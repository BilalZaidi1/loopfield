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

export interface Sketch {
  routes: string[];
  cells: string[];
  taken: string[];
  start: [number, number] | null;
  finish: [number, number] | null;
  arrows: SketchArrow[];
}

/**
 * Projects a shared route and its cells into a `width` × `height` box (equirectangular, scaled by the
 * latitude so shapes keep their proportions), centred with `pad` pixels to spare. Direction arrows sit at
 * even steps along the route; start and finish are the visible ends of the route (the server already left
 * out the first and last 200 m). Returns null when there is nothing to draw.
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
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of all) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * k, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const xy = ([lng, lat]: [number, number]): [number, number] => [offX + (lng - minLng) * k * scale, offY + (maxLat - lat) * scale];
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
  return {
    routes,
    cells: cellRings.filter((c) => !c.taken).map((c) => pts(c.ring)),
    taken: cellRings.filter((c) => c.taken).map((c) => pts(c.ring)),
    start: first ? [r(first[0]), r(first[1])] : null,
    finish: last ? [r(last[0]), r(last[1])] : null,
    arrows
  };
}
