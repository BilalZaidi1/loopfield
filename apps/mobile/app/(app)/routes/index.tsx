import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { formatDuration } from '@loopfield/core';
import { fmtDistance } from '@/lib/format';
import { Badge, Banner, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Segmented, Txt } from '@/components/ui';
import { MapCanvas, mapAvailability } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import { routesToFeatures, useRoutesInView } from '@/features/map/useMapData';
import { useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';
import { boundsAround, type Bounds } from '@/territory/h3';
import { spacing } from '@/theme/tokens';

/** S16 Speed routes — map or list of published routes, distance, direction, champion and record. */
export default function SpeedRoutes() {
  const units = useUnits();
  const { competition, season } = useCompetition();
  const center = useInitialCenter();
  const canMap = mapAvailability().ok;
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [view, setView] = useState<'map' | 'list'>(canMap ? 'map' : 'list');
  // Without a drawable map, list the routes around the start point instead of waiting for a map view.
  const area = canMap ? bounds : center ? boundsAround(center, 0.03, 0.025) : null;
  const routes = useRoutesInView(area);
  const fc = useMemo(() => (routes.data ? routesToFeatures(routes.data) : undefined), [routes.data]);
  return (
    <Screen onRefresh={() => void routes.refetch()} refreshing={routes.isRefetching}>
      <Stack.Screen options={{ title: 'Speed routes' }} />
      {!competition || !season ? <Banner tone="info" text="Route titles need an active season in the selected competition." /> : null}
      {canMap ? <Segmented label="View" value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'list', label: 'List' }]} /> : null}
      {canMap && center !== undefined ? (
        <MapCanvas
          height={view === 'map' ? 380 : 170}
          center={center}
          zoom={center ? 13 : 2}
          showUser
          layers={{ routes: fc }}
          onIdle={(b) => setBounds(b)}
          onPressRoute={(id) => router.push({ pathname: '/routes/[id]', params: { id } })}
          accessibilityLabel={`Speed routes map with ${routes.data?.length ?? 0} routes in view. The list below has the same routes.`}
        />
      ) : null}
      {!canMap ? <Txt color="textMuted">Routes within about 3 km of your last known start point.</Txt> : null}
      {routes.tooLarge ? <Banner text="Zoom in to load routes for this area." /> : null}
      {routes.isLoading && area ? (
        <LoadingState />
      ) : routes.error ? (
        <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
      ) : routes.data?.length ? (
        <ListGroup>
          {routes.data.map((r) => (
            <Row
              key={r.course_id}
              icon={r.i_am_champion ? 'crown' : 'route'}
              title={r.name}
              subtitle={`${fmtDistance(r.length_m, units, 1)} · ${r.closed ? 'loop' : 'one way'}${r.start_bearing != null ? ` · starts heading ${Math.round(r.start_bearing)}°` : ''}\n${r.champion_name ? `Title: ${r.i_am_champion ? 'you' : r.champion_name}` : 'No title holder yet'}`}
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  {r.status !== 'active' ? <Badge label="Suspended" tone="muted" /> : r.benchmark_ms ? <Badge label={formatDuration(r.benchmark_ms)} tone="title" icon="stopwatch" /> : null}
                </View>
              }
              onPress={() => router.push({ pathname: '/routes/[id]', params: { id: r.course_id } })}
            />
          ))}
        </ListGroup>
      ) : area && !routes.tooLarge ? (
        <EmptyState icon="route" title="No approved routes in this area" body="Propose a route from one of your runs; a reviewer checks it before it opens for titles." />
      ) : null}
      <Txt variant="caption" style={{ marginTop: spacing.xs }}>Routes are reviewed before publication. Titles count only on the current version of a route, run in its set direction.</Txt>
    </Screen>
  );
}
