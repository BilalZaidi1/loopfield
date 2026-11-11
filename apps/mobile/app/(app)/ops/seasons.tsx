import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, ChipGroup, EmptyState, ListGroup, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { friendlyError, rpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useCompetition } from '@/state/competition';
import { useSession } from '@/state/session';
import { useNow } from '@/lib/useNow';
import { spacing } from '@/theme/tokens';

interface SeasonRow {
  id: string;
  number: number;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'active' | 'settling' | 'settled';
}

const DAY = 86_400_000;
const at = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const when = (iso: string) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Season dates for each public race (territory operators). The all-time map never has seasons to manage;
 * events are created from Events. Every change is checked and audited on the server, and a season that
 * was already scheduled after the current one moves with it so there is never a gap or an overlap.
 */
export default function OpsSeasons() {
  const { roles } = useSession();
  const { competitions } = useCompetition();
  const races = competitions.filter((c) => c.kind === 'public');
  const [raceId, setRaceId] = useState<string | null>(null);
  const race = races.find((r) => r.id === raceId) ?? races[0] ?? null;
  const qc = useQueryClient();
  const seasons = useQuery({
    queryKey: ['ops_seasons', race?.id],
    enabled: Boolean(race),
    queryFn: async () => {
      const { data, error } = await supabase().from('seasons').select('id, number, starts_at, ends_at, status').eq('competition_id', race!.id).order('number', { ascending: false }).limit(4);
      if (error) throw error;
      return (data ?? []) as SeasonRow[];
    }
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ops_seasons'] });
    void qc.invalidateQueries({ queryKey: ['current_season'] });
  };
  const setDates = useMutation({ mutationFn: (v: { id: string; starts: string; ends: string }) => rpc<void>('ops_set_season_dates', { p_season: v.id, p_starts_at: v.starts, p_ends_at: v.ends }), onSuccess: refresh });
  const schedule = useMutation({ mutationFn: (v: { starts: string; ends: string }) => rpc<string>('ops_schedule_season', { p_competition: race!.id, p_starts_at: v.starts, p_ends_at: v.ends }), onSuccess: refresh });
  const length = useMutation({ mutationFn: (days: number) => rpc<void>('ops_set_season_length', { p_competition: race!.id, p_days: days }), onSuccess: refresh });
  const [nextLength, setNextLength] = useState<'14' | '28' | '42'>('28');
  const now = useNow();

  if (!roles.includes('territory_operator') && !roles.includes('admin')) return <Screen><EmptyState title="Territory operators only" /></Screen>;
  const rows = seasons.data ?? [];
  const current = rows.find((s) => s.status === 'active') ?? null;
  const next = rows.find((s) => s.status === 'scheduled') ?? null;
  const error = setDates.error ?? schedule.error ?? length.error;

  return (
    <Screen onRefresh={() => void seasons.refetch()} refreshing={seasons.isRefetching}>
      <Stack.Screen options={{ title: 'Seasons and events' }} />
      <Txt color="textMuted">Seasons are races that start fresh. The all-time map keeps its land whatever the season, and events never change it.</Txt>
      {races.length > 1 ? <ChipGroup label="Race" value={race?.id ?? ''} onChange={setRaceId} scroll options={races.map((r) => ({ value: r.id, label: r.name }))} /> : null}
      {error ? <Banner tone="danger" text={friendlyError(error)} /> : null}
      {seasons.isLoading ? <LoadingState variant="cards" /> : !race ? <EmptyState title="No public race" /> : (
        <>
          {current ? (
            <Card tone="orange">
              <Txt variant="heading">{`Season ${current.number} · running`}</Txt>
              <Txt>{`${when(current.starts_at)} – ${when(current.ends_at)}`}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <Button label="End 7 days later" size="sm" variant="secondary" loading={setDates.isPending} onPress={() => setDates.mutate({ id: current.id, starts: current.starts_at, ends: at(current.ends_at, 7) })} />
                <Button label="End 7 days sooner" size="sm" variant="secondary" loading={setDates.isPending}
                  disabled={Date.parse(current.ends_at) - 7 * DAY < now + 3_600_000}
                  onPress={() => setDates.mutate({ id: current.id, starts: current.starts_at, ends: at(current.ends_at, -7) })} />
              </View>
              {next ? <Txt variant="caption">The scheduled season moves with it.</Txt> : null}
            </Card>
          ) : <Banner tone="info" text="No season is running for this race right now." />}
          <Section title="Next season" icon="calendar">
            {next ? (
              <ListGroup>
                <Row icon="calendar" title={`Season ${next.number}`} subtitle={`${when(next.starts_at)} – ${when(next.ends_at)}`} right={<Badge tone="info" label="Scheduled" />} />
              </ListGroup>
            ) : (
              <View style={{ gap: spacing.sm }}>
                <ChipGroup label="Length" value={nextLength} onChange={setNextLength} options={[{ value: '14', label: '2 weeks' }, { value: '28', label: '4 weeks' }, { value: '42', label: '6 weeks' }]} />
                <Button label={`Schedule it from ${current ? fmtDate(current.ends_at, { day: 'numeric', month: 'short' }) : 'now'}`} variant="secondary" loading={schedule.isPending}
                  onPress={() => {
                    const starts = current ? current.ends_at : new Date(now + 3_600_000).toISOString();
                    schedule.mutate({ starts, ends: at(starts, Number(nextLength)) });
                  }} />
              </View>
            )}
          </Section>
          <Section title="Automatic seasons" icon="refresh">
            <Txt color="textMuted">When nothing is scheduled, a new season starts as the last one ends. Choose how long those run.</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {[14, 28, 42].map((d) => <Button key={d} label={`${d} days`} size="sm" variant="secondary" loading={length.isPending && length.variables === d} onPress={() => length.mutate(d)} />)}
            </View>
            {length.isSuccess ? <Txt variant="caption">{`Automatic seasons now run for ${length.variables} days.`}</Txt> : null}
          </Section>
          <Section title="Events" icon="flag">
            <ListGroup>
              <Row icon="flag" title="Events" subtitle="Create, follow and cancel events" onPress={() => router.push('/events')} />
              <Row icon="plus" title="Create an event" subtitle="Territory or distance, one region or anywhere" onPress={() => router.push('/events/new')} />
            </ListGroup>
          </Section>
        </>
      )}
    </Screen>
  );
}
