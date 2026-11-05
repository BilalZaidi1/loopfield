import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
import { controllerColor } from '@/theme/tokens';

/**
 * Client-side rendering helpers only. Ownership is computed by the backend (PostGIS ledger); the app
 * turns published cell identifiers into polygons for display and never infers control itself.
 */
export interface ViewportCell {
  cell: string;
  status: 'controlled' | 'excluded';
  controller_key: string | null;
  controller_handle: string | null;
  controller_name: string | null;
  is_me: boolean;
}

export type Bounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export const MAX_VIEWPORT_DEG2 = 0.06; // mirrors the server guard in territory_viewport

export function boundsArea(b: Bounds): number {
  return (b.maxLng - b.minLng) * (b.maxLat - b.minLat);
}

/** Round to ~100 m so small pans reuse cached viewport queries. */
export function roundBounds(b: Bounds): Bounds {
  const r = (v: number, up: boolean) => (up ? Math.ceil(v * 1000) : Math.floor(v * 1000)) / 1000;
  return { minLng: r(b.minLng, false), minLat: r(b.minLat, false), maxLng: r(b.maxLng, true), maxLat: r(b.maxLat, true) };
}

export function cellPolygon(cell: string): GeoJSON.Polygon | null {
  if (!isValidCell(cell)) return null;
  const ring = cellToBoundary(cell, true) as [number, number][];
  return { type: 'Polygon', coordinates: [[...ring, ring[0]!]] };
}

export function cellCenter(cell: string): [number, number] | null {
  if (!isValidCell(cell)) return null;
  const [lat, lng] = cellToLatLng(cell);
  return [lng, lat];
}

export function cellsToFeatures(cells: ViewportCell[], palette: { landMine: string; unavailable: string }): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of cells) {
    const geometry = cellPolygon(c.cell);
    if (!geometry) continue;
    const color = c.status === 'excluded' ? palette.unavailable : c.is_me ? palette.landMine : controllerColor(c.controller_key ?? 'none');
    features.push({ type: 'Feature', id: c.cell, geometry, properties: { cell: c.cell, status: c.status, mine: c.is_me, color, handle: c.controller_handle ?? '' } });
  }
  return { type: 'FeatureCollection', features };
}

/** H3 indices stored as bigint are fetched as text (never JSON numbers, which lose precision). */
export function bigintCellToH3(text: string): string {
  return BigInt(text).toString(16);
}

export function plainCellsToFeatures(cells: string[], color: string): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const cell of cells) {
    const geometry = cellPolygon(cell);
    if (geometry) features.push({ type: 'Feature', id: cell, geometry, properties: { cell, color } });
  }
  return { type: 'FeatureCollection', features };
}

export function lineFeature(coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props };
}

export function boundsOf(coords: [number, number][]): Bounds | null {
  if (!coords.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLng, minLat, maxLng, maxLat };
}

/** Summary used by the accessible list alternative to the map. */
export function summarizeCells(cells: ViewportCell[]): { mine: number; others: number; unavailable: number; topControllers: { name: string; cells: number; mine: boolean }[] } {
  let mine = 0, others = 0, unavailable = 0;
  const by = new Map<string, { name: string; cells: number; mine: boolean }>();
  for (const c of cells) {
    if (c.status === 'excluded') {
      unavailable++;
      continue;
    }
    if (c.is_me) mine++;
    else others++;
    const key = c.controller_key ?? 'none';
    const e = by.get(key) ?? { name: c.is_me ? 'You' : c.controller_name ?? 'A runner', cells: 0, mine: c.is_me };
    e.cells++;
    by.set(key, e);
  }
  return { mine, others, unavailable, topControllers: [...by.values()].sort((a, b) => b.cells - a.cells).slice(0, 5) };
}
