import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useCompetition } from '@/state/competition';
import { boundsArea, MAX_VIEWPORT_DEG2, roundBounds, type Bounds, type ViewportCell } from '@/territory/h3';

export interface RouteInView {
  course_id: string;
  course_version_id: string;
  name: string;
  status: 'active' | 'suspended';
  length_m: number;
  closed: boolean;
  path_geojson: GeoJSON.LineString;
  start_bearing: number | null;
  champion_handle: string | null;
  champion_name: string | null;
  benchmark_ms: number | null;
  i_am_champion: boolean;
}

/** Bounded viewport query of published cells; the server rejects oversized boxes (zoom in). */
export function useTerritoryViewport(bounds: Bounds | null) {
  const { competition, season } = useCompetition();
  const b = bounds ? roundBounds(bounds) : null;
  const tooLarge = b ? boundsArea(b) > MAX_VIEWPORT_DEG2 : false;
  const q = useQuery({
    queryKey: ['territory_viewport', competition?.id, season?.id, b],
    enabled: Boolean(competition && season && b && !tooLarge),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    queryFn: () =>
      rpc<ViewportCell[]>('territory_viewport_safe', {
        p_competition: competition!.id,
        p_season: season!.id,
        p_min_lng: b!.minLng,
        p_min_lat: b!.minLat,
        p_max_lng: b!.maxLng,
        p_max_lat: b!.maxLat
      })
  });
  return { ...q, tooLarge };
}

export function useExclusions(bounds: Bounds | null) {
  const { competition } = useCompetition();
  const b = bounds ? roundBounds(bounds) : null;
  const tooLarge = b ? boundsArea(b) > MAX_VIEWPORT_DEG2 : false;
  return useQuery({
    queryKey: ['exclusions_viewport', competition?.region_id, b],
    enabled: Boolean(competition && b && !tooLarge),
    placeholderData: (prev) => prev,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = await rpc<{ id: string; geojson: GeoJSON.Geometry }[]>('exclusions_viewport', {
        p_region: competition!.region_id,
        p_min_lng: b!.minLng,
        p_min_lat: b!.minLat,
        p_max_lng: b!.maxLng,
        p_max_lat: b!.maxLat
      });
      return { type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.geojson, properties: { color: '#6B6B6B' } })) } as GeoJSON.FeatureCollection;
    }
  });
}

export function useRoutesInView(bounds: Bounds | null) {
  const { competition, season } = useCompetition();
  const b = bounds ? roundBounds(bounds) : null;
  const tooLarge = b ? boundsArea(b) > MAX_VIEWPORT_DEG2 * 4 : false;
  const q = useQuery({
    queryKey: ['speed_routes_in_view', competition?.id, season?.id, b],
    enabled: Boolean(competition && season && b && !tooLarge),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    queryFn: () =>
      rpc<RouteInView[]>('speed_routes_in_view', {
        p_competition: competition!.id,
        p_season: season!.id,
        p_min_lng: b!.minLng,
        p_min_lat: b!.minLat,
        p_max_lng: b!.maxLng,
        p_max_lat: b!.maxLat
      })
  });
  return { ...q, tooLarge };
}

export function routesToFeatures(routes: RouteInView[], titleColor: string, mineColor: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.map((r) => ({ type: 'Feature', id: r.course_id, geometry: r.path_geojson, properties: { id: r.course_id, status: r.status, color: r.i_am_champion ? mineColor : titleColor } }))
  };
}
