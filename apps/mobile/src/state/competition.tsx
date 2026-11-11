import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from './session';

/**
 * - `public`: a region's season race (standings start fresh each season).
 * - `permanent`: the region's all-time map: who holds each piece of ground now, kept until someone takes it.
 * - `club`: a club's members-only race.
 * - `event`: a time-boxed contest with its own standings; it never changes the all-time map.
 */
export type CompetitionKind = 'public' | 'club' | 'permanent' | 'event';

export interface Competition {
  id: string;
  kind: CompetitionKind;
  name: string;
  region_id: string | null;
  club_id: string | null;
  event_type: 'territory' | 'distance' | null;
  starts_at: string | null;
  ends_at: string | null;
  host_club_id: string | null;
}

export interface Season {
  id: string;
  number: number;
  starts_at: string;
  ends_at: string;
  status: string;
  timezone: string;
}

interface CompetitionState {
  /** Every competition this runner can see: races, all-time maps, club races and events. */
  competitions: Competition[];
  /**
   * Where runs are recorded (the session ticket): the region's public race, whose loops also count on
   * the all-time map and in territory events the runner joined, or a club race (which stays inside the club).
   */
  competition: Competition | null;
  season: Season | null;
  /** What the map shows: the all-time map by default, or the season race, a live territory event or a club race. */
  layer: Competition | null;
  layerSeason: Season | null;
  /** The land a runner "holds now": the all-time map, or the club race when recording for a club. */
  home: Competition | null;
  homeSeason: Season | null;
  /** Map layers worth offering: the all-time map, the season race, live territory events and club races. */
  layers: Competition[];
  /** Show a layer on the map; the recording competition follows (a club layer records for that club). */
  select: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<CompetitionState | null>(null);

function useCurrentSeason(c: Competition | null) {
  return useQuery({
    queryKey: ['current_season', c?.id],
    enabled: Boolean(c),
    staleTime: 5 * 60_000,
    queryFn: async () => ((await rpc<Season[]>('current_season', { p_competition: c!.id }))[0] ?? null)
  });
}

const isLive = (c: Competition, now = Date.now()) =>
  c.kind !== 'event' || (c.event_type === 'territory' && Boolean(c.starts_at && c.ends_at) && Date.parse(c.starts_at!) <= now && now < Date.parse(c.ends_at!));

/** Orders layers the way the picker shows them. */
const LAYER_ORDER: Record<CompetitionKind, number> = { permanent: 0, public: 1, event: 2, club: 3 };

/** Picks the recording competition, the map layer and the "held now" layer from one saved selection. */
export function resolveCompetitions(competitions: Competition[], saved: string | null, fallback: string | null) {
  const byId = (id: string | null | undefined) => (id ? competitions.find((c) => c.id === id) ?? null : null);
  const chosen = [byId(saved), byId(fallback)].find((c) => c && isLive(c)) ?? null;
  const races = competitions.filter((c) => c.kind === 'public');
  const regionOf = (c: Competition | null) => c?.region_id ?? null;
  const raceIn = (region: string | null) => races.find((r) => r.region_id === region) ?? races[0] ?? null;
  const competition = chosen?.kind === 'club' ? chosen : raceIn(regionOf(chosen));
  const mapIn = (region: string | null) => competitions.find((c) => c.kind === 'permanent' && c.region_id === region) ?? null;
  const home = competition?.kind === 'club' ? competition : mapIn(regionOf(competition)) ?? competition;
  const layer = chosen ?? home;
  const region = regionOf(competition);
  const layers = competitions
    .filter((c) => isLive(c) && (c.kind === 'club' || c.region_id === region))
    .sort((a, b) => LAYER_ORDER[a.kind] - LAYER_ORDER[b.kind] || a.name.localeCompare(b.name));
  return { competition, layer, home, layers };
}

/** One competition is recorded per session (PRD §6); the map can show any layer the runner can see. */
export function CompetitionProvider({ children }: { children: ReactNode }) {
  const { userId, settings } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const comps = useQuery({
    queryKey: ['competitions', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from('competitions')
        .select('id, kind, name, region_id, club_id, event_type, starts_at, ends_at, host_club_id')
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []) as Competition[];
    }
  });
  const competitions = useMemo(() => comps.data ?? [], [comps.data]);
  const resolved = useMemo(
    () => resolveCompetitions(competitions, selectedId ?? settings?.selected_competition_id ?? null, env.defaultCompetitionId ?? null),
    [competitions, selectedId, settings?.selected_competition_id]
  );
  const season = useCurrentSeason(resolved.competition);
  const layerSeason = useCurrentSeason(resolved.layer);
  const homeSeason = useCurrentSeason(resolved.home);
  const value = useMemo<CompetitionState>(
    () => ({
      competitions,
      competition: resolved.competition,
      season: season.data ?? null,
      layer: resolved.layer,
      layerSeason: layerSeason.data ?? null,
      home: resolved.home,
      homeSeason: homeSeason.data ?? null,
      layers: resolved.layers,
      loading: comps.isLoading || season.isLoading || layerSeason.isLoading,
      select: (next: string) => {
        setSelectedId(next);
        if (userId) void supabase().from('user_settings').update({ selected_competition_id: next }).eq('user_id', userId);
      }
    }),
    [competitions, resolved, season.data, layerSeason.data, homeSeason.data, comps.isLoading, season.isLoading, layerSeason.isLoading, userId]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompetition(): CompetitionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompetition outside CompetitionProvider');
  return v;
}

/** Plain-language name of a layer for chips, pickers and captions. */
export function layerTitle(c: Competition, season?: Season | null): string {
  if (c.kind === 'permanent') return 'All-time map';
  if (c.kind === 'public') return season ? `Season ${season.number} race` : 'Season race';
  return c.name;
}

/** One line on what a layer is (pickers and the map chip). */
export function layerSubtitle(c: Competition, season?: Season | null, now = Date.now()): string {
  const days = (iso: string | null | undefined) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000)) : null);
  if (c.kind === 'permanent') return 'Who holds the ground now. Land stays until someone takes it.';
  if (c.kind === 'public') {
    const left = days(season?.ends_at);
    return left === null ? 'No season is running' : left === 0 ? 'Last day of this season' : `Starts fresh in ${left} ${left === 1 ? 'day' : 'days'}`;
  }
  if (c.kind === 'event') {
    const left = days(c.ends_at);
    return left === 0 ? 'Event ends today' : `Event · ends in ${left} ${left === 1 ? 'day' : 'days'}`;
  }
  return 'Club race · members only';
}
