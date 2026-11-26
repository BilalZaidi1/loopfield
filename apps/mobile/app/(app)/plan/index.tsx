import { useMemo, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TERRITORY_RULES, bboxOf, estimateSeconds, planProblem, usualPace, type PlanState } from '@loopfield/core';
import { friendlyError } from '@/lib/api';
import { PAUSED_TEXT, useAppConfig } from '@/lib/appConfig';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { Badge, Banner, Button, EmptyState, IconButton, LoadingState, Screen, Sheet, TextField, Txt } from '@/components/ui';
import { mapAvailability } from '@/features/map/MapCanvas';
import { useInitialCenter } from '@/features/map/useInitialCenter';
import { useTerritoryViewport } from '@/features/map/useMapData';
import { routeLine, savePlannedRoute, usePlannedRoute } from '@/features/plan/api';
import { loopCells, previewLand, previewText } from '@/features/plan/landPreview';
import { PlannerMap } from '@/features/plan/PlannerMap';
import { planFromLine, usePlanner } from '@/features/plan/usePlanner';
import { useActivities } from '@/features/results/useActivities';
import { useUnits } from '@/state/session';
import { resolutionOf } from '@/territory/h3';
import { spacing, usePalette, useTheme } from '@/theme/tokens';

/**
 * The route builder (R1): tap the map to plan a route, with legs that follow streets and paths, then save it
 * under Planned routes. Opened with `?id=` it edits a saved route. Planned routes are private to the runner.
 */
export default function PlanRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const saved = usePlannedRoute(id);
  if (!mapAvailability().ok) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Plan a route' }} />
        <EmptyState icon="route" title="Planning routes needs the phone app" body="The Loopfield phone app shows the map you plan on. Your planned routes appear here once saved." />
      </Screen>
    );
  }
  if (id && saved.isLoading) return <Screen><LoadingState variant="cards" /></Screen>;
  const initial: PlanState | undefined = saved.data ? planFromLine(routeLine(saved.data), saved.data.snapped) : undefined;
  return <Planner key={saved.data?.id ?? 'new'} id={saved.data?.id ?? null} initialName={saved.data?.name ?? ''} initial={initial} />;
}

function Planner({ id, initialName, initial }: { id: string | null; initialName: string; initial?: PlanState }) {
  const t = useTheme();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const { settings } = useAppConfig();
  const builderOn = settings.enabled.route_builder_enabled;
  const planner = usePlanner(initial, settings.enabled.route_snapping_enabled);
  const center = useInitialCenter();
  const runs = useActivities(90);
  const pace = useMemo(() => usualPace((runs.data ?? []).slice(0, 10).map((r) => r.avg_pace_s_per_km)), [runs.data]);
  const [panelH, setPanelH] = useState(260);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Land preview for loops: the cells inside it, against what the map shows there now.
  const bounds = useMemo(() => {
    if (!planner.loop) return null;
    const b = bboxOf(planner.path);
    return { minLng: b.minLng, minLat: b.minLat, maxLng: b.maxLng, maxLat: b.maxLat };
  }, [planner.loop, planner.path]);
  const viewport = useTerritoryViewport(bounds);
  const resolution = resolutionOf(viewport.data ?? [], TERRITORY_RULES.gridResolution.value);
  const cells = useMemo(() => (planner.loop ? loopCells(planner.path, resolution) : null), [planner.loop, planner.path, resolution]);
  const preview = cells && viewport.data ? previewLand(cells, viewport.data) : null;

  const problem = planProblem(name || 'x', planner.path);
  const save = async () => {
    const issue = planProblem(name, planner.path);
    if (issue) {
      setError(issue === 'name_missing' ? 'Give the route a name.' : issue === 'name_too_long' ? 'Names are up to 60 characters.' : issue === 'too_short' ? 'A route needs at least 50 m.' : issue === 'too_long' ? 'A route can be up to 200 km.' : 'This route has too many points.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await savePlannedRoute({ id, name, path: planner.path, snapped: planner.snapped });
      setNaming(false);
      router.replace({ pathname: '/plans', params: { saved: r.id } });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const est = estimateSeconds(planner.distanceM, pace);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ title: id ? 'Edit route' : 'Plan a route' }} />
      <PlannerMap
        plan={planner.plan}
        previewCells={cells}
        onTap={(pt) => (builderOn ? void planner.addPoint(pt) : undefined)}
        center={planner.plan.points.length ? null : center ?? null}
        insets={{ top: spacing.md, bottom: panelH + insets.bottom + spacing.md }}
        accessibilityLabel={`Map for planning a route. ${planner.plan.points.length} points so far. Tap the map to add a point.`}
      />
      <View onLayout={(e) => setPanelH(Math.round(e.nativeEvent.layout.height))}
        style={{ position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: insets.bottom + spacing.sm, backgroundColor: p.surface, borderRadius: 20, padding: spacing.md, gap: spacing.sm, ...t.elevation.floating }}>
        {!builderOn ? <Banner tone="info" text={PAUSED_TEXT.route_builder_enabled} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Txt variant="headline">{planner.distanceM ? fmtDistance(planner.distanceM, units) : 'Tap the map to start'}</Txt>
            <Txt variant="caption">{planner.distanceM ? `About ${fmtDuration(est * 1000)} at your usual pace` : 'Each tap adds a point; the line follows paths between them.'}</Txt>
          </View>
          {planner.loop ? <Badge label="Loop" tone="success" /> : null}
          {planner.busy ? <Txt variant="caption">Finding the path…</Txt> : null}
        </View>
        {planner.note ? <Banner tone="info" text={planner.note} /> : null}
        {preview ? <Txt variant="caption">{previewText(preview)}</Txt> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, alignItems: 'center' }}>
          <IconButton icon="arrow-left" label="Undo" onPress={planner.undo} variant="soft" disabled={!planner.canUndo} />
          <IconButton icon="trash" label="Clear the route" onPress={planner.clear} variant="soft" disabled={!planner.plan.points.length} />
          <IconButton icon="refresh" label="Reverse the direction" onPress={planner.reverse} variant="soft" disabled={planner.plan.points.length < 2} />
          <Button size="sm" variant="secondary" label="Close the loop" onPress={() => void planner.closeLoop()} disabled={!planner.canClose || planner.busy || !builderOn} />
          <Button size="sm" variant="secondary" label="Out and back" onPress={planner.outAndBack} disabled={planner.plan.points.length < 2 || planner.loop || !builderOn} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs }}>
            <Txt variant="label">Follow paths</Txt>
            <Switch value={planner.followPaths && settings.enabled.route_snapping_enabled} disabled={!settings.enabled.route_snapping_enabled}
              onValueChange={planner.setFollowPaths} accessibilityLabel="Follow paths between points" trackColor={{ true: p.primaryFill, false: p.borderStrong }} thumbColor="#FFFFFF" />
          </View>
        </ScrollView>
        <Button label={id ? 'Save changes' : 'Save route'} icon="check" onPress={() => { setError(null); setNaming(true); }}
          disabled={!builderOn || planner.busy || (problem !== null && problem !== 'name_missing')} />
      </View>
      <Sheet visible={naming} onClose={() => { setNaming(false); setError(null); }} title={id ? 'Save changes' : 'Name this route'}>
        <View style={{ gap: spacing.md }}>
          <TextField label="Route name" value={name} onChangeText={(v) => setName(v.slice(0, 60))} placeholder="For example River loop" autoCapitalize="sentences" />
          <Txt variant="caption">Only you can see your planned routes.</Txt>
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button label="Save" onPress={() => void save()} loading={busy} disabled={busy} />
        </View>
      </Sheet>
    </View>
  );
}
