import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fmtDate, fmtDistance } from '@/lib/format';
import { BigNumber, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, ProgressBar, Row, Screen, Section, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useMovement, useMovementHistory, type MovementEntry } from '@/features/movement/api';
import { ReclaimSheet } from '@/features/movement/Reclaim';
import { useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

function entryText(e: MovementEntry, units: 'metric' | 'imperial'): { title: string; subtitle: string } {
  const on = fmtDate(e.occurred_at);
  switch (e.kind) {
    case 'run':
      return { title: 'Run', subtitle: `${fmtDistance(e.verified_distance_m, units, 1)} verified${e.note === 'daily_cap' ? ' · daily limit reached' : ''} · ${on}` };
    case 'revoke':
      return { title: 'Run removed', subtitle: `${e.note === 'source_deleted' ? 'You deleted the run' : 'Its result was ruled invalid'} · ${on}` };
    case 'reinstate':
      return { title: 'Run restored', subtitle: `The decision was overturned · ${on}` };
    case 'reclaim':
      return { title: `Reclaimed ${e.cells ?? 0} ${(e.cells ?? 0) === 1 ? 'cell' : 'cells'}`, subtitle: on };
    case 'refund':
      return { title: `Refund for ${e.cells ?? 0} ${(e.cells ?? 0) === 1 ? 'cell' : 'cells'}`, subtitle: `The run that took them was ruled invalid · ${on}` };
  }
}

/** Movement points: balance, how they are earned and spent, and every change to them. */
export default function Points() {
  const p = usePalette();
  const units = useUnits();
  // Reclaiming works on the land held now (the all-time map, or a club race).
  const { home: competition, homeSeason: season } = useCompetition();
  const movement = useMovement();
  const history = useMovementHistory();
  const [reclaim, setReclaim] = useState(false);
  const m = movement.data;

  return (
    <Screen onRefresh={() => { void movement.refetch(); void history.refetch(); }} refreshing={movement.isRefetching}>
      <Stack.Screen options={{ title: 'Movement points' }} />
      {movement.isLoading ? <LoadingState variant="cards" /> : movement.error ? <ErrorState error={movement.error} onRetry={() => void movement.refetch()} /> : m ? (
        <>
          <Card tone="green" accessibilityLabel={`Balance: ${m.balance} movement points`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="bolt" color="#121318" size={22} />
              <Txt variant="heading" style={{ flex: 1 }}>Your balance</Txt>
            </View>
            <BigNumber value={m.balance.toLocaleString()} unit="points" />
            <Txt color="textMuted">{`${m.earned_total.toLocaleString()} earned · ${m.spent_total.toLocaleString()} spent · ${m.earned_7d.toLocaleString()} in the last 7 days`}</Txt>
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="label">Earned today</Txt>
                <Txt variant="label" tabular>{`${m.earned_today} / ${m.daily_cap}`}</Txt>
              </View>
              <ProgressBar value={m.earned_today / Math.max(1, m.daily_cap)} label={`Earned today: ${m.earned_today} of ${m.daily_cap} points`} />
            </View>
            {m.balance < 0 ? <Txt variant="caption">Your balance is below zero because a run whose points you had spent was removed. New runs bring it back up.</Txt> : null}
          </Card>
          <Button label="Reclaim lost ground" size="lg" arrow icon="hexagon" onPress={() => setReclaim(true)} disabled={!competition || !season} hint={!season ? 'There is no active season' : undefined} />
          <Section title="How points work" icon="info">
            <Card>
              {[
                ['route', `Every verified run earns ${m.points_per_km} points per kilometre, public or private. Private runs stay private: they earn points but never post, claim land or appear on a map.`],
                ['shield', 'Only distance the server can verify counts: no mocked locations, no gaps or pauses, no stretches at vehicle speed.'],
                ['calendar', `You can earn up to ${m.daily_cap} points a day.`],
                ['hexagon', `Spend points to reclaim cells you held and lost to another runner's loop: ${m.cost_per_cell} points a cell. Points can't buy ground you never held.`],
                ['refresh', 'If the run that took your cell is later ruled invalid, the points you spent come back.'],
                ['eye-off', 'Only you can see your balance. Points never affect your global ranking.']
              ].map(([icon, text]) => (
                <View key={text} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                  <Icon name={icon as 'route'} color={p.greenText} size={20} />
                  <Txt style={{ flex: 1 }}>{text}</Txt>
                </View>
              ))}
            </Card>
          </Section>
          <Section title="History" icon="clock">
            {history.isLoading ? <LoadingState /> : history.error ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : history.data?.length ? (
              <ListGroup>
                {history.data.map((e, i) => {
                  const text = entryText(e, units);
                  return (
                    <Row
                      key={`${e.kind}-${e.request_id ?? e.activity_id ?? i}`}
                      icon={e.kind === 'run' ? 'route' : e.kind === 'reclaim' ? 'hexagon' : e.kind === 'refund' ? 'refresh' : 'alert'}
                      title={text.title}
                      subtitle={text.subtitle}
                      value={`${e.amount > 0 ? '+' : e.amount < 0 ? '\u2212' : ''}${Math.abs(e.amount).toLocaleString()}`}
                      onPress={e.kind === 'run' && e.activity_id ? () => router.push({ pathname: '/activities/[id]', params: { id: e.activity_id! } }) : undefined}
                    />
                  );
                })}
              </ListGroup>
            ) : (
              <EmptyState icon="bolt" title="No points yet" body="Record a run. Once the server has verified it, the points appear here." action={{ label: 'Start a run', onPress: () => router.push('/run/active') }} />
            )}
          </Section>
        </>
      ) : null}
      <ReclaimSheet visible={reclaim} onClose={() => setReclaim(false)} competitionId={competition?.id} seasonId={season?.id} />
    </Screen>
  );
}
