import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseWkbPolygons, type AreaShape } from './areas';

/**
 * Loopfield's playing areas: districts inside the regions where the territory game runs. They are not
 * where a runner says they live (that is the profile's city and country); the phone checks whether a
 * runner is inside one when they use their location, which lets their communities start an area race.
 */
export interface District {
  id: string;
  name: string;
  region_id: string;
  region_name?: string | null;
  country_code?: string | null;
}

interface DistrictRow {
  id: string;
  name: string;
  region_id: string;
  regions: { name: string; country_code: string | null } | null;
}

export function useDistricts() {
  return useQuery({
    queryKey: ['districts'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase().from('districts').select('id, name, region_id, regions(name, country_code)').order('name');
      if (error) throw error;
      return ((data ?? []) as unknown as DistrictRow[]).map((d): District => ({ id: d.id, name: d.name, region_id: d.region_id, region_name: d.regions?.name ?? null, country_code: d.regions?.country_code ?? null }));
    }
  });
}

/** The playing areas' shapes, loaded only when the runner asks to use their location. */
export async function loadAreaShapes(): Promise<AreaShape[]> {
  const { data, error } = await supabase().from('districts').select('id, name, region_id, geom, regions(name, country_code)');
  if (error) throw error;
  return ((data ?? []) as unknown as (DistrictRow & { geom: string | null })[]).map((d) => ({
    id: d.id,
    name: d.name,
    region_id: d.region_id,
    region_name: d.regions?.name ?? null,
    country_code: d.regions?.country_code ?? null,
    polygons: parseWkbPolygons(d.geom)
  }));
}
