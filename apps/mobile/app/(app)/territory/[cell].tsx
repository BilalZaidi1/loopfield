import { useMemo } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { TERRITORY_RULES } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea, fmtDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { reasonText } from '@/features/results/ResultCards';
import { useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';
import { cellCenter, plainCellsToFeatures } from '@/territory/h3';
import { usePalette } from '@/theme/tokens';

interface CellDetail {
  cell: string;
  status: 'controlled' | 'excluded' | null;
  controller_handle: string | null;
  controller_name: string | null;
  is_me: boolean;
  controlled_since: string | null;
  claim_cells: number | null;
  my_claim_id: string | null;
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
}

/** S15 Territory detail — selected eligible area, controller, season and partial capture or correction explanation. */
export default function TerritoryDetail() {
  const p = usePalette();
  const units = useUnits();
  const { cell } = useLocalSearchParams<{ cell: string }>();
  const { competition, season } = useCompetition();
  const detail = useQuery({
    queryKey: ['territory_cell_detail', competition?.id, season?.id, cell],
    enabled: Boolean(competition && season),
    queryFn: async () => (await rpc<CellDetail[]>('territory_cell_detail', { p_competition: competition!.id, p_season: season!.id, p_cell: cell }))[0] ?? null
  });
  const events = useQuery({ queryKey: ['my_territory_events'], queryFn: () => rpc<TerritoryEvent[]>('my_territory_events', { p_limit: 20 }) });
  const fc = useMemo(() => plainCellsToFeatures([cell!], detail.data?.is_me ? p.landMine : p.land), [cell, detail.data?.is_me, p.land, p.landMine]);
  const center = cellCenter(cell!);
  if (!competition || !season) return <Screen><EmptyState title="No active season" /></Screen>;
  if (detail.isLoading) return <LoadingState />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const d = detail.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Territory' }} />
      <MapCanvas height={200} center={center} zoom={16} layers={{ cells: fc }} accessibilityLabel="Map of the selected cell" />
      <Card accessibilityLabel="Cell control">
        <Txt variant="heading">{competition.name} · season {season.number}</Txt>
        {!d || !d.status ? (
          <Txt>Unclaimed. A complete eligible loop that fully encloses this cell would claim it.</Txt>
        ) : d.status === 'excluded' ? (
          <>
            <Badge label="Unavailable" tone="muted" />
            <Txt>This area is not available for competition (for example private, restricted or unsafe land). Loops around it still count elsewhere, but these cells are never awarded.</Txt>
          </>
        ) : (
          <>
            <Txt variant="title">{d.is_me ? 'Yours' : d.controller_name ?? 'A runner'}</Txt>
            {!d.is_me && d.controller_handle ? <Txt variant="caption">@{d.controller_handle}</Txt> : null}
            <Txt color="textMuted">Held since {fmtDate(d.controlled_since)}. The latest eligible completed loop takes each overlapping cell, so this can change hands when someone completes a newer loop around it.</Txt>
            {d.is_me && d.claim_cells ? <Txt variant="caption">Your claiming loop awarded {d.claim_cells} cells.</Txt> : null}
          </>
        )}
        <Txt variant="caption">Only cells fully inside a loop after a {TERRITORY_RULES.boundaryUncertaintyBandMeters.value} m edge band are awarded, so the edges of a loop may look unclaimed. Thresholds are proposed pilot values.</Txt>
        <Button variant="secondary" label="Report a problem with this area" onPress={() => router.push({ pathname: '/report', params: { type: 'area', id: cell! } })} />
      </Card>
      <Section title="Recent changes to your land">
        {events.data?.length ? events.data.map((e) => (
          <Row
            key={e.event_id}
            title={`${e.direction === 'gained' ? 'Gained' : e.direction === 'lost' ? 'Lost' : 'Corrected'} ${fmtArea(e.area_m2, units)} (${e.cells} cells)`}
            subtitle={`${fmtDate(e.occurred_on)}${e.provisional ? ' · provisional' : ''}${e.reason ? ` · ${reasonText(e.reason)}` : ''}`}
          />
        )) : <Txt color="textMuted">No changes yet.</Txt>}
      </Section>
    </Screen>
  );
}
