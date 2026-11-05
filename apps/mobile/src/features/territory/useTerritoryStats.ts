import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useCompetition } from '@/state/competition';

export interface TerritorySummary {
  published_area_m2: number;
  published_cells: number;
  provisional_cells: number;
}

export interface LeaderRow {
  rank: number;
  user_id: string;
  handle: string;
  display_name: string;
  area_m2: number;
  is_me: boolean;
}

/** Your published land in the selected competition season (same cache as the profile screen). */
export function useMyTerritorySummary() {
  const { competition, season } = useCompetition();
  return useQuery({
    queryKey: ['my_territory_summary', competition?.id, season?.id],
    enabled: Boolean(competition && season),
    queryFn: async () => (await rpc<TerritorySummary[]>('my_territory_summary', { p_competition: competition!.id, p_season: season!.id }))[0] ?? null
  });
}

/** Published controlled-area ranking; `district` null = whole competition. Shares the leaderboard screen's cache. */
export function useLeaderboard(district: string | null = null, limit = 100) {
  const { competition, season } = useCompetition();
  return useQuery({
    queryKey: ['territory_leaderboard', competition?.id, season?.id, district ?? 'all'],
    enabled: Boolean(competition && season),
    queryFn: () => rpc<LeaderRow[]>('territory_leaderboard', { p_competition: competition!.id, p_season: season!.id, p_district: district, p_limit: limit })
  });
}

/** Whole days until the season ends (0 on the last day), or null without a season. */
export function daysLeft(endsAt: string | null | undefined, now = Date.now()): number | null {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 86_400_000));
}
