import { useMemo, useState } from 'react';
import { router, Stack } from 'expo-router';
import { formatDuration } from '@loopfield/core';
import { fmtDistance } from '@/lib/format';
import { Badge, Banner, EmptyState, ErrorState, LoadingState, Row, Screen, Segmented, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import { routesToFeatures, useRoutesInView } from '@/features/map/useMapData';
import { useCompetition } from '@/state/competition';
import { useUnits } from '@/state/session';
import type { Bounds } from '@/territory/h3';
import { usePalette } from '@/theme/tokens';

/** S16 Speed routes — map or list of published routes, distance, direction, champion and record. */
export default function SpeedRoutes() {
  const p = usePalette();
  const units = useUnits();
  const { competition, season } = useCompetition();
  const center = useInitialCenter();
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const routes = useRoutesInView(bounds);
  const fc = useMemo(() => (routes.data ? routesToFeatures(routes.data, p.title, p.accent) : undefined), [routes.data, p.title, p.accent]);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Speed routes' }} />
      {!competition || !season ? <Banner tone="info" text="Route titles need an active season in the selected competition." /> : null}
      <Segmented label="View" value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'list', label: 'List' }]} />
      {center !== undefined ? (
        <MapCanvas
          height={view === 'map' ? 360 : 160}
          center={center}
          zoom={center ? 13 : 2}
          showUser
          layers={{ routes: fc }}
          onIdle={(b) => setBounds(b)}
          onPressRoute={(id) => router.push({ pathname: '/routes/[id]', params: { id } })}
          accessibilityLabel={`Speed routes map with ${routes.data?.length ?? 0} routes in view. The list below has the same routes.`}
        />
      ) : null}
      {routes.tooLarge ? <Banner text="Zoom in to load routes for this area." /> : null}
      {routes.isLoading && bounds ? <LoadingState /> : routes.error ? <ErrorState error={routes.error} onRetry={() => void routes.refetch()} /> : routes.data?.length ? (
        routes.data.map((r) => (
          <Row
            key={r.course_id}
            title={r.name}
            subtitle={`${fmtDistance(r.length_m, units)} · ${r.closed ? 'loop' : 'one way'}${r.start_bearing != null ? ` · starts heading ${Math.round(r.start_bearing)}°` : ''} · ${r.champion_name ? `champion ${r.i_am_champion ? 'you' : r.champion_name}` : 'no champion yet'}`}
            right={r.status !== 'active' ? <Badge label="Suspended" tone="muted" /> : r.benchmark_ms ? <Badge label={formatDuration(r.benchmark_ms)} tone="title" /> : undefined}
            onPress={() => router.push({ pathname: '/routes/[id]', params: { id: r.course_id } })}
          />
        ))
      ) : bounds && !routes.tooLarge ? <EmptyState title="No approved routes in this area" body="Propose a route from one of your runs; a reviewer checks it before it opens for titles." /> : null}
      <Txt variant="caption">Routes are reviewed before publication. Titles count only on the current version of a route, run in its set direction.</Txt>
    </Screen>
  );
}
