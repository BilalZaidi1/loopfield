import { cellToBoundary, cellToLatLng, getResolution, isValidCell, polygonToCells } from 'h3-js';
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

export function cellsToFeatures(cells: ViewportCell[], colors: { mine: string; unavailable: string; rivalHues: readonly string[] }): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of cells) {
    const geometry = cellPolygon(c.cell);
    if (!geometry) continue;
    const color = c.status === 'excluded' ? colors.unavailable : c.is_me ? colors.mine : controllerColor(c.controller_key ?? 'none', colors.rivalHues);
    features.push({ type: 'Feature', id: c.cell, geometry, properties: { cell: c.cell, status: c.status, mine: c.is_me, color, handle: c.controller_handle ?? '' } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Outline of the ownership grid over the visible area (drawing only: an outline says nothing about who
 * may claim a cell). Skipped when the view would need more than `max` cells.
 */
export function gridFeatures(b: Bounds, resolution: number, max = 2500): GeoJSON.FeatureCollection | null {
  const ring: [number, number][] = [[b.minLat, b.minLng], [b.minLat, b.maxLng], [b.maxLat, b.maxLng], [b.maxLat, b.minLng], [b.minLat, b.minLng]];
  let cells: string[];
  try {
    cells = polygonToCells([ring], resolution);
  } catch {
    return null;
  }
  if (!cells.length || cells.length > max) return null;
  const features: GeoJSON.Feature[] = cells.map((cell) => {
    const r = cellToBoundary(cell, true) as [number, number][];
    return { type: 'Feature', id: cell, geometry: { type: 'LineString', coordinates: [...r, r[0]!] }, properties: {} };
  });
  return { type: 'FeatureCollection', features };
}

/** Grid resolution of published cells (falls back to the given default when none are in view). */
export function resolutionOf(cells: { cell: string }[], fallback: number): number {
  const first = cells.find((c) => isValidCell(c.cell));
  return first ? getResolution(first.cell) : fallback;
}

/** About 2.5 km × 2 km around a point: the area summarised when no map can be shown. */
export function boundsAround([lng, lat]: [number, number], dLng = 0.012, dLat = 0.009): Bounds {
  return { minLng: lng - dLng, minLat: lat - dLat, maxLng: lng + dLng, maxLat: lat + dLat };
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
export function summarizeCells(cells: ViewportCell[]): { mine: number; others: number; unavailable: number; topControllers: { key: string; name: string; handle: string | null; cells: number; mine: boolean }[] } {
  let mine = 0, others = 0, unavailable = 0;
  const by = new Map<string, { key: string; name: string; handle: string | null; cells: number; mine: boolean }>();
  for (const c of cells) {
    if (c.status === 'excluded') {
      unavailable++;
      continue;
    }
    if (c.is_me) mine++;
    else others++;
    const key = c.controller_key ?? 'none';
    const e = by.get(key) ?? { key, name: c.is_me ? 'You' : c.controller_name ?? 'A runner', handle: c.is_me ? null : c.controller_handle, cells: 0, mine: c.is_me };
    e.cells++;
    by.set(key, e);
  }
  return { mine, others, unavailable, topControllers: [...by.values()].sort((a, b) => b.cells - a.cells).slice(0, 5) };
}
