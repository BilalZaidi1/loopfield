import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { useCompetition, type Competition, type Season } from '@/state/competition';

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

/**
 * Which land a number is about:
 * - `home`: what you hold now (the all-time map, or your club's race when you record for a club),
 * - `race`: the season race you record for (starts fresh every season),
 * - `layer`: whatever the map is showing.
 */
export type TerritoryScope = 'home' | 'race' | 'layer';

export function useScopedCompetition(scope: TerritoryScope): { competition: Competition | null; season: Season | null } {
  const c = useCompetition();
  if (scope === 'race') return { competition: c.competition, season: c.season };
  if (scope === 'layer') return { competition: c.layer, season: c.layerSeason };
  return { competition: c.home, season: c.homeSeason };
}

/** Your published land in one layer (same cache as the profile screen). */
export function useMyTerritorySummary(scope: TerritoryScope = 'home') {
  const { competition, season } = useScopedCompetition(scope);
  return useQuery({
    queryKey: ['my_territory_summary', competition?.id, season?.id],
    enabled: Boolean(competition && season),
    queryFn: async () => (await rpc<TerritorySummary[]>('my_territory_summary', { p_competition: competition!.id, p_season: season!.id }))[0] ?? null
  });
}

/** Published controlled-area ranking in one layer; `district` null = the whole region. Shares the leaderboard screen's cache. */
export function useLeaderboard(district: string | null = null, limit = 100, scope: TerritoryScope = 'home') {
  const { competition, season } = useScopedCompetition(scope);
  return useLeaderboardFor(competition?.id ?? null, season?.id ?? null, district, limit);
}

export function useLeaderboardFor(competitionId: string | null, seasonId: string | null, district: string | null = null, limit = 100) {
  return useQuery({
    queryKey: ['territory_leaderboard', competitionId, seasonId, district ?? 'all'],
    enabled: Boolean(competitionId && seasonId),
    queryFn: () => rpc<LeaderRow[]>('territory_leaderboard', { p_competition: competitionId, p_season: seasonId, p_district: district, p_limit: limit })
  });
}

/** Whole days until the season ends (0 on the last day), or null without a season. */
export function daysLeft(endsAt: string | null | undefined, now = Date.now()): number | null {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 86_400_000));
}
