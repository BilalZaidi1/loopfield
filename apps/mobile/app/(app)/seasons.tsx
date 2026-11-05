import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea, fmtDate } from '@/lib/format';
import { View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, ListGroup, LoadingState, Medal, Row, Screen, Section, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';

interface SeasonRow {
  season_id: string;
  number: number;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'active' | 'settling' | 'settled';
  my_area_m2: number | null;
  my_rank: number | null;
  participants: number;
}

/** S42 Season history — retained prior territory standings and independent speed achievements. */
export default function Seasons() {
  const units = useUnits();
  const { competition } = useCompetition();
  const seasons = useQuery({ queryKey: ['season_history', competition?.id], enabled: Boolean(competition), queryFn: () => rpc<SeasonRow[]>('season_history', { p_competition: competition!.id }) });
  const titles = useQuery({ queryKey: ['my_titles'], queryFn: () => rpc<{ course_id: string; course_name: string; benchmark_ms: number; season_id: string; since: string }[]>('my_titles') });
  return (
    <Screen onRefresh={() => { void seasons.refetch(); void titles.refetch(); }} refreshing={seasons.isRefetching}>
      <Stack.Screen options={{ title: 'Season history' }} />
      <Txt color="textMuted">Land resets each 28-day season; past standings are kept here. Route titles are tracked separately.</Txt>
      <Section title={competition ? competition.name : 'Territory'} icon="hexagon">
        {seasons.isLoading ? <LoadingState /> : seasons.error ? <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} /> : seasons.data?.length ? (
          <View style={{ gap: spacing.md }}>
            {seasons.data.map((s) => (
              <Card key={s.season_id} tone={s.status === 'active' ? 'violet' : 'surface'}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Medal label={String(s.number)} tone={s.status === 'active' ? 'orange' : 'violet'} size={52} earned={Boolean(s.my_area_m2)} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="headline">{`Season ${s.number}`}</Txt>
                    <Txt variant="caption">{`${fmtDate(s.starts_at)} – ${fmtDate(s.ends_at)} · ${s.participants} runners with land`}</Txt>
                  </View>
                </View>
                <Badge label={s.status === 'settled' ? 'Final' : s.status === 'settling' ? 'Settling: results final 24 h after the end' : s.status === 'active' ? 'In progress' : 'Upcoming'} tone={s.status === 'settled' ? 'success' : 'info'} />
                {s.my_area_m2 ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xl }}>
                    <View>
                      <Txt variant="caption">Your land</Txt>
                      <Txt variant="metric">{fmtArea(s.my_area_m2, units)}</Txt>
                    </View>
                    {s.my_rank ? (
                      <View>
                        <Txt variant="caption">Your rank</Txt>
                        <Txt variant="metric">{`#${s.my_rank}`}</Txt>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <Txt color="textMuted">You held no land this season.</Txt>
                )}
              </Card>
            ))}
          </View>
        ) : <EmptyState icon="calendar" title="No seasons yet" body="Finished seasons and your standing in each appear here." />}
      </Section>
      <Section title="Route titles you hold" icon="crown">
        {titles.isLoading ? <LoadingState rows={2} /> : titles.data?.length ? (
          <ListGroup>
            {titles.data.map((t) => <Row key={`${t.course_id}-${t.season_id}`} icon="crown" title={t.course_name} subtitle={`Since ${fmtDate(t.since)}`} value={formatDuration(t.benchmark_ms)} onPress={() => router.push({ pathname: '/routes/[id]', params: { id: t.course_id } })} />)}
          </ListGroup>
        ) : <Txt color="textMuted">No titles right now. Attempt a speed route to take one.</Txt>}
      </Section>
    </Screen>
  );
}
