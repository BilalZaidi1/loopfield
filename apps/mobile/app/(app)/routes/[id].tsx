import { useMemo } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration, SPEED_RULES } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtDistance } from '@/lib/format';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { MapCanvas, type MapMarker } from '@/features/map/MapCanvas';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { usePalette } from '@/theme/tokens';

interface RouteDetail {
  course_id: string;
  course_version_id: string;
  version: number;
  name: string;
  status: 'active' | 'suspended';
  creator_handle: string | null;
  length_m: number;
  closed: boolean;
  corridor_m: number;
  path: GeoJSON.LineString;
  start_gate: GeoJSON.LineString | null;
  finish_gate: GeoJSON.LineString | null;
  start_bearing: number | null;
  checkpoints: { lng: number; lat: number }[] | null;
  champion_handle: string | null;
  champion_name: string | null;
  i_am_champion: boolean;
  benchmark_ms: number | null;
  benchmark_uncertainty_ms: number | null;
  required_ms: number | null;
  ranking: { rank: number; handle: string | null; name: string; best_ms: number; is_me: boolean }[];
}

/** S17 Speed route detail — course, gates, checkpoints, record, required margin, route ranking and Attempt. */
export default function RouteDetailScreen() {
  const p = usePalette();
  const units = useUnits();
  const { settings } = useSession();
  const { id, competition: compParam } = useLocalSearchParams<{ id: string; competition?: string }>();
  const { competition, competitions, season } = useCompetition();
  const comp = competitions.find((c) => c.id === compParam) ?? competition;
  const detail = useQuery({
    queryKey: ['speed_route_detail', id, comp?.id, season?.id],
    enabled: Boolean(comp && season),
    queryFn: () => rpc<RouteDetail | null>('speed_route_detail', { p_course: id, p_competition: comp!.id, p_season: season!.id })
  });
  const d = detail.data;
  const markers = useMemo<MapMarker[]>(() => {
    if (!d) return [];
    const coords = d.path.coordinates as [number, number][];
    const m: MapMarker[] = [{ id: 'start', coord: coords[0]!, label: 'Start', kind: 'start' }];
    (d.checkpoints ?? []).forEach((c, i) => m.push({ id: `cp${i}`, coord: [c.lng, c.lat], label: `Checkpoint ${i + 1}`, kind: 'checkpoint' }));
    if (!d.closed) m.push({ id: 'finish', coord: coords[coords.length - 1]!, label: 'Finish', kind: 'finish' });
    return m;
  }, [d]);
  const routeFc = useMemo<GeoJSON.FeatureCollection | undefined>(() => (d ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: d.path, properties: { id: d.course_id, status: d.status, color: p.title } }] } : undefined), [d, p.title]);

  if (!comp || !season) return <Screen><EmptyState title="No active season" /></Screen>;
  if (detail.isLoading) return <LoadingState />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!d) return <Screen><EmptyState title="Route not available" body="It may have been withdrawn." /></Screen>;
  const marginMs = d.benchmark_ms ? d.benchmark_ms - (d.required_ms ?? d.benchmark_ms) : null;
  return (
    <Screen>
      <Stack.Screen options={{ title: d.name }} />
      <MapCanvas height={260} layers={{ routes: routeFc, markers }} fit={null} accessibilityLabel={`Route map for ${d.name}, ${fmtDistance(d.length_m, units)}, with start, checkpoints and finish marked.`} />
      {d.status !== 'active' ? <Banner tone="warning" text="This route is suspended. Attempts are not accepted right now." /> : null}
      <Card accessibilityLabel="Route facts">
        <Txt variant="heading">{fmtDistance(d.length_m, units)} · {d.closed ? 'loop' : 'one way'} · version {d.version}</Txt>
        <Txt color="textMuted">Run it in its set direction{d.start_bearing != null ? ` (start heading about ${Math.round(d.start_bearing)}°)` : ''}: cross the start gate, pass every checkpoint, stay within {d.corridor_m} m of the course and cross the finish gate.</Txt>
        {d.creator_handle ? <Txt variant="caption">Proposed by @{d.creator_handle}</Txt> : null}
      </Card>
      <Card accessibilityLabel="Route title">
        <Txt variant="heading">Title in {comp.name}</Txt>
        {d.benchmark_ms ? (
          <>
            <Txt variant="title">{formatDuration(d.benchmark_ms)}</Txt>
            <Txt>Champion: {d.i_am_champion ? 'You' : d.champion_name ?? 'A runner'}</Txt>
            {!d.i_am_champion && d.required_ms ? <Txt color="textMuted">To take the title, finish in {formatDuration(d.required_ms)} or faster — a clear margin of {formatDuration(marginMs ?? 0)} (the larger of {SPEED_RULES.marginMinSeconds.value} s, {SPEED_RULES.marginFraction.value * 100}% of the record, or the timing uncertainty).</Txt> : null}
          </>
        ) : <Txt>No champion yet. The first eligible attempt sets the record.</Txt>}
        <Txt variant="caption">Speed titles never move or protect land. Thresholds are proposed pilot values.</Txt>
        <Button label="Attempt this route" onPress={() => router.push({ pathname: '/record', params: { course: d.course_id } })} disabled={d.status !== 'active' || !settings?.speed_competition_enabled} hint={!settings?.speed_competition_enabled ? 'Turn on route titles in Privacy settings first.' : undefined} />
      </Card>
      <Section title="Ranking this season">
        {d.ranking.length ? d.ranking.map((r) => <Row key={`${r.rank}-${r.name}`} title={`${r.rank}. ${r.is_me ? 'You' : r.name}`} right={<Badge label={formatDuration(r.best_ms)} tone={r.rank === 1 ? 'title' : 'muted'} />} />) : <Txt color="textMuted">No published attempts yet.</Txt>}
      </Section>
      <Button variant="ghost" label="Share this route" onPress={() => router.push({ pathname: '/compose', params: { route: d.course_id } })} />
      <Button variant="ghost" label="Report a problem with this route" onPress={() => router.push({ pathname: '/report', params: { type: 'route', id: d.course_id } })} />
    </Screen>
  );
}
