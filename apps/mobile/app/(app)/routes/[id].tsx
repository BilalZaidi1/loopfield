import { useMemo } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration, SPEED_RULES } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtDistance } from '@/lib/format';
import { View } from 'react-native';
import { Banner, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Medal, Row, Screen, Section, StatLine, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { MapCanvas, type MapMarker } from '@/features/map/MapCanvas';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

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
  const routeFc = useMemo<GeoJSON.FeatureCollection | undefined>(() => (d ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: d.path, properties: { id: d.course_id, status: d.status, mine: d.i_am_champion } }] } : undefined), [d]);

  if (!comp || !season) return <Screen><EmptyState icon="calendar" title="No active season" body="Route titles return when the next season starts." /></Screen>;
  if (detail.isLoading) return <Screen><LoadingState variant="cards" /></Screen>;
  if (detail.error) return <Screen><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></Screen>;
  if (!d) return <Screen><EmptyState icon="route" title="Route not available" body="It may have been withdrawn." /></Screen>;
  const marginMs = d.benchmark_ms ? d.benchmark_ms - (d.required_ms ?? d.benchmark_ms) : null;
  const km = units === 'metric' ? d.length_m / 1000 : d.length_m / 1609.344;
  const canAttempt = d.status === 'active' && Boolean(settings?.speed_competition_enabled);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Speed route' }} />
      <View>
        <MapCanvas height={280} layers={{ routes: routeFc, markers }} fit={null} accessibilityLabel={`Route map for ${d.name}, ${fmtDistance(d.length_m, units)}, with start, checkpoints and finish marked.`} />
        <View style={{ position: 'absolute', right: spacing.md, top: spacing.md }} accessible={false}>
          <Medal label={`${km >= 10 ? km.toFixed(0) : km.toFixed(1)}${units === 'metric' ? 'K' : 'mi'}`} tone={d.i_am_champion ? 'violet' : 'green'} size={64} />
        </View>
      </View>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="title">{d.name}</Txt>
        {d.creator_handle ? <Txt variant="caption">Proposed by @{d.creator_handle}</Txt> : null}
      </View>
      {d.status !== 'active' ? <Banner tone="warning" text="This route is suspended. Attempts are not accepted right now." /> : null}
      <Card padded={false} style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.xs }}>
        <StatLine icon="route" label="Distance" value={fmtDistance(d.length_m, units)} />
        <StatLine icon="compass" label="Direction" value={`${d.closed ? 'Loop' : 'One way'}${d.start_bearing != null ? ` · ${Math.round(d.start_bearing)}°` : ''}`} />
        <StatLine icon="target" label="Stay within" value={`${d.corridor_m} m of the course`} />
        <StatLine icon="flag" label="Checkpoints" value={String(d.checkpoints?.length ?? 0)} />
      </Card>
      <Txt color="textMuted">Run it in its set direction: cross the start gate, pass every checkpoint, stay on the course and cross the finish gate. Version {d.version}.</Txt>
      <Card tone="orange">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="trophy" color="#121318" size={22} />
          <Txt variant="heading" style={{ flex: 1 }}>{`Title in ${comp.name}`}</Txt>
        </View>
        {d.benchmark_ms ? (
          <>
            <Txt variant="hero" style={{ fontSize: 60, lineHeight: 62 }}>{formatDuration(d.benchmark_ms)}</Txt>
            <Txt variant="bodyStrong">{`Held by ${d.i_am_champion ? 'you' : d.champion_name ?? 'a runner'}`}</Txt>
            {!d.i_am_champion && d.required_ms ? <Txt color="textMuted">To take the title, finish in {formatDuration(d.required_ms)} or faster: a clear margin of {formatDuration(marginMs ?? 0)} (the larger of {SPEED_RULES.marginMinSeconds.value} s, {SPEED_RULES.marginFraction.value * 100}% of the record, or the timing uncertainty).</Txt> : null}
          </>
        ) : (
          <Txt variant="headline">No title holder yet. The first eligible attempt sets the record.</Txt>
        )}
        <Button label="Attempt this route" arrow onPress={() => router.push({ pathname: '/record', params: { course: d.course_id } })} disabled={!canAttempt} hint={!settings?.speed_competition_enabled ? 'Turn on route titles in Privacy settings first.' : undefined} />
        {!settings?.speed_competition_enabled ? <Txt variant="caption">Turn on route titles in Privacy settings to attempt it.</Txt> : null}
        <Txt variant="caption">Speed titles never move or protect land. Thresholds are proposed pilot values.</Txt>
      </Card>
      <Section title="Ranking this season" icon="medal">
        {d.ranking.length ? (
          <ListGroup>
            {d.ranking.map((r) => <Row key={`${r.rank}-${r.name}`} rank={r.rank} highlight={r.is_me} title={r.is_me ? 'You' : r.name} value={formatDuration(r.best_ms)} />)}
          </ListGroup>
        ) : (
          <Txt color="textMuted">No published attempts yet.</Txt>
        )}
      </Section>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button variant="secondary" icon="share" label="Share this route" onPress={() => router.push({ pathname: '/compose', params: { route: d.course_id } })} />
        <Button variant="ghost" icon="flag" label="Report a problem" onPress={() => router.push({ pathname: '/report', params: { type: 'route', id: d.course_id } })} />
      </View>
    </Screen>
  );
}
