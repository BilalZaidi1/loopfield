/**
 * Supported areas (districts inside regions) and which one contains a position. The shapes come from the
 * `districts` table, which every signed-in runner can read; PostgREST sends PostGIS geography as hex EWKB,
 * parsed here. The check runs on the phone: the position is never sent anywhere by it.
 */
export type Ring = [number, number][];
export type Polygon = Ring[];

/** Parses hex (E)WKB Polygon or MultiPolygon into polygons of [lng, lat] rings. Returns [] for anything else. */
export function parseWkbPolygons(hex: string | null | undefined): Polygon[] {
  if (!hex || typeof hex !== 'string' || hex.length < 10 || hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex)) return [];
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const geometry = (): Polygon[] => {
    const little = view.getUint8(at) === 1;
    at += 1;
    const raw = view.getUint32(at, little);
    at += 4;
    // PostGIS marks Z, M and SRID with high bits; ISO WKB adds 1000 (Z), 2000 (M) or 3000 (ZM) to the type.
    const base = raw & 0x0fffffff;
    const iso = Math.floor(base / 1000);
    const hasZ = (raw & 0x80000000) !== 0 || iso === 1 || iso === 3;
    const hasM = (raw & 0x40000000) !== 0 || iso === 2 || iso === 3;
    if ((raw & 0x20000000) !== 0) at += 4; // SRID
    const kind = base % 1000;
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
    const u32 = () => {
      const v = view.getUint32(at, little);
      at += 4;
      return v;
    };
    const polygon = (): Polygon => {
      const rings: Polygon = [];
      for (let r = u32(); r > 0; r--) {
        const ring: Ring = [];
        for (let n = u32(); n > 0; n--) {
          ring.push([view.getFloat64(at, little), view.getFloat64(at + 8, little)]);
          at += 8 * dims;
        }
        rings.push(ring);
      }
      return rings;
    };
    if (kind === 3) return [polygon()];
    if (kind === 6) {
      const out: Polygon[] = [];
      for (let n = u32(); n > 0; n--) out.push(...geometry());
      return out;
    }
    return [];
  };
  try {
    return geometry();
  } catch {
    return [];
  }
}

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether [lng, lat] lies inside the polygons (holes excluded). */
export function contains(polygons: readonly Polygon[], point: [number, number]): boolean {
  return polygons.some(([outer, ...holes]) => Boolean(outer && inRing(point, outer)) && !holes.some((h) => inRing(point, h)));
}

export interface AreaShape {
  id: string;
  name: string;
  region_id: string;
  region_name: string | null;
  country_code: string | null;
  polygons: Polygon[];
}

/** The supported area containing the position, if any (the first match when areas overlap). */
export function areaAt(areas: readonly AreaShape[], lng: number, lat: number): AreaShape | null {
  return areas.find((a) => contains(a.polygons, [lng, lat])) ?? null;
}

/** How a detected place reads: "Karachi, Pakistan", falling back to what the phone and the area know. */
export function placeLabel(place: { city?: string | null; subregion?: string | null; region?: string | null; country?: string | null } | null, fallbackCountry: string | null): string | null {
  const city = place?.city || place?.subregion || place?.region || null;
  const country = place?.country || fallbackCountry;
  return [city, country].filter(Boolean).join(', ') || null;
}
