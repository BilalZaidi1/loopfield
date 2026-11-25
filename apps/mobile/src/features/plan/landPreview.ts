import { polygonToCells } from 'h3-js';
import type { LatLng } from '@loopfield/core';
import { toH3, type ViewportCell } from '@/territory/h3';

/**
 * The land preview for a planned loop (R1): the cells whose centres fall inside the loop, at the season's
 * grid resolution, compared with the cells the map shows. It is a preview, not a promise: the run itself is
 * judged by the server with the usual checks.
 */
export interface LandPreview {
  total: number;
  free: number;
  mine: number;
  others: number;
  unavailable: number;
}

/** Cells inside a closed line, or null when the line isn't a loop or covers too many cells to preview. */
export function loopCells(path: readonly LatLng[], resolution: number, max = 4000): string[] | null {
  if (path.length < 4) return null;
  try {
    const ring = path.map((p) => [p.lat, p.lng]);
    const cells = polygonToCells(ring, resolution);
    return cells.length && cells.length <= max ? cells : null;
  } catch {
    return null;
  }
}

export function previewLand(cells: readonly string[], published: readonly ViewportCell[]): LandPreview {
  const byCell = new Map(published.map((c) => [toH3(c.cell), c]));
  const out: LandPreview = { total: cells.length, free: 0, mine: 0, others: 0, unavailable: 0 };
  for (const cell of cells) {
    const c = byCell.get(cell);
    if (!c) out.free++;
    else if (c.status === 'excluded') out.unavailable++;
    else if (c.is_me) out.mine++;
    else out.others++;
  }
  return out;
}

export function previewText(p: LandPreview): string {
  const parts = [
    p.free ? `${p.free} free` : null,
    p.mine ? `${p.mine} already yours` : null,
    p.others ? `${p.others} held by others` : null,
    p.unavailable ? `${p.unavailable} unavailable` : null
  ].filter(Boolean);
  return `About ${p.total} ${p.total === 1 ? 'cell' : 'cells'} inside this loop${parts.length ? `: ${parts.join(', ')}` : ''}. The run itself decides.`;
}
