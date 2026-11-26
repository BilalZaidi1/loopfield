import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { decodePolyline, distanceBucket, encodePolyline, type LatLng } from '@loopfield/core';
import { callFunction } from '@/lib/api';
import { track } from '@/lib/analytics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { PLANNED_ROUTES_CACHE_KEY } from '@/lib/runningCleanup';

/**
 * Planned routes (R1): saved on the server for the runner alone (row-level security), measured by the
 * database, and kept on the phone too so a route can be followed with no signal.
 */
export interface PlannedRoute {
  id: string;
  name: string;
  /** Encoded polyline (precision 5). */
  path: string;
  distance_m: number;
  point_count: number;
  is_loop: boolean;
  snapped: boolean;
  created_at: string;
  updated_at: string;
}

export const PLANNED_ROUTES_KEY = ['planned_routes'] as const;
const COLUMNS = 'id, name, path, distance_m, point_count, is_loop, snapped, created_at, updated_at';

async function readCache(): Promise<PlannedRoute[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PLANNED_ROUTES_CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlannedRoute[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(rows: PlannedRoute[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PLANNED_ROUTES_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // the phone copy is a convenience; the server keeps the routes
  }
}

/** The runner's planned routes, newest first; the phone's copy when offline. */
export async function loadPlannedRoutes(): Promise<PlannedRoute[]> {
  const { data, error } = await supabase().from('planned_routes').select(COLUMNS).order('updated_at', { ascending: false });
  if (error) {
    const cached = await readCache();
    if (cached) return cached;
    throw error;
  }
  const rows = (data ?? []) as PlannedRoute[];
  void writeCache(rows);
  return rows;
}

export function usePlannedRoutes(enabled = true) {
  return useQuery({ queryKey: PLANNED_ROUTES_KEY, enabled, queryFn: loadPlannedRoutes, staleTime: 30_000 });
}

export function usePlannedRoute(id: string | undefined) {
  return useQuery({
    queryKey: [...PLANNED_ROUTES_KEY, id],
    enabled: Boolean(id),
    queryFn: async () => (await loadPlannedRoutes()).find((r) => r.id === id) ?? null
  });
}

export function routeLine(r: Pick<PlannedRoute, 'path'>): LatLng[] {
  return decodePolyline(r.path);
}

export async function savePlannedRoute(input: { id?: string | null; name: string; path: LatLng[]; snapped: boolean }): Promise<PlannedRoute> {
  const row = { name: input.name.trim(), path: encodePolyline(input.path), snapped: input.snapped };
  const q = input.id
    ? supabase().from('planned_routes').update(row).eq('id', input.id).select(COLUMNS).single()
    : supabase().from('planned_routes').insert(row).select(COLUMNS).single();
  const { data, error } = await q;
  if (error) throw error;
  const saved = data as PlannedRoute;
  track('route_planned', { action: input.id ? 'edited' : 'created', distance_bucket: distanceBucket(saved.distance_m), loop: saved.is_loop, snapped: saved.snapped });
  await queryClient.invalidateQueries({ queryKey: PLANNED_ROUTES_KEY });
  return saved;
}

export async function deletePlannedRoute(r: PlannedRoute): Promise<void> {
  const { error } = await supabase().from('planned_routes').delete().eq('id', r.id);
  if (error) throw error;
  track('route_planned', { action: 'deleted', distance_bucket: distanceBucket(r.distance_m), loop: r.is_loop, snapped: r.snapped });
  await queryClient.invalidateQueries({ queryKey: PLANNED_ROUTES_KEY });
}

export type SnapResult =
  | { snapped: true; path: string; distance_m: number }
  | { snapped: false; reason: 'paused' | 'capped' | 'unavailable' | 'busy' | 'no_route' | 'error' };

/** One leg along streets and paths, from the route-snap function. */
export async function snapLeg(from: LatLng, to: LatLng): Promise<SnapResult> {
  return callFunction<SnapResult>('route-snap', { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } }, { timeoutMs: 10_000 });
}

/** What the planner says when a leg had to be drawn straight. */
export function straightLegNote(reason: Extract<SnapResult, { snapped: false }>['reason'] | 'offline'): string {
  switch (reason) {
    case 'paused':
      return 'Following paths is paused for now, so this leg is a straight line.';
    case 'capped':
      return "You've used today's path following, so legs are straight lines until tomorrow.";
    case 'busy':
      return 'Path following is busy. This leg is a straight line; try again in a minute.';
    case 'no_route':
      return 'No path was found here, so this leg is a straight line.';
    case 'offline':
      return 'No connection, so this leg is a straight line.';
    default:
      return "Path following isn't available right now, so this leg is a straight line.";
  }
}
