import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea, fmtDate } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorState, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
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
    <Screen>
      <Stack.Screen options={{ title: 'Season history' }} />
      <Txt color="textMuted">Land resets each 28-day season; past standings are kept here. Route titles are tracked separately.</Txt>
      <Section title={`Territory${competition ? ` · ${competition.name}` : ''}`}>
        {seasons.isLoading ? <LoadingState /> : seasons.error ? <ErrorState error={seasons.error} onRetry={() => void seasons.refetch()} /> : seasons.data?.length ? (
          seasons.data.map((s) => (
            <Card key={s.season_id}>
              <Txt variant="heading">Season {s.number}</Txt>
              <Badge label={s.status === 'settled' ? 'Final' : s.status === 'settling' ? 'Settling (results final 24 h after the end)' : s.status === 'active' ? 'In progress' : 'Upcoming'} tone={s.status === 'settled' ? 'success' : 'info'} />
              <Txt variant="caption">{fmtDate(s.starts_at)} – {fmtDate(s.ends_at)} · {s.participants} runners with land</Txt>
              <Txt>{s.my_area_m2 ? `You: ${fmtArea(s.my_area_m2, units)}${s.my_rank ? ` · rank ${s.my_rank}` : ''}` : 'You held no land this season.'}</Txt>
            </Card>
          ))
        ) : <EmptyState title="No seasons yet" />}
      </Section>
      <Section title="Route titles you hold">
        {titles.data?.length ? titles.data.map((t) => <Row key={`${t.course_id}-${t.season_id}`} title={t.course_name} subtitle={`Since ${fmtDate(t.since)}`} right={<Badge tone="title" label={formatDuration(t.benchmark_ms)} />} onPress={() => router.push({ pathname: '/routes/[id]', params: { id: t.course_id } })} />) : <Txt color="textMuted">No titles right now.</Txt>}
      </Section>
    </Screen>
  );
}
