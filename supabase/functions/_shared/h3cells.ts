import { cellToBoundary, cellToParent, latLngToCell, polygonToCells } from 'h3-js';
import type { LatLng } from './core/index.ts';

/** H3 indexes are stored as signed bigint (decimal text on the wire); the high reserved bit is always 0. */
export const h3ToDec = (h: string): string => BigInt(`0x${h}`).toString();
export const decToH3 = (d: string): string => BigInt(d).toString(16);

/**
 * Candidate cells for a loop: every cell whose centre is inside the ring. A cell fully inside the
 * (band-reduced) polygon necessarily has its centre inside, so this is a superset of the eligible set;
 * PostGIS then keeps only fully covered cells after the band and exclusions.
 */
export function candidateCells(ring: readonly LatLng[], resolution: number, maxCells: number): string[] {
  const coords = ring.map((p) => [p.lat, p.lng] as [number, number]);
  const cells = polygonToCells(coords, resolution);
  if (cells.length > maxCells) throw new Error(`candidate cell count ${cells.length} exceeds bound ${maxCells}`);
  return cells;
}

export interface CellRecord {
  cell: string;
  res: number;
  parent: string;
  ring: Array<[number, number]>;
}

export function cellRecords(cells: readonly string[], resolution: number): CellRecord[] {
  return cells.map((h) => ({
    cell: h3ToDec(h),
    res: resolution,
    parent: h3ToDec(cellToParent(h, Math.min(7, resolution))),
    // cellToBoundary returns [lat, lng]; PostGIS rings take [lng, lat].
    ring: cellToBoundary(h).map(([lat, lng]) => [lng, lat] as [number, number])
  }));
}

/** Exploration cells visited by usable fixes (private progress). */
export function visitedCells(points: readonly LatLng[], resolution: number): string[] {
  const set = new Set<string>();
  for (const p of points) set.add(latLngToCell(p.lat, p.lng, resolution));
  return [...set].map(h3ToDec);
}
