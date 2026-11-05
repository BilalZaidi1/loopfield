import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Avatar, Badge, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Segmented, Txt } from '@/components/ui';
import { useCompetition, type Season } from '@/state/competition';
import { useUnits } from '@/state/session';

interface LeaderRow {
  rank: number;
  user_id: string;
  handle: string;
  display_name: string;
  area_m2: number;
  is_me: boolean;
}

/** S32 Group rankings — separate territory-area and route-time views within the selected competition. */
export default function ClubRankings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const { competitions } = useCompetition();
  const comp = competitions.find((c) => c.club_id === id) ?? null;
  const [view, setView] = useState<'territory' | 'routes'>('territory');
  const season = useQuery({ queryKey: ['current_season', comp?.id], enabled: Boolean(comp), queryFn: async () => (await rpc<Season[]>('current_season', { p_competition: comp!.id }))[0] ?? null });
  const board = useQuery({
    queryKey: ['territory_leaderboard', comp?.id, season.data?.id],
    enabled: Boolean(comp && season.data && view === 'territory'),
    queryFn: () => rpc<LeaderRow[]>('territory_leaderboard', { p_competition: comp!.id, p_season: season.data!.id, p_limit: 50 })
  });
  const routes = useQuery({
    queryKey: ['club_route_titles', comp?.id, season.data?.id],
    enabled: Boolean(comp && season.data && view === 'routes'),
    queryFn: async () => {
      const { data, error } = await supabase().from('courses').select('id, name').eq('region_id', comp!.region_id).eq('status', 'active').order('name').limit(30);
      if (error) throw error;
      const details = await Promise.all((data ?? []).map((c) => rpc<{ course_id: string; name: string; champion_name: string | null; benchmark_ms: number | null; i_am_champion: boolean } | null>('speed_route_detail', { p_course: c.id, p_competition: comp!.id, p_season: season.data!.id })));
      return details.filter((d): d is NonNullable<typeof d> => Boolean(d));
    }
  });

  if (!comp) return <Screen><Stack.Screen options={{ title: 'Rankings' }} /><EmptyState title="No club competition" body="This group has no territory season of its own. Public rankings are on the Map tab." /></Screen>;
  return (
    <Screen>
      <Stack.Screen options={{ title: `${comp.name} rankings` }} />
      <Segmented label="Ranking type" value={view} onChange={setView} options={[{ value: 'territory', label: 'Land area' }, { value: 'routes', label: 'Route titles' }]} />
      {season.isLoading ? <LoadingState /> : !season.data ? <EmptyState icon="calendar" title="No active season" /> : view === 'territory' ? (
        board.isLoading ? <LoadingState /> : board.error ? <ErrorState error={board.error} onRetry={() => void board.refetch()} /> : board.data?.length ? (
          <ListGroup>
            {board.data.map((r) => <Row key={r.user_id} rank={r.rank} highlight={r.is_me} leading={<Avatar name={r.display_name} size={36} />} title={r.is_me ? 'You' : r.display_name} subtitle={r.is_me ? undefined : `@${r.handle}`} value={fmtArea(r.area_m2, units)} />)}
          </ListGroup>
        ) : <EmptyState icon="hexagon" title="No published land yet this season" />
      ) : routes.isLoading ? <LoadingState /> : routes.error ? <ErrorState error={routes.error} onRetry={() => void routes.refetch()} /> : routes.data?.length ? (
        <ListGroup>
          {routes.data.map((r) => (
            <Row key={r.course_id} icon={r.i_am_champion ? 'crown' : 'route'} title={r.name} subtitle={r.champion_name ? `Title: ${r.i_am_champion ? 'you' : r.champion_name}` : 'No title holder yet'} right={r.benchmark_ms ? <Badge tone="title" icon="stopwatch" label={formatDuration(r.benchmark_ms)} /> : undefined} onPress={() => router.push({ pathname: '/routes/[id]', params: { id: r.course_id, competition: comp.id } })} />
          ))}
        </ListGroup>
      ) : <EmptyState icon="route" title="No approved routes in this area yet" />}
      <Txt variant="caption">Land area and route titles are separate: a title never moves land, and land never protects a title.</Txt>
    </Screen>
  );
}
