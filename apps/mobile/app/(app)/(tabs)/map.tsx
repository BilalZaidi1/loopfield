import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDate } from '@/lib/format';
import { Badge, Banner, Button, Card, OfflineBanner, Screen, Segmented, Toggle, Txt } from '@/components/ui';
import { TopBar } from '@/components/TopBar';
import { MapCanvas } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import { routesToFeatures, useExclusions, useRoutesInView, useTerritoryViewport } from '@/features/map/useMapData';
import { useCompetition } from '@/state/competition';
import { useSession } from '@/state/session';
import { cellsToFeatures, summarizeCells, type Bounds } from '@/territory/h3';
import { spacing, usePalette } from '@/theme/tokens';

/** S14 Territory map — controllers, your land, unavailable cells, scope, season and Start Run. */
export default function TerritoryMap() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { settings } = useSession();
  const { competitions, competition, season, select, loading } = useCompetition();
  const center = useInitialCenter();
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [showRoutes, setShowRoutes] = useState(true);
  const cells = useTerritoryViewport(bounds);
  const exclusions = useExclusions(bounds);
  const routes = useRoutesInView(showRoutes ? bounds : null);
  const fc = useMemo(() => cellsToFeatures(cells.data ?? [], { landMine: p.landMine, unavailable: p.unavailable }), [cells.data, p.landMine, p.unavailable]);
  const routeFc = useMemo(() => (routes.data ? routesToFeatures(routes.data, p.title, p.accent) : undefined), [routes.data, p.title, p.accent]);
  const summary = useMemo(() => summarizeCells(cells.data ?? []), [cells.data]);
  const participating = Boolean(settings?.territory_competition_enabled);

  return (
    <Screen edges={['top']}>
      <View style={{ gap: spacing.sm }}>
        <TopBar title="Map" />
        <OfflineBanner />
        {competitions.length > 1 ? (
          <Segmented label="Competition" value={competition?.id ?? ''} onChange={select} options={competitions.map((c) => ({ value: c.id, label: c.name }))} />
        ) : null}
        {competition ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
            <Txt variant="label">{competition.name}</Txt>
            {season ? <Badge label={`Season ${season.number} · ends ${fmtDate(season.ends_at)}`} tone="info" /> : <Badge label={loading ? 'Loading season…' : 'No active season'} tone="muted" />}
          </View>
        ) : (
          <Banner tone="info" text={loading ? 'Loading competitions…' : 'No competition is available in your area yet. You can still record private runs.'} />
        )}
        {!participating ? (
          <Banner tone="info" text="You are viewing the map without taking part. Turn on territory in Privacy settings to claim land." action={{ label: 'Privacy', onPress: () => router.push('/settings/privacy') }} />
        ) : null}
      </View>
      {center === undefined ? null : (
        <MapCanvas
          height={420}
          accessibilityLabel={`Territory map. ${summary.mine} of your cells, ${summary.others} cells held by other runners and ${summary.unavailable} unavailable cells in view. A text summary follows the map.`}
          center={center}
          zoom={center ? 14 : 2}
          showUser
          layers={{ cells: fc, overlayCells: exclusions.data, routes: showRoutes ? routeFc : undefined }}
          onIdle={(b) => setBounds(b)}
          onPressCell={(cell) => router.push({ pathname: '/territory/[cell]', params: { cell } })}
          onPressRoute={(id) => router.push({ pathname: '/routes/[id]', params: { id } })}
        />
      )}
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        {cells.tooLarge ? <Banner tone="info" text="Zoom in to load territory for this area." /> : null}
        {cells.error ? <Banner tone="danger" text="Territory could not be loaded for this view." action={{ label: 'Retry', onPress: () => void cells.refetch() }} /> : null}
        <Card accessibilityLabel="Territory in view">
          <Txt variant="heading">In view</Txt>
          {cells.isFetching && !cells.data ? <Txt color="textMuted">Loading…</Txt> : null}
          <Txt>{summary.mine} yours · {summary.others} other runners · {summary.unavailable} unavailable</Txt>
          {summary.topControllers.map((c) => (
            <Txt key={c.name + c.cells} variant="caption">{c.name}: {c.cells} cells</Txt>
          ))}
          <Txt variant="caption">Unmarked ground is unclaimed. Grey areas are unavailable for competition (for example private or restricted land); land shown is published at least 30 minutes after a run.</Txt>
        </Card>
        <Toggle label="Show speed routes" value={showRoutes} onChange={setShowRoutes} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Button label="Start run" onPress={() => router.push('/record')} style={{ flexGrow: 1 }} />
          <Button label="Leaderboard" variant="secondary" onPress={() => router.push('/leaderboard')} />
          <Button label="Routes" variant="secondary" onPress={() => router.push('/routes')} />
          <Button label="My exploration" variant="secondary" onPress={() => router.push('/exploration')} />
        </View>
      </View>
      <View style={{ height: insets.bottom }} />
    </Screen>
  );
}
