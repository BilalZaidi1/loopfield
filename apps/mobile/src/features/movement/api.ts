import { useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quoteReclaim } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { tick } from '@/theme/motion';
import { roundBounds, type Bounds } from '@/territory/h3';

export interface Movement {
  balance: number;
  earned_total: number;
  spent_total: number;
  verified_distance_m: number;
  earned_7d: number;
  earned_today: number;
  daily_cap: number;
  points_per_km: number;
  cost_per_cell: number;
}

/** My movement points (owner-only on the server). */
export function useMovement(enabled = true) {
  return useQuery({
    queryKey: ['my_movement'],
    enabled,
    queryFn: async () => (await rpc<Movement[]>('my_movement'))[0] ?? null
  });
}

export interface MovementEntry {
  kind: 'run' | 'revoke' | 'reinstate' | 'reclaim' | 'refund';
  amount: number;
  cells: number | null;
  activity_id: string | null;
  request_id: string | null;
  verified_distance_m: number;
  note: string | null;
  occurred_at: string;
}

export function useMovementHistory() {
  return useQuery({ queryKey: ['my_movement_history'], queryFn: () => rpc<MovementEntry[]>('my_movement_history', { p_limit: 40 }) });
}

export interface ActivityMovement {
  points: number;
  verified_distance_m: number;
  reasons: string[];
  capped: boolean;
  removed: boolean;
  processed: boolean;
}

/** What one of my runs earned (null until the server has processed it). */
export function useActivityMovement(activityId: string | undefined) {
  return useQuery({
    queryKey: ['activity_movement', activityId],
    enabled: Boolean(activityId),
    queryFn: async () => (await rpc<ActivityMovement[]>('activity_movement', { p_activity: activityId }))[0] ?? null,
    refetchInterval: (q) => (q.state.data?.processed ? false : 15_000)
  });
}

export interface LostCell {
  cell: string;
  controller_key: string;
  controller_name: string | null;
  lost_on: string;
  reclaimable: boolean;
  blocked_reason: 'season_closed' | 'not_participating' | 'taken_with_points' | null;
  cost: number;
}

/**
 * Cells I held earlier this season that another runner now holds (from the published map).
 * With bounds: only those in view; without: the whole season, for the list flow.
 */
export function useLostCells(competitionId: string | undefined, seasonId: string | undefined, bounds: Bounds | null | 'all', enabled = true) {
  const b = bounds && bounds !== 'all' ? roundBounds(bounds) : null;
  return useQuery({
    queryKey: ['my_lost_cells', competitionId, seasonId, b ? [b.minLng, b.minLat, b.maxLng, b.maxLat] : bounds],
    enabled: enabled && Boolean(competitionId && seasonId && bounds),
    queryFn: () =>
      rpc<LostCell[]>('my_lost_cells', {
        p_competition: competitionId,
        p_season: seasonId,
        ...(b ? { p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat } : {})
      }),
    staleTime: 20_000
  });
}

export interface ReclaimResult {
  request_id: string;
  reclaimed: number;
  skipped: number;
  cost_per_cell: number;
  spent: number;
  balance: number;
  cells: string[];
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/**
 * Reclaim selected cells. One request id per confirmed selection: retrying after a dropped connection
 * re-sends the same id, so the server answers instead of charging twice.
 */
export function useReclaim(competitionId: string | undefined, seasonId: string | undefined) {
  const qc = useQueryClient();
  const pending = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (cells: string[]) => {
      const key = [...cells].sort().join(',');
      if (pending.current?.key !== key) pending.current = { key, id: uuid() };
      return rpc<ReclaimResult>('reclaim_cells', { p_request: pending.current.id, p_competition: competitionId, p_season: seasonId, p_cells: cells });
    },
    onSuccess: () => {
      pending.current = null;
      tick('success');
      for (const k of ['my_movement', 'my_movement_history', 'my_lost_cells', 'territory_viewport', 'territory_cell_detail', 'my_territory_summary', 'territory_leaderboard', 'my_territory_events']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: () => tick('warning')
  });
}

/** Live cost of a selection against my balance (the server re-checks on confirm). */
export function useReclaimQuote(selection: ReadonlySet<string>, lost: readonly LostCell[] | undefined, balance: number | undefined) {
  return useMemo(() => {
    const byCell = new Map((lost ?? []).map((c) => [c.cell, c]));
    const chosen = [...selection].filter((c) => byCell.get(c)?.reclaimable);
    const cost = chosen.length ? byCell.get(chosen[0]!)!.cost : (lost?.find((c) => c.reclaimable)?.cost ?? 0);
    return { ...quoteReclaim(chosen.length, cost, balance ?? 0), cells: chosen };
  }, [selection, lost, balance]);
}

export interface LostGroup {
  key: string;
  controllerKey: string;
  name: string;
  lostOn: string;
  cells: LostCell[];
  reclaimable: LostCell[];
}

/** Lost cells grouped by who took them and when, for choosing without a map. */
export function groupLost(lost: readonly LostCell[]): LostGroup[] {
  const groups = new Map<string, LostGroup>();
  for (const c of lost) {
    const key = `${c.controller_key}:${c.lost_on}`;
    const g = groups.get(key) ?? { key, controllerKey: c.controller_key, name: c.controller_name ?? 'A runner', lostOn: c.lost_on, cells: [], reclaimable: [] };
    g.cells.push(c);
    if (c.reclaimable) g.reclaimable.push(c);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.lostOn < b.lostOn ? 1 : a.lostOn > b.lostOn ? -1 : b.cells.length - a.cells.length));
}
