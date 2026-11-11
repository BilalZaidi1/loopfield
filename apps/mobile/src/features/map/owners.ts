import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useCompetition } from '@/state/competition';
import { boundsArea, cellCenter, MAX_VIEWPORT_DEG2, roundBounds, type Bounds, type ViewportCell } from '@/territory/h3';
import { MIN_AVATAR_ZOOM } from './AvatarPin';

export { MIN_AVATAR_ZOOM };

export interface OwnerInView {
  owner_key: string;
  user_id: string | null;
  handle: string | null;
  display_name: string;
  avatar_path: string | null;
  cells_in_view: number;
  cells: number | null;
  area_m2: number | null;
  rank: number | null;
  runners: number | null;
  is_me: boolean;
}

/** Runners holding land in view (in the layer the map shows), with their picture and layer totals. */
export function useOwnersInView(bounds: Bounds | null, zoom: number, enabled = true) {
  const { layer, layerSeason } = useCompetition();
  const b = bounds ? roundBounds(bounds) : null;
  const on = Boolean(enabled && layer && layerSeason && b && zoom >= MIN_AVATAR_ZOOM && boundsArea(b) <= MAX_VIEWPORT_DEG2);
  return useQuery({
    queryKey: ['territory_owners_in_view', layer?.id, layerSeason?.id, b],
    enabled: on,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    queryFn: () =>
      rpc<OwnerInView[]>('territory_owners_in_view', {
        p_competition: layer!.id,
        p_season: layerSeason!.id,
        p_min_lng: b!.minLng,
        p_min_lat: b!.minLat,
        p_max_lng: b!.maxLng,
        p_max_lat: b!.maxLat
      })
  });
}

/**
 * Where each runner's picture stands: on their own land, at the visible cell closest to the middle of
 * their visible cells (the middle itself can fall outside land shaped like a ring or an L).
 */
export function ownerAnchors(cells: ViewportCell[]): Map<string, { anchor: [number, number]; cells: number }> {
  const groups = new Map<string, [number, number][]>();
  for (const c of cells) {
    if (c.status !== 'controlled' || !c.controller_key || c.controller_key === 'hidden') continue;
    const center = cellCenter(c.cell);
    if (!center) continue;
    const list = groups.get(c.controller_key) ?? [];
    list.push(center);
    groups.set(c.controller_key, list);
  }
  const out = new Map<string, { anchor: [number, number]; cells: number }>();
  for (const [key, pts] of groups) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let best = pts[0]!;
    let bestD = Infinity;
    for (const p of pts) {
      const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    out.set(key, { anchor: best, cells: pts.length });
  }
  return out;
}

/** Web Mercator pixel position at a zoom level (256 px tiles). */
export function project([lng, lat]: [number, number], zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

export interface PinCluster<T> {
  id: string;
  anchor: [number, number];
  members: T[];
}

/**
 * Pictures that would overlap on screen at this zoom share one pin (the runner with the most land in view
 * leads it; a badge counts the rest). Greedy and order-stable, so pins do not jump between renders.
 */
export function clusterPins<T extends { key: string; anchor: [number, number]; weight: number }>(pins: T[], zoom: number, minPx = 56): PinCluster<T>[] {
  const sorted = [...pins].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const clusters: (PinCluster<T> & { px: [number, number] })[] = [];
  for (const pin of sorted) {
    const px = project(pin.anchor, zoom);
    const hit = clusters.find((c) => Math.hypot(c.px[0] - px[0], c.px[1] - px[1]) < minPx);
    if (hit) hit.members.push(pin);
    else clusters.push({ id: pin.key, anchor: pin.anchor, members: [pin], px });
  }
  return clusters.map(({ id, anchor, members }) => ({ id, anchor, members }));
}
