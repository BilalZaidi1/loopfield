import { useMemo } from 'react';
import { useMovement } from '@/features/movement/api';
import { ReclaimDone, ReclaimReceipt, useReclaimFlow } from '@/features/movement/Reclaim';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { TERRITORY_RULES } from '@loopfield/core';
import { friendlyError, rpc } from '@/lib/api';
import { fmtArea, fmtDate } from '@/lib/format';
import { View } from 'react-native';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { MapCanvas } from '@/features/map/MapCanvas';
import { reasonText } from '@/features/results/ResultCards';
import { layerTitle, useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';
import { cellCenter, plainCellsToFeatures } from '@/territory/h3';
import { spacing, useTheme } from '@/theme/tokens';

interface CellDetail {
  cell: string;
  status: 'controlled' | 'excluded' | null;
  controller_handle: string | null;
  controller_name: string | null;
  is_me: boolean;
  controlled_since: string | null;
  claim_cells: number | null;
  my_claim_id: string | null;
  /** How the controller holds it: a run ('loop') or movement points ('reclaim'). */
  held_by: 'loop' | 'reclaim' | null;
  was_mine: boolean;
  reclaimable: boolean;
  blocked_reason: 'season_closed' | 'not_participating' | 'taken_with_points' | null;
  reclaim_cost: number | null;
}

interface TerritoryEvent {
  event_id: string;
  kind: string;
  direction: 'gained' | 'lost' | 'corrected';
  cells: number;
  area_m2: number;
  provisional: boolean;
  reason: string | null;
  occurred_on: string;
  source: 'loop' | 'reclaim';
}

const BLOCKED: Record<string, string> = {
  taken_with_points: 'They reclaimed it from you with movement points, so only a run can win it back.',
  season_closed: 'The season is closed, so it can no longer be reclaimed.',
  not_participating: 'Turn on territory in Privacy settings to reclaim it.'
};

/** S15 Territory detail — selected eligible area, controller, season and partial capture or correction explanation. */
export default function TerritoryDetail() {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const { cell } = useLocalSearchParams<{ cell: string }>();
  const { layer: competition, layerSeason: season } = useCompetition();
  const detail = useQuery({
    queryKey: ['territory_cell_detail', competition?.id, season?.id, cell],
    enabled: Boolean(competition && season),
    queryFn: async () => (await rpc<CellDetail[]>('territory_cell_detail', { p_competition: competition!.id, p_season: season!.id, p_cell: cell }))[0] ?? null
  });
  const events = useQuery({ queryKey: ['my_territory_events'], queryFn: () => rpc<TerritoryEvent[]>('my_territory_events', { p_limit: 20 }) });
  const d = detail.data;
  const movement = useMovement();
  const flow = useReclaimFlow(competition?.id, season?.id);
  const fc = useMemo(() => {
    const color = !d?.status ? p.textSubtle : d.status === 'excluded' ? t.territory.unavailableFill : d.is_me ? t.territory.mineFill : t.territory.rivalHues[0]!;
    return { ...plainCellsToFeatures([cell!], color), features: plainCellsToFeatures([cell!], color).features.map((f) => ({ ...f, properties: { ...f.properties, mine: Boolean(d?.is_me), status: d?.status ?? 'unclaimed' } })) };
  }, [cell, d, p.textSubtle, t.territory]);
  const center = cellCenter(cell!);
  if (!competition || !season) return <Screen><Stack.Screen options={{ title: 'Territory' }} /><EmptyState icon="calendar" title="No active season" body="Cell details appear while a season is running." /></Screen>;
  if (detail.isLoading) return <Screen><Stack.Screen options={{ title: 'Territory' }} /><LoadingState variant="cards" /></Screen>;
  if (detail.error) return <Screen><Stack.Screen options={{ title: 'Territory' }} /><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></Screen>;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Territory' }} />
      <MapCanvas height={220} center={center} zoom={16} layers={{ cells: fc }} selectedCell={cell} accessibilityLabel="Map of the selected cell" />
      {!d || !d.status ? (
        <Card tone="soft">
          <Txt variant="label" color="textMuted">{layerTitle(competition, season)}</Txt>
          <Txt variant="headline">Unclaimed</Txt>
          <Txt>A complete eligible loop that fully encloses this cell would claim it.</Txt>
        </Card>
      ) : d.status === 'excluded' ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ban" color={p.textMuted} size={22} />
            </View>
            <Txt variant="headline" style={{ flex: 1 }}>Unavailable area</Txt>
          </View>
          <Txt color="textMuted">This area is not available for competition (for example private, restricted or unsafe land). Loops around it still count elsewhere, but these cells are never awarded.</Txt>
        </Card>
      ) : d.is_me ? (
        <Card tone="violet">
          <Txt variant="label" color="textMuted">{layerTitle(competition, season)}</Txt>
          <Txt variant="display" style={{ fontSize: 36, lineHeight: 40 }}>Your ground</Txt>
          <Txt>{`Held since ${fmtDate(d.controlled_since)}.`}</Txt>
          {d.held_by === 'reclaim' ? <Badge icon="bolt" label="Reclaimed with movement points" /> : d.claim_cells ? <Badge icon="hexagon" label={`Your claiming loop awarded ${d.claim_cells} cells`} /> : null}
          <Txt color="textMuted">{d.held_by === 'reclaim'
            ? 'A newer loop by another runner can take it again; points cannot.'
            : 'The latest eligible completed loop takes each overlapping cell, so this can change hands when someone completes a newer loop around it.'}</Txt>
        </Card>
      ) : (
        <Card>
          <Txt variant="label" color="textMuted">{layerTitle(competition, season)}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar name={d.controller_name ?? 'A runner'} size={48} ring={t.territory.rivalHues[0]} />
            <View style={{ flex: 1 }}>
              <Txt variant="headline">{d.controller_name ?? 'A runner'}</Txt>
              {d.controller_handle ? <Txt variant="caption">@{d.controller_handle}</Txt> : null}
            </View>
          </View>
          {d.held_by === 'reclaim' ? <Badge icon="bolt" label="Held through movement points" /> : null}
          <Txt color="textMuted">{`Held since ${fmtDate(d.controlled_since)}. The latest eligible completed loop takes each overlapping cell, so this can change hands when someone completes a newer loop around it.`}</Txt>
        </Card>
      )}
      {d && !d.is_me && d.was_mine ? (
        flow.done ? (
          <Card><ReclaimDone result={flow.done} onDone={() => { flow.reset(); void detail.refetch(); }} /></Card>
        ) : (
          <Card tone="soft" accessibilityLabel={d.reclaimable ? `This was yours. Reclaim it for ${d.reclaim_cost} points` : 'This was yours earlier'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="hexagon" color={p.primary} size={22} />
              <Txt variant="heading" style={{ flex: 1 }}>This was yours</Txt>
            </View>
            {d.reclaimable && d.reclaim_cost ? (
              <>
                <Txt color="textMuted">You held this cell earlier. Reclaim it with movement points and it is yours again straight away.</Txt>
                <ReclaimReceipt cells={1} costPerCell={d.reclaim_cost} total={d.reclaim_cost} balance={movement.data?.balance ?? 0} remaining={(movement.data?.balance ?? 0) - d.reclaim_cost} />
                {flow.error ? <Banner tone="danger" text={friendlyError(flow.error)} /> : null}
                <Button label={`Reclaim for ${d.reclaim_cost} points`} size="lg" arrow icon="bolt" loading={flow.busy}
                  disabled={(movement.data?.balance ?? 0) < d.reclaim_cost || flow.busy}
                  onPress={() => flow.start([d.cell], d.reclaim_cost!, movement.data?.balance ?? 0)} />
              </>
            ) : (
              <Txt color="textMuted">{BLOCKED[d.blocked_reason ?? ''] ?? 'You held this cell earlier.'}</Txt>
            )}
          </Card>
        )
      ) : null}
      <Txt variant="caption">Only cells fully inside a loop after a {TERRITORY_RULES.boundaryUncertaintyBandMeters.value} m edge band are awarded, so the edges of a loop may look unclaimed. Thresholds are proposed pilot values.</Txt>
      <Button variant="ghost" icon="flag" label="Report a problem with this area" onPress={() => router.push({ pathname: '/report', params: { type: 'area', id: cell! } })} />
      <Section title="Recent changes to your land" icon="refresh">
        {events.isLoading ? <LoadingState /> : events.data?.length ? (
          <ListGroup>
            {events.data.map((e) => (
              <Row
                key={e.event_id}
                icon={e.direction === 'gained' ? 'plus' : e.direction === 'lost' ? 'minus' : 'refresh'}
                destructive={e.direction === 'lost'}
                title={e.source === 'reclaim'
                  ? `${e.direction === 'gained' ? 'Reclaimed' : 'Taken back with points:'} ${fmtArea(e.area_m2, units)}`
                  : `${e.direction === 'gained' ? 'Gained' : e.direction === 'lost' ? 'Lost' : 'Corrected'} ${fmtArea(e.area_m2, units)}`}
                subtitle={`${e.cells} ${e.cells === 1 ? 'cell' : 'cells'} · ${fmtDate(e.occurred_on)}${e.provisional ? ' · provisional' : ''}${e.reason ? ` · ${reasonText(e.reason)}` : ''}`}
              />
            ))}
          </ListGroup>
        ) : (
          <Txt color="textMuted">No changes yet.</Txt>
        )}
      </Section>
    </Screen>
  );
}
