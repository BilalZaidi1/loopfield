import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';
import { TERRITORY_RULES } from '@loopfield/core';
import { fmtArea, fmtCount, fmtDate, fmtDistance, fmtDuration } from '@/lib/format';
import { friendlyError } from '@/lib/api';
import { Avatar, Badge, Banner, Button, IconButton, OfflineBanner, PressableScale, Row, Sheet, Skeleton, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { MapCanvas, mapAvailability, type MapHandle } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import type { AvatarPinData } from '@/features/map/AvatarPin';
import { clusterPins, MIN_AVATAR_ZOOM, ownerAnchors, useOwnersInView, type OwnerInView } from '@/features/map/owners';
import { useSignedUrls } from '@/features/social/media';
import { routesToFeatures, useExclusions, useRoutesInView, useTerritoryViewport, type RouteInView } from '@/features/map/useMapData';
import { layerSubtitle, layerTitle, useCompetition, type Competition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { boundsAround, cellsToFeatures, gridFeatures, lostToFeatures, resolutionOf, summarizeCells, type Bounds, type ViewportCell } from '@/territory/h3';
import { useLostCells, useMovement, useReclaimQuote, type LostCell } from '@/features/movement/api';
import { PointsChip, ReclaimDone, ReclaimReceipt, ReclaimSheet, useReclaimFlow } from '@/features/movement/Reclaim';
import { tick } from '@/theme/motion';
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
  const { layers, layer, layerSeason, competition, select, loading } = useCompetition();
  const inEvent = layer?.kind === 'event';
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
  const [reclaiming, setReclaiming] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listOpen, setListOpen] = useState(false);
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

  // Runners' pictures on their land (zoomed in, not while choosing cells to reclaim); nearby ones share a pin.
  const showAvatars = available && zoom >= MIN_AVATAR_ZOOM && !reclaiming;
  const owners = useOwnersInView(available ? bounds : null, zoom, showAvatars);
  const anchors = useMemo(() => ownerAnchors(cells.data ?? []), [cells.data]);
  const pictures = useSignedUrls('avatars', (owners.data ?? []).map((o) => o.avatar_path));
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const pins = useMemo<AvatarPinData[]>(() => {
    if (!showAvatars || !owners.data) return [];
    const placed = owners.data.flatMap((o) => {
      const a = anchors.get(o.owner_key);
      return a ? [{ key: o.owner_key, anchor: a.anchor, weight: a.cells, owner: o }] : [];
    });
    return clusterPins(placed, zoom).map((c) => {
      const lead = c.members[0]!.owner;
      return {
        id: c.id,
        coord: c.anchor,
        uri: lead.avatar_path ? pictures.data?.[lead.avatar_path] ?? null : null,
        name: lead.display_name,
        color: lead.is_me ? tc.mineFill : controllerColor(lead.owner_key, tc.rivalHues),
        mine: lead.is_me,
        count: c.members.length,
        weight: c.members.reduce((sum, m) => sum + m.weight, 0)
      };
    });
  }, [showAvatars, owners.data, anchors, zoom, pictures.data, tc]);
  const ownerCard = ownerKey ? (owners.data ?? []).find((o) => o.owner_key === ownerKey) ?? null : null;

  // Ground I held and lost to another runner (in this layer): in view on the map, the whole layer otherwise.
  // Events never offer reclaiming: their standings are only what runners ran.
  const lost = useLostCells(layer?.id, layerSeason?.id, available ? bounds : 'all', Boolean(layer && layerSeason && !inEvent));
  const movement = useMovement();
  const lostByCell = useMemo(() => new Map((lost.data ?? []).map((c) => [c.cell, c])), [lost.data]);
  const lostFc = useMemo(() => (available && lost.data?.length ? lostToFeatures(lost.data, picked) : undefined), [available, lost.data, picked]);
  const reclaimable = (lost.data ?? []).filter((c) => c.reclaimable).length;
  const quote = useReclaimQuote(picked, lost.data, movement.data?.balance);
  const flow = useReclaimFlow(layer?.id, layerSeason?.id);
  const endReclaim = () => {
    flow.reset();
    setPicked(new Set());
    setReclaiming(false);
  };
  const startReclaim = (first?: string) => {
    if (!available) return setListOpen(true);
    setSelected(null);
    setExpanded(false);
    setPicked(new Set(first ? [first] : []));
    setReclaiming(true);
  };
  const togglePick = (cell: string) => {
    if (!lostByCell.get(cell)?.reclaimable) return;
    const next = new Set(picked);
    if (next.has(cell)) next.delete(cell);
    else next.add(cell);
    tick('light');
    setPicked(next);
  };

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
          layers={{ cells: fc, exclusions: exclusions.data, grid, routes: showRoutes && !reclaiming ? routeFc : undefined, lost: lostFc, avatars: pins }}
          onPressAvatar={(pin) => (pin.count > 1 ? mapRef.current?.flyTo(pin.coord, Math.min(zoom + 2, 18)) : setOwnerKey(pin.id))}
          onIdle={(b, z) => {
            setBounds(b);
            setZoom(z);
          }}
          onPressCell={(cell) => (reclaiming ? togglePick(cell) : setSelected({ kind: 'cell', id: cell }))}
          onPressRoute={(id) => (reclaiming ? undefined : setSelected({ kind: 'route', id }))}
          onPressMap={() => (reclaiming ? undefined : setSelected(null))}
          threeD={threeD}
          animate={!reclaiming}
        />
      )}

      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + spacing.sm }, isWide ? { right: undefined, width: 560 } : null]}>
        <OfflineBanner />
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable
            onPress={() => setSheet('competition')}
            accessibilityRole="button"
            accessibilityLabel={layer ? `Map shows ${layerTitle(layer, layerSeason)}. ${layerSubtitle(layer, layerSeason)}. Change what the map shows` : 'What the map shows'}
            style={({ pressed }) => [styles.chip, { backgroundColor: p.surface, opacity: pressed ? 0.85 : 1 }, t.elevation.floating]}>
            <View style={[styles.chipIcon, { backgroundColor: t.blocks[LAYER_TONE[layer?.kind ?? 'permanent']].bg }]}>
              <Icon name={LAYER_ICON[layer?.kind ?? 'permanent']} color={layer?.kind === 'permanent' || !layer ? '#FFFFFF' : '#121318'} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>{layer ? layerTitle(layer, layerSeason) : loading ? 'Loading the map…' : 'No competition nearby'}</Txt>
              <Txt variant="caption" numberOfLines={1}>{layer ? layerSubtitle(layer, layerSeason) : 'Private runs still record'}</Txt>
            </View>
            <Icon name="chevron-down" color={p.textMuted} size={20} />
          </Pressable>
          {isWide ? <PointsChip balance={movement.data?.balance} loading={movement.isLoading} onPress={() => router.push('/points')} /> : null}
          <IconButton icon="medal" label="Leaderboard" variant="surface" onPress={() => router.push('/leaderboard')} />
        </View>
        {/* On phones the balance gets its own line so the competition name keeps the full width. */}
        {isWide ? null : (
          <View pointerEvents="box-none" style={{ flexDirection: 'row' }}>
            <PointsChip balance={movement.data?.balance} loading={movement.isLoading} onPress={() => router.push('/points')} />
          </View>
        )}
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { top: insets.top + 88 }]}>
        {available ? <IconButton icon="locate" label="Show my location" variant="surface" onPress={() => void recenter()} /> : null}
        <IconButton icon="route" label={showRoutes ? 'Hide speed routes' : 'Show speed routes'} variant="surface" color={showRoutes ? p.primary : p.textSubtle} onPress={() => setShowRoutes(!showRoutes)} />
        {available ? <IconButton icon="hexagon" label={showGrid ? 'Hide the grid' : 'Show the grid'} variant="surface" color={showGrid ? p.primary : p.textSubtle} onPress={() => setShowGrid(!showGrid)} /> : null}
        {available ? <IconButton icon="mountain" label={threeD ? 'Switch to flat map' : 'Switch to 3D map'} variant="surface" color={threeD ? p.primary : p.textSubtle} onPress={() => setThreeD(!threeD)} /> : null}
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
        {reclaiming ? (
          flow.done ? (
            <ReclaimDone result={flow.done} onDone={endReclaim} />
          ) : (
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="headline">Reclaim lost ground</Txt>
                  <Txt variant="caption">{quote.cells.length ? 'Tap more dashed cells, or reclaim these.' : 'Tap the dashed cells you lost to choose them.'}</Txt>
                </View>
                <Button label="Done" size="sm" variant="secondary" onPress={endReclaim} />
              </View>
              <ReclaimReceipt cells={quote.cells.length} costPerCell={quote.costPerCell} total={quote.total} balance={quote.balance} remaining={quote.remaining} />
              {quote.cells.length && quote.remaining < 0 ? <Banner tone="warning" text={`You need ${-quote.remaining} more points: about ${(-quote.remaining * 100).toLocaleString()} m of running.`} /> : null}
              {flow.error ? <Banner tone="danger" text={friendlyError(flow.error)} /> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {quote.cells.length ? <Button label="Clear" variant="ghost" size="lg" onPress={() => setPicked(new Set())} /> : null}
                <Button
                  label={quote.cells.length ? `Reclaim ${quote.cells.length} for ${quote.total} pts` : 'Choose cells'}
                  size="lg"
                  arrow
                  style={{ flex: 1 }}
                  loading={flow.busy}
                  disabled={!quote.affordable || flow.busy}
                  onPress={() => flow.start(quote.cells, quote.total, quote.balance)}
                />
              </View>
            </View>
          )
        ) : selectedCell ? (
          <CellPanel cell={selectedCell} lost={lostByCell.get(selectedCell.cell)} rivalHues={tc.rivalHues} onClose={() => setSelected(null)} onReclaim={() => startReclaim(selectedCell.cell)} />
        ) : selectedRoute ? (
          <RoutePanel route={selectedRoute} onClose={() => setSelected(null)} />
        ) : (
          <>
            <InView summary={summary} loading={cells.isFetching && !cells.data} available={available} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            {lost.data?.length ? (
              <LostCallout count={lost.data.length} reclaimable={reclaimable} cost={lost.data.find((c) => c.reclaimable)?.cost ?? null} balance={movement.data?.balance ?? null} scope={available ? 'in view' : layer?.kind === 'permanent' ? 'so far' : 'this season'} onPress={() => startReclaim()} />
            ) : null}
          </>
        )}
        {expanded && !selected && !reclaiming ? (
          <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            {cells.tooLarge ? <Banner tone="info" text="Zoom in to load territory for this area." /> : null}
            {cells.error ? <Banner tone="danger" text="Territory could not be loaded for this view." action={{ label: 'Retry', onPress: () => void cells.refetch() }} /> : null}
            {inEvent ? <Banner tone="info" text="Event land: only runners in this event, only runs since it started. It never changes the all-time map." action={{ label: 'Standings', onPress: () => router.push({ pathname: '/events/[id]', params: { id: layer!.id } }) }} /> : null}
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
              <Row icon="bolt" title="Movement points" subtitle={movement.data ? `${movement.data.balance.toLocaleString()} points · earned on every verified run` : 'Earned on every verified run'} onPress={() => router.push('/points')} />
              <Row icon="medal" title="Leaderboard" subtitle="Who holds the most land, all-time and this season" onPress={() => router.push('/leaderboard')} />
              <Row icon="flag" title="Events" subtitle="Challenges with their own standings" onPress={() => router.push('/events')} />
              <Row icon="route" title="Speed routes" subtitle="Approved routes and their title holders" onPress={() => router.push('/routes')} />
              <Row icon="compass" title="My exploration" subtitle="Private record of where you have run" onPress={() => router.push('/exploration')} />
            </View>
            <Txt variant="caption">Unmarked ground is unclaimed. Grey areas are unavailable for competition (for example private or restricted land). Land shown is published at least 30 minutes after a run.</Txt>
          </ScrollView>
        ) : null}
        {reclaiming ? null : <Button label="Start a run" size="lg" arrow icon="record" onPress={() => router.push('/record')} />}
      </Animated.View>

      <ReclaimSheet visible={listOpen} onClose={() => setListOpen(false)} competitionId={layer?.id} seasonId={layerSeason?.id} />

      <Sheet visible={Boolean(ownerCard)} title={ownerCard?.is_me ? 'Your land' : 'Runner'} onClose={() => setOwnerKey(null)}>
        {ownerCard ? <OwnerCard owner={ownerCard} picture={ownerCard.avatar_path ? pictures.data?.[ownerCard.avatar_path] ?? null : null} layerName={layer ? layerTitle(layer, layerSeason) : 'this map'} onClose={() => setOwnerKey(null)} /> : null}
      </Sheet>
      <Sheet visible={sheet === 'legend'} title="Map key" onClose={() => setSheet(null)}>
        <Legend />
      </Sheet>
      <Sheet visible={sheet === 'competition'} title="What the map shows" onClose={() => setSheet(null)}>
        {layers.length ? (
          <View>
            {layers.map((c) => (
              <LayerRow
                key={c.id}
                layer={c}
                selected={c.id === layer?.id}
                onPress={() => {
                  select(c.id);
                  setSelected(null);
                  setSheet(null);
                  setReclaiming(false);
                  setPicked(new Set());
                }}
              />
            ))}
          </View>
        ) : (
          <Txt color="textMuted">No competition is available in your area yet. You can still record private runs.</Txt>
        )}
        <Txt variant="caption">Every loop you run for the public race counts on the all-time map, in this season&apos;s race and in territory events you joined. Club races stay inside their club.</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Events" variant="secondary" icon="flag" style={{ flex: 1 }} onPress={() => { setSheet(null); router.push('/events'); }} />
          <Button label="Seasons" variant="secondary" icon="calendar" style={{ flex: 1 }} onPress={() => { setSheet(null); router.push('/seasons'); }} />
        </View>
      </Sheet>
    </View>
  );
}

const LAYER_ICON: Record<Competition['kind'], IconName> = { permanent: 'globe', public: 'trophy', event: 'flag', club: 'clubs' };
const LAYER_TONE: Record<Competition['kind'], 'blue' | 'orange' | 'violet' | 'green'> = { permanent: 'blue', public: 'orange', event: 'violet', club: 'green' };

function LayerRow({ layer, selected, onPress }: { layer: Competition; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const { layerSeason, season } = useCompetition();
  const s = layer.kind === 'public' ? season : selected ? layerSeason : null;
  const title = layerTitle(layer, s);
  const subtitle = layerSubtitle(layer, s);
  return (
    <Row
      icon={LAYER_ICON[layer.kind]}
      title={title}
      subtitle={subtitle}
      right={selected ? <Icon name="check" color={t.palette.primary} size={22} /> : undefined}
      onPress={onPress}
      accessibilityLabel={`${title}. ${subtitle}${selected ? '. Shown now' : ''}`}
    />
  );
}

function Swatch({ color, dashed, size = 26 }: { color: string; dashed?: boolean; size?: number }) {
  return (
    <Svg width={size} height={size * (28 / 26)} style={{ flexShrink: 0 }} viewBox="0 0 26 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polygon points="13,2 24,8 24,20 13,26 2,20 2,8" fill={color} fillOpacity={dashed ? 0.2 : 0.55} stroke={color} strokeWidth={size < 20 ? 2.6 : 2} strokeDasharray={dashed ? '3,2' : undefined} />
    </Svg>
  );
}

/**
 * Who holds the cells around you: a share bar, then one column per state with the count above a short
 * label. Columns are equal thirds and labels never wrap, so "Unavailable" always fits.
 */
function Scoreboard({ summary }: { summary: ReturnType<typeof summarizeCells> }) {
  const t = useTheme();
  const p = t.palette;
  const tc = t.territory;
  const items = [
    { key: 'mine', label: 'Yours', value: summary.mine, color: tc.mineFill, dashed: false },
    { key: 'rivals', label: 'Rivals', value: summary.others, color: tc.rivalHues[0]!, dashed: false },
    { key: 'off', label: 'Unavailable', value: summary.unavailable, color: tc.unavailableFill, dashed: true }
  ];
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const held = summary.mine + summary.others;
  const share = held ? Math.round((summary.mine / held) * 100) : 0;
  return (
    <View style={[styles.board, { backgroundColor: p.surfaceAlt }]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm }}>
        <Txt variant="micro" color="textMuted">Cells around you</Txt>
        <Txt variant="micro" color={held ? 'text' : 'textMuted'} tabular>{held ? `You hold ${share}% of claimed ground` : 'No ground claimed here yet'}</Txt>
      </View>
      <View style={[styles.share, { backgroundColor: p.surfaceSunken }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {total ? items.map((i) => (i.value ? <View key={i.key} style={{ flex: i.value, backgroundColor: i.color, opacity: i.dashed ? 0.4 : 1 }} /> : null)) : null}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {items.map((i, idx) => (
          <View key={i.key} style={[styles.col, idx ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: p.borderStrong, paddingLeft: spacing.md } : null]} accessible accessibilityLabel={`${i.label}: ${i.value} ${i.value === 1 ? 'cell' : 'cells'}`}>
            <Txt variant="metric" tabular numberOfLines={1} style={{ fontSize: 26, lineHeight: 30, color: i.value ? p.text : p.textSubtle }}>{fmtCount(i.value)}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
              <Swatch color={i.color} dashed={i.dashed} size={13} />
              <Txt variant="caption" color="textMuted" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1 }}>{i.label}</Txt>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function InView({ summary, loading, available, expanded, onToggle }: { summary: ReturnType<typeof summarizeCells>; loading: boolean; available: boolean; expanded: boolean; onToggle: () => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline">{available ? 'In view' : 'Around your area'}</Txt>
          <Txt variant="caption">{loading ? 'Loading territory…' : available ? 'Pan and zoom to explore who holds what.' : 'About 2.5 km around your last known start point.'}</Txt>
        </View>
        <Button label={expanded ? 'Less' : 'More'} size="sm" variant="secondary" icon={expanded ? 'chevron-down' : 'chevron-up'} onPress={onToggle} accessibilityLabel={expanded ? 'Show less' : 'Show more about this area'} />
      </View>
      <Scoreboard summary={summary} />
    </View>
  );
}

/** Dashed outline in my colour: ground I held and lost. */
function LostSwatch({ faded, size = 26 }: { faded?: boolean; size?: number }) {
  const t = useTheme();
  return (
    <Svg width={size} height={size * (28 / 26)} style={{ flexShrink: 0, opacity: faded ? 0.5 : 1 }} viewBox="0 0 26 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polygon points="13,2 24,8 24,20 13,26 2,20 2,8" fill={t.territory.rivalHues[0]!} fillOpacity={0.35} stroke={t.territory.mineLine} strokeWidth={2.4} strokeDasharray="3.5,2.5" />
    </Svg>
  );
}

/** "You lost N cells": the way into reclaiming, with the price and my balance up front. */
function LostCallout({ count, reclaimable, cost, balance, scope, onPress }: { count: number; reclaimable: number; cost: number | null; balance: number | null; scope: string; onPress: () => void }) {
  const t = useTheme();
  const p = t.palette;
  const sub = reclaimable && cost
    ? `${reclaimable === count ? 'All' : reclaimable} reclaimable at ${cost} points a cell${balance != null ? ` · you have ${balance.toLocaleString()}` : ''}`
    : 'Taken back with points: only a run can win it back';
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`You lost ${count} ${count === 1 ? 'cell' : 'cells'} ${scope}. ${sub}. Reclaim`}
      style={[styles.callout, { backgroundColor: p.primarySoft }]}>
      <LostSwatch faded={!reclaimable} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>{`You lost ${count} ${count === 1 ? 'cell' : 'cells'} ${scope}`}</Txt>
        <Txt variant="caption" numberOfLines={2}>{sub}</Txt>
      </View>
      <Txt variant="label" style={{ color: p.onPrimarySoft }}>{reclaimable ? 'Reclaim' : 'View'}</Txt>
      <Icon name="chevron-right" color={p.onPrimarySoft} size={18} />
    </PressableScale>
  );
}

const BLOCKED_TEXT: Record<string, string> = {
  taken_with_points: 'Taken back with movement points, so only a run can win it back.',
  season_closed: 'The season is closed, so it can no longer be reclaimed.',
  not_participating: 'Turn on territory in Privacy settings to reclaim it.'
};

function CellPanel({ cell, lost, rivalHues, onClose, onReclaim }: { cell: ViewportCell; lost?: LostCell; rivalHues: readonly string[]; onClose: () => void; onReclaim: () => void }) {
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
      {lost ? (
        <View style={[styles.callout, { backgroundColor: t.palette.primarySoft }]}>
          <LostSwatch faded={!lost.reclaimable} size={22} />
          <Txt variant="label" style={{ flex: 1, color: t.palette.onPrimarySoft }}>
            {lost.reclaimable ? `This was yours until ${fmtDate(lost.lost_on)}. Reclaim it for ${lost.cost} points.` : BLOCKED_TEXT[lost.blocked_reason ?? ''] ?? 'This was yours earlier this season.'}
          </Txt>
        </View>
      ) : (
        <Txt color="textMuted">{body}</Txt>
      )}
      {lost?.reclaimable ? <Button label={`Reclaim for ${lost.cost} points`} size="lg" arrow icon="bolt" onPress={onReclaim} /> : null}
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
    { swatch: <Swatch color={tc.mineFill} />, title: 'Your ground', body: 'Cells you hold on the layer shown (the all-time map unless you pick a race or an event), outlined with a glow.' },
    { swatch: <View style={{ flexDirection: 'row' }}><Swatch color={tc.rivalHues[0]!} /><Swatch color={tc.rivalHues[1]!} /></View>, title: 'Rival ground', body: 'Held by other runners. Each runner keeps one colour so you can tell them apart.' },
    { swatch: <LostSwatch />, title: 'Was yours', body: 'Ground you held that another runner\'s loop took. Tap it to reclaim it with movement points (not in events).' },
    { swatch: <LostSwatch faded />, title: 'Taken back with points', body: 'A runner reclaimed it from you with points. Only a run can win it back.' },
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

/** A runner's card from their picture on the map: who they are and how much of this layer they hold. */
function OwnerCard({ owner, picture, layerName, onClose }: { owner: OwnerInView; picture: string | null; layerName: string; onClose: () => void }) {
  const t = useTheme();
  const units = useUnits();
  const stats = [
    owner.area_m2 != null ? { label: 'Land held', value: fmtArea(owner.area_m2, units), sub: owner.cells != null ? `${fmtCount(owner.cells)} ${owner.cells === 1 ? 'cell' : 'cells'}` : undefined } : null,
    owner.rank != null ? { label: 'Rank', value: `#${owner.rank}`, sub: owner.runners != null ? `of ${fmtCount(owner.runners)}` : undefined } : null,
    { label: 'In view', value: fmtCount(owner.cells_in_view), sub: owner.cells_in_view === 1 ? 'cell' : 'cells' }
  ].filter(Boolean) as { label: string; value: string; sub?: string }[];
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={owner.display_name} uri={picture} size={64} ring={owner.is_me ? true : undefined} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline" numberOfLines={1}>{owner.is_me ? 'You' : owner.display_name}</Txt>
          {owner.handle && !owner.is_me ? <Txt variant="caption">{`@${owner.handle}`}</Txt> : null}
          <Txt variant="caption" numberOfLines={1}>{layerName}</Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {stats.map((st) => (
          <View key={st.label} style={{ flex: 1, padding: spacing.md, borderRadius: radius.lg, backgroundColor: t.palette.surfaceAlt, gap: 2 }} accessible accessibilityLabel={`${st.label}: ${st.value}${st.sub ? ` ${st.sub}` : ''}`}>
            <Txt variant="caption">{st.label}</Txt>
            <Txt variant="headline">{st.value}</Txt>
            {st.sub ? <Txt variant="caption">{st.sub}</Txt> : null}
          </View>
        ))}
      </View>
      {owner.user_id && !owner.is_me ? (
        <Button label="View profile" arrow onPress={() => { onClose(); router.push({ pathname: '/profile/[id]', params: { id: owner.user_id! } }); }} />
      ) : owner.is_me ? (
        <Button label="My land and points" variant="secondary" onPress={() => { onClose(); router.push('/points'); }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  chip: { flex: 1, minHeight: 56, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: 8, paddingRight: spacing.lg },
  chipIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', right: spacing.lg, gap: spacing.sm },
  sheet: { position: 'absolute', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  grabber: { width: 44, height: 5, borderRadius: 3 },
  board: { borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  share: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', gap: 2 },
  col: { flex: 1, minWidth: 0, gap: 2, paddingRight: spacing.sm, alignItems: 'flex-start' },
  callout: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, minHeight: 56 }
});
