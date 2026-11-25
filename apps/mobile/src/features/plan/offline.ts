import { destination, bboxOf, bytesBucket, type LatLng } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { mapboxModule } from '@/features/map/MapCanvas';

/**
 * Offline maps for planned routes (R1): the map 500 m either side of the route, zoom 12 to 16, kept on the
 * phone by Mapbox's offline manager so a route can be followed with no signal. The route line itself is kept
 * on the phone with the planned routes (see api.ts).
 */
export const OFFLINE_ZOOM = { min: 12, max: 16 } as const;
export const OFFLINE_BUFFER_M = 500;

export const packName = (routeId: string) => `plan-${routeId}`;

/** North-east and south-west corners around the route, `bufferM` metres out. */
export function packBounds(path: readonly LatLng[], bufferM = OFFLINE_BUFFER_M): [[number, number], [number, number]] | null {
  const b = bboxOf(path);
  if (!b || !Number.isFinite(b.minLat)) return null;
  const ne = destination(destination({ lat: b.maxLat, lng: b.maxLng }, bufferM, 0), bufferM, 90);
  const sw = destination(destination({ lat: b.minLat, lng: b.minLng }, bufferM, 180), bufferM, 270);
  return [[ne.lng, ne.lat], [sw.lng, sw.lat]];
}

/** Rough sizes for the estimate shown before downloading (city vector tiles average about this). */
const BYTES_PER_TILE = 30_000;
const STYLE_BYTES = 1_500_000;

function tileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

/** About how much the offline map of a route takes, from the tiles it needs at each zoom. An estimate only. */
export function estimateOfflineBytes(path: readonly LatLng[], bufferM = OFFLINE_BUFFER_M): number | null {
  const b = packBounds(path, bufferM);
  if (!b) return null;
  const [[neLng, neLat], [swLng, swLat]] = b;
  let tiles = 0;
  for (let z = OFFLINE_ZOOM.min; z <= OFFLINE_ZOOM.max; z++) {
    const [x0, y0] = tileXY(swLng, neLat, z);
    const [x1, y1] = tileXY(neLng, swLat, z);
    tiles += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return tiles * BYTES_PER_TILE + STYLE_BYTES;
}

/** "about 4 MB" for the download button's note. */
export function sizeLabel(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb < 1 ? 'under 1 MB' : `about ${mb < 10 ? Math.round(mb) : Math.round(mb / 5) * 5} MB`;
}

export type OfflineState = { state: 'none' } | { state: 'downloading'; percentage: number } | { state: 'ready'; bytes: number } | { state: 'unavailable' };

export async function offlineState(routeId: string): Promise<OfflineState> {
  const M = mapboxModule();
  if (!M) return { state: 'unavailable' };
  try {
    const pack = await M.offlineManager.getPack(packName(routeId));
    if (!pack) return { state: 'none' };
    const s = await pack.status();
    return s.percentage >= 100 ? { state: 'ready', bytes: s.completedResourceSize } : { state: 'downloading', percentage: Math.round(s.percentage) };
  } catch {
    return { state: 'none' };
  }
}

/** Starts the download; progress arrives through `onProgress` until it reaches 100. */
export async function downloadRoute(routeId: string, path: readonly LatLng[], styleURL: string, onProgress: (percentage: number, bytes: number) => void): Promise<void> {
  const M = mapboxModule();
  const bounds = packBounds(path);
  if (!M || !bounds) throw new Error('Offline maps need the Loopfield phone app.');
  let reported = false;
  await M.offlineManager.createPack(
    { name: packName(routeId), styleURL, bounds, minZoom: OFFLINE_ZOOM.min, maxZoom: OFFLINE_ZOOM.max, metadata: { kind: 'planned_route', routeId } },
    (_pack, status) => {
      // Mapbox reports a status without numbers until the pack has started; there is nothing to show yet.
      if (status.percentage === null) return;
      onProgress(Math.round(status.percentage), status.completedResourceSize);
      if (status.percentage >= 100 && !reported) {
        reported = true;
        track('route_offline', { action: 'downloaded', size_bucket: bytesBucket(status.completedResourceSize) });
      }
    },
    () => {
      if (!reported) {
        reported = true;
        track('route_offline', { action: 'failed', size_bucket: '<100KB' });
      }
    }
  );
}

export async function removeOffline(routeId: string): Promise<void> {
  const M = mapboxModule();
  if (!M) return;
  const before = await offlineState(routeId);
  if (before.state === 'none' || before.state === 'unavailable') return;
  await M.offlineManager.deletePack(packName(routeId)).catch(() => {});
  track('route_offline', { action: 'removed', size_bucket: bytesBucket(before.state === 'ready' ? before.bytes : 0) });
}

/** Every planned-route map kept on this phone (at sign-out, so the next account starts clean). */
export async function removeAllOffline(): Promise<void> {
  const M = mapboxModule();
  if (!M) return;
  const packs = await M.offlineManager.getPacks().catch(() => []);
  for (const pack of packs) {
    const name = String(pack.name ?? '');
    if (name.startsWith('plan-')) await M.offlineManager.deletePack(name).catch(() => {});
  }
}
