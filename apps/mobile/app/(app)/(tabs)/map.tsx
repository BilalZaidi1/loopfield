import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';
import { TERRITORY_RULES } from '@loopfield/core';
import { fmtDate, fmtDistance, fmtDuration } from '@/lib/format';
import { Avatar, Badge, Banner, Button, IconButton, OfflineBanner, Row, Sheet, Skeleton, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { MapCanvas, mapAvailability, type MapHandle } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import { routesToFeatures, useExclusions, useRoutesInView, useTerritoryViewport, type RouteInView } from '@/features/map/useMapData';
import { daysLeft } from '@/features/territory/useTerritoryStats';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { boundsAround, cellsToFeatures, gridFeatures, resolutionOf, summarizeCells, type Bounds, type ViewportCell } from '@/territory/h3';
import { controllerColor, radius, spacing, useTheme } from '@/theme/tokens';
import { useLayout } from '@/theme/layout';

type Selection = { kind: 'cell'; id: string } | { kind: 'route'; id: string } | null;

const pad = (b: Bounds, f = 0.08): Bounds => {
  const dx = (b.maxLng - b.minLng) * f;
  const dy = (b.maxLat - b.minLat) * f;
  return { minLng: b.minLng - dx, minLat: b.minLat - dy, maxLng: b.maxLng + dx, maxLat: b.maxLat + dy };
};

/**
 * S14 Territory map — the game board. Full-bleed map with your land, rival land and unavailable areas,
 * speed routes and your location; floating controls; a bottom sheet that summarises what is in view
 * and turns into a detail panel for the cell or route you tap. Start run is always one tap away.
 */
export default function TerritoryMap() {
  const t = useTheme();
  const p = t.palette;
  const tc = t.territory;
  const insets = useSafeAreaInsets();
  const { isWide } = useLayout();
  const { settings } = useSession();
  const { competitions, competition, season, select, loading } = useCompetition();
  const center = useInitialCenter();
  const available = mapAvailability().ok;
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [zoom, setZoom] = useState(14);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [selected, setSelected] = useState<Selection>(null);
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState<'legend' | 'competition' | null>(null);
  const [sheetH, setSheetH] = useState(240);
  const mapRef = useRef<MapHandle>(null);

  // Without a drawable map (browser, Expo Go) the area around the start point is summarised instead.
  const area = available ? bounds : center ? boundsAround(center) : null;
  const cells = useTerritoryViewport(area);
  const exclusions = useExclusions(available ? bounds : null);
  const routes = useRoutesInView(showRoutes ? area : null);
  const fc = useMemo(() => cellsToFeatures(cells.data ?? [], { mine: tc.mineFill, unavailable: tc.unavailableFill, rivalHues: tc.rivalHues }), [cells.data, tc]);
  const grid = useMemo(
    () => (available && showGrid && bounds && zoom >= 14.5 ? gridFeatures(pad(bounds), resolutionOf(cells.data ?? [], TERRITORY_RULES.gridResolution.value)) : null),
    [available, showGrid, bounds, zoom, cells.data]
  );
  const routeFc = useMemo(() => (routes.data ? routesToFeatures(routes.data) : undefined), [routes.data]);
  const summary = useMemo(() => summarizeCells(cells.data ?? []), [cells.data]);
  const participating = Boolean(settings?.territory_competition_enabled);
  const selectedCell = selected?.kind === 'cell' ? (cells.data ?? []).find((c) => c.cell === selected.id) ?? null : null;
  const selectedRoute = selected?.kind === 'route' ? (routes.data ?? []).find((r) => r.course_id === selected.id) ?? null : null;
  const left = daysLeft(season?.ends_at);

  const recenter = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (perm?.status !== 'granted') return;
    const here = await Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
    if (here) mapRef.current?.flyTo([here.coords.longitude, here.coords.latitude], 15.5);
  }, []);

  const a11ySummary = `Territory map. ${summary.mine} of your cells, ${summary.others} cells held by other runners and ${summary.unavailable} unavailable cells in view. The panel below lists the same information.`;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      {center === undefined ? (
        <Skeleton height={'100%' as unknown as number} round={0} />
      ) : (
        <MapCanvas
          fill
          mapRef={mapRef}
          accessibilityLabel={a11ySummary}
          center={center}
          zoom={center ? 14.5 : 2}
          showUser
          ornamentBottom={isWide ? 8 : sheetH + 8}
          selectedCell={selected?.kind === 'cell' ? selected.id : null}
          layers={{ cells: fc, exclusions: exclusions.data, grid, routes: showRoutes ? routeFc : undefined }}
          onIdle={(b, z) => {
            setBounds(b);
            setZoom(z);
          }}
          onPressCell={(cell) => setSelected({ kind: 'cell', id: cell })}
          onPressRoute={(id) => setSelected({ kind: 'route', id })}
          onPressMap={() => setSelected(null)}
        />
      )}

      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + spacing.sm }, isWide ? { right: undefined, width: 560 } : null]}>
        <OfflineBanner />
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable
            onPress={() => setSheet('competition')}
            accessibilityRole="button"
            accessibilityLabel={competition ? `${competition.name}${season ? `, season ${season.number}, ${left} days left` : ', no active season'}. Change competition or see the season` : 'Competition'}
            style={({ pressed }) => [styles.chip, { backgroundColor: p.surface, opacity: pressed ? 0.85 : 1 }, t.elevation.floating]}>
            <View style={[styles.chipIcon, { backgroundColor: t.blocks.orange.bg }]}>
              <Icon name="trophy" color="#121318" size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>{competition?.name ?? (loading ? 'Loading competitions…' : 'No competition nearby')}</Txt>
              <Txt variant="caption" numberOfLines={1}>{season ? (left === 0 ? `Season ${season.number} · last day` : `Season ${season.number} · ${left} days left`) : competition ? 'No active season' : 'Private runs still record'}</Txt>
            </View>
            <Icon name="chevron-down" color={p.textMuted} size={20} />
          </Pressable>
          <IconButton icon="medal" label="Leaderboard" variant="surface" onPress={() => router.push('/leaderboard')} />
        </View>
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { top: insets.top + 88 }]}>
        {available ? <IconButton icon="locate" label="Show my location" variant="surface" onPress={() => void recenter()} /> : null}
        <IconButton icon="route" label={showRoutes ? 'Hide speed routes' : 'Show speed routes'} variant="surface" color={showRoutes ? p.primary : p.textSubtle} onPress={() => setShowRoutes(!showRoutes)} />
        {available ? <IconButton icon="hexagon" label={showGrid ? 'Hide the grid' : 'Show the grid'} variant="surface" color={showGrid ? p.primary : p.textSubtle} onPress={() => setShowGrid(!showGrid)} /> : null}
        <IconButton icon="info" label="Map key" variant="surface" onPress={() => setSheet('legend')} />
      </View>

      <Animated.View
        layout={LinearTransition.springify().damping(24).stiffness(240)}
        onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))}
        style={[
          styles.sheet,
          { backgroundColor: p.surface },
          t.elevation.floating,
          isWide ? { left: spacing.lg, bottom: spacing.lg, width: 400, borderRadius: radius.xl } : { left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }
        ]}>
        <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Show less' : 'Show more about this area'} accessibilityState={{ expanded }} hitSlop={8} style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
          <View style={[styles.grabber, { backgroundColor: p.borderStrong }]} />
        </Pressable>
        {selectedCell ? (
          <CellPanel cell={selectedCell} rivalHues={tc.rivalHues} onClose={() => setSelected(null)} />
        ) : selectedRoute ? (
          <RoutePanel route={selectedRoute} onClose={() => setSelected(null)} />
        ) : (
          <InView summary={summary} loading={cells.isFetching && !cells.data} available={available} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        )}
        {expanded && !selected ? (
          <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            {cells.tooLarge ? <Banner tone="info" text="Zoom in to load territory for this area." /> : null}
            {cells.error ? <Banner tone="danger" text="Territory could not be loaded for this view." action={{ label: 'Retry', onPress: () => void cells.refetch() }} /> : null}
            {!participating && competition ? (
              <Banner tone="info" text="You are viewing the map without taking part. Turn on territory in Privacy settings to claim land." action={{ label: 'Privacy', onPress: () => router.push('/settings/privacy') }} />
            ) : null}
            {summary.topControllers.length ? (
              <View>
                <Txt variant="heading">Holding the most here</Txt>
                {summary.topControllers.map((c, i) => (
                  <Row
                    key={c.key}
                    rank={i + 1}
                    title={c.name}
                    subtitle={c.handle ? `@${c.handle}` : undefined}
                    value={`${c.cells} ${c.cells === 1 ? 'cell' : 'cells'}`}
                    highlight={c.mine}
                    leading={<Swatch color={c.mine ? tc.mineFill : controllerColor(c.key, tc.rivalHues)} />}
                  />
                ))}
              </View>
            ) : null}
            <View>
              <Row icon="medal" title="Leaderboard" subtitle="Published land this season" onPress={() => router.push('/leaderboard')} />
              <Row icon="route" title="Speed routes" subtitle="Approved routes and their title holders" onPress={() => router.push('/routes')} />
              <Row icon="compass" title="My exploration" subtitle="Private record of where you have run" onPress={() => router.push('/exploration')} />
            </View>
            <Txt variant="caption">Unmarked ground is unclaimed. Grey areas are unavailable for competition (for example private or restricted land). Land shown is published at least 30 minutes after a run.</Txt>
          </ScrollView>
        ) : null}
        <Button label="Start a run" size="lg" arrow icon="record" onPress={() => router.push('/record')} />
      </Animated.View>

      <Sheet visible={sheet === 'legend'} title="Map key" onClose={() => setSheet(null)}>
        <Legend />
      </Sheet>
      <Sheet visible={sheet === 'competition'} title="Competition" onClose={() => setSheet(null)}>
        {competitions.length ? (
          <View>
            {competitions.map((c) => (
              <Row
                key={c.id}
                icon={c.kind === 'club' ? 'clubs' : 'globe'}
                title={c.name}
                subtitle={c.kind === 'club' ? 'Club competition' : 'Public competition'}
                right={c.id === competition?.id ? <Icon name="check" color={p.primary} size={22} /> : undefined}
                onPress={() => {
                  select(c.id);
                  setSelected(null);
                  setSheet(null);
                }}
              />
            ))}
          </View>
        ) : (
          <Txt color="textMuted">No competition is available in your area yet. You can still record private runs.</Txt>
        )}
        {season ? <Txt variant="caption">{`Season ${season.number} runs ${fmtDate(season.starts_at)} to ${fmtDate(season.ends_at)}.`}</Txt> : null}
        <Button
          label="Season history"
          variant="secondary"
          icon="calendar"
          onPress={() => {
            setSheet(null);
            router.push('/seasons');
          }}
        />
      </Sheet>
    </View>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <Svg width={26} height={28} style={{ flexShrink: 0 }} viewBox="0 0 26 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polygon points="13,2 24,8 24,20 13,26 2,20 2,8" fill={color} fillOpacity={dashed ? 0.2 : 0.55} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '3,2' : undefined} />
    </Svg>
  );
}

function Stat({ color, label, value, dashed }: { color: string; label: string; value: number; dashed?: boolean }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: p.surfaceAlt }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Swatch color={color} dashed={dashed} />
      <View>
        <Txt variant="metric" style={{ fontSize: 24, lineHeight: 26 }}>{String(value)}</Txt>
        <Txt variant="caption" numberOfLines={1}>{label}</Txt>
      </View>
    </View>
  );
}

function InView({ summary, loading, available, expanded, onToggle }: { summary: ReturnType<typeof summarizeCells>; loading: boolean; available: boolean; expanded: boolean; onToggle: () => void }) {
  const t = useTheme();
  const tc = t.territory;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Txt variant="headline">{available ? 'In view' : 'Around your area'}</Txt>
          <Txt variant="caption">{loading ? 'Loading territory…' : available ? 'Pan and zoom to explore who holds what.' : 'About 2.5 km around your last known start point.'}</Txt>
        </View>
        <Button label={expanded ? 'Less' : 'More'} size="sm" variant="ghost" onPress={onToggle} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Stat color={tc.mineFill} label="Yours" value={summary.mine} />
        <Stat color={tc.rivalHues[0]!} label="Rivals" value={summary.others} />
        <Stat color={tc.unavailableFill} label="Unavailable" value={summary.unavailable} dashed />
      </View>
    </View>
  );
}

function CellPanel({ cell, rivalHues, onClose }: { cell: ViewportCell; rivalHues: readonly string[]; onClose: () => void }) {
  const t = useTheme();
  const tc = t.territory;
  const excluded = cell.status === 'excluded';
  const color = excluded ? tc.unavailableFill : cell.is_me ? tc.mineFill : controllerColor(cell.controller_key ?? 'none', rivalHues);
  const title = excluded ? 'Unavailable area' : cell.is_me ? 'Your ground' : cell.controller_name ?? 'A runner';
  const body = excluded
    ? 'Not available for competition (for example private, restricted or unsafe land). These cells are never awarded.'
    : cell.is_me
      ? 'You hold this cell. A newer eligible loop around it by someone else would take it.'
      : 'Rival ground. The latest eligible completed loop takes each cell it fully encloses.';
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {!excluded && !cell.is_me && cell.controller_name ? <Avatar name={cell.controller_name} size={44} ring={color} /> : <Swatch color={color} dashed={excluded} />}
        <View style={{ flex: 1 }}>
          <Txt variant="headline" numberOfLines={1}>{title}</Txt>
          {!excluded && !cell.is_me && cell.controller_handle ? <Txt variant="caption">@{cell.controller_handle}</Txt> : null}
        </View>
        <IconButton icon="close" label="Close details" variant="soft" size={40} onPress={onClose} />
      </View>
      <Txt color="textMuted">{body}</Txt>
      <Button label="Cell details" variant="secondary" icon="hexagon" onPress={() => router.push({ pathname: '/territory/[cell]', params: { cell: cell.cell } })} />
    </View>
  );
}

function RoutePanel({ route, onClose }: { route: RouteInView; onClose: () => void }) {
  const t = useTheme();
  const units = useUnits();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={[styles.chipIcon, { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: route.i_am_champion ? t.palette.primarySoft : t.palette.greenSoft }]}>
          <Icon name="route" color={route.i_am_champion ? t.palette.primary : t.palette.greenText} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="headline" numberOfLines={1}>{route.name}</Txt>
          <Txt variant="caption">{`${fmtDistance(route.length_m, units, 1)} · ${route.closed ? 'Loop' : 'Point to point'}`}</Txt>
        </View>
        <IconButton icon="close" label="Close details" variant="soft" size={40} onPress={onClose} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {route.status === 'suspended' ? <Badge tone="warning" label="Suspended" /> : null}
        {route.i_am_champion ? <Badge tone="violet" icon="crown" label="You hold the title" /> : route.champion_name ? <Badge tone="title" icon="trophy" label={`Title: ${route.champion_name}`} /> : <Badge tone="muted" label="No title holder yet" />}
        {route.benchmark_ms ? <Badge tone="info" icon="stopwatch" label={`Best ${fmtDuration(route.benchmark_ms)}`} /> : null}
      </View>
      <Button label="Route details" variant="secondary" icon="route" onPress={() => router.push({ pathname: '/routes/[id]', params: { id: route.course_id } })} />
    </View>
  );
}

function Legend() {
  const t = useTheme();
  const tc = t.territory;
  const items: { swatch: ReactNode; title: string; body: string }[] = [
    { swatch: <Swatch color={tc.mineFill} />, title: 'Your ground', body: 'Cells you hold this season, outlined with a glow.' },
    { swatch: <View style={{ flexDirection: 'row' }}><Swatch color={tc.rivalHues[0]!} /><Swatch color={tc.rivalHues[1]!} /></View>, title: 'Rival ground', body: 'Held by other runners. Each runner keeps one colour so you can tell them apart.' },
    { swatch: <Swatch color={tc.unavailableFill} dashed />, title: 'Unavailable', body: 'Private, restricted or unsafe areas. They are never awarded.' },
    { swatch: <LegendIcon icon="hexagon" color={t.palette.primary} />, title: 'Unclaimed', body: 'No marking means nobody holds it. Only an eligible loop can claim it; the faint grid shows the cell shapes.' },
    { swatch: <LegendIcon icon="route" color={tc.route} />, title: 'Speed routes', body: 'Approved routes with titles. Your colour when you hold the title, dashed while suspended.' }
  ];
  return (
    <View style={{ gap: spacing.md }}>
      {items.map((i) => (
        <View key={i.title} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }} accessible accessibilityLabel={`${i.title}. ${i.body}`}>
          <View style={{ width: 56, alignItems: 'center' }}>{i.swatch}</View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong">{i.title}</Txt>
            <Txt variant="caption">{i.body}</Txt>
          </View>
        </View>
      ))}
      <Txt variant="caption">Land appears at least 30 minutes after a run. Thresholds are proposed pilot values and may change after field testing.</Txt>
    </View>
  );
}

function LegendIcon({ icon, color }: { icon: IconName; color: string }) {
  return <Icon name={icon} color={color} size={26} />;
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  chip: { flex: 1, minHeight: 56, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: 8, paddingRight: spacing.lg },
  chipIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', right: spacing.lg, gap: spacing.sm },
  sheet: { position: 'absolute', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  grabber: { width: 44, height: 5, borderRadius: 3 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md }
});
