import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from './session';

export interface Competition {
  id: string;
  kind: 'public' | 'club';
  name: string;
  region_id: string;
  club_id: string | null;
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
  competitions: Competition[];
  competition: Competition | null;
  season: Season | null;
  select: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<CompetitionState | null>(null);

/** One competition is selected per competitive session (PRD §6); land and titles are scoped to it. */
export function CompetitionProvider({ children }: { children: ReactNode }) {
  const { userId, settings } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const comps = useQuery({
    queryKey: ['competitions', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase().from('competitions').select('id, kind, name, region_id, club_id').eq('status', 'active');
      if (error) throw error;
      return (data ?? []) as Competition[];
    }
  });
  const competitions = comps.data ?? [];
  const id = selectedId ?? settings?.selected_competition_id ?? env.defaultCompetitionId ?? competitions.find((c) => c.kind === 'public')?.id ?? null;
  const competition = competitions.find((c) => c.id === id) ?? null;
  const season = useQuery({
    queryKey: ['current_season', competition?.id],
    enabled: Boolean(competition),
    queryFn: async () => ((await rpc<Season[]>('current_season', { p_competition: competition!.id }))[0] ?? null)
  });
  const value = useMemo<CompetitionState>(
    () => ({
      competitions,
      competition,
      season: season.data ?? null,
      loading: comps.isLoading || season.isLoading,
      select: (next: string) => {
        setSelectedId(next);
        if (userId) void supabase().from('user_settings').update({ selected_competition_id: next }).eq('user_id', userId);
      }
    }),
    [competitions, competition, season.data, comps.isLoading, season.isLoading, userId]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompetition(): CompetitionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompetition outside CompetitionProvider');
  return v;
}
