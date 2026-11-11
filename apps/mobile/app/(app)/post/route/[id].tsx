import { useMemo } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { decodePolyline } from '@loopfield/core';
import { EmptyState, ErrorState, LoadingState, Screen, Txt } from '@/components/ui';
import { MapCanvas, mapAvailability, type MapMarker } from '@/features/map/MapCanvas';
import { landLine, RouteSketch } from '@/features/share/RouteSketch';
import type { PostJson } from '@/features/social/PostCard';
import { rpc } from '@/lib/api';
import { fmtArea } from '@/lib/format';
import { useUnits } from '@/state/session';
import { cellPolygon } from '@/territory/h3';
import { controllerColor, spacing, useTheme } from '@/theme/tokens';

/**
 * A shared run on the map: zoom and pan the route (start and finish at its visible ends; the first and
 * last 200 m and the runner's private areas are never shown), the cells the run holds and, edged in
 * orange, the ones it took from other runners. Tap a cell for its details.
 */
export default function SharedRunMap() {
  const t = useTheme();
  const tc = t.territory;
  const units = useUnits();
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = useQuery({ queryKey: ['post', id], queryFn: () => rpc<PostJson | null>('post_detail', { p_post: id }) });
  const p = post.data;
  const sharedRoute = p?.shared_route ?? null;
  const land = p?.shared_land ?? null;
  const mine = Boolean(p?.is_mine);
  const authorId = p?.author.id ?? 'runner';
  const orange = t.palette.orange;
  const parts = useMemo(() => (sharedRoute ?? []).map((r) => decodePolyline(r).map((x) => [x.lng, x.lat] as [number, number])), [sharedRoute]);
  const cells = useMemo<GeoJSON.FeatureCollection | undefined>(() => {
    if (!land?.cells.length) return undefined;
    const taken = new Set(land.taken);
    const own = mine ? tc.mineFill : controllerColor(authorId, tc.rivalHues);
    const features: GeoJSON.Feature[] = [];
    for (const cell of land.cells) {
      const geometry = cellPolygon(cell);
      if (geometry) features.push({ type: 'Feature', id: cell, geometry, properties: { cell, color: taken.has(cell) ? orange : own, mine, status: 'controlled' } });
    }
    return { type: 'FeatureCollection', features };
  }, [land, mine, authorId, tc, orange]);
  const markers = useMemo<MapMarker[]>(() => {
    const first = parts[0]?.[0];
    const lastPart = parts[parts.length - 1];
    const last = lastPart?.[lastPart.length - 1];
    return [
      ...(first ? [{ id: 'start', coord: first, label: 'Start', kind: 'start' as const }] : []),
      ...(last ? [{ id: 'finish', coord: last, label: 'Finish', kind: 'finish' as const }] : [])
    ];
  }, [parts]);

  if (post.isLoading) return <Screen><Stack.Screen options={{ title: 'Run map' }} /><LoadingState variant="cards" /></Screen>;
  if (post.error) return <Screen><Stack.Screen options={{ title: 'Run map' }} /><ErrorState error={post.error} onRetry={() => void post.refetch()} /></Screen>;
  if (!p || (!parts.length && !land)) return <Screen><Stack.Screen options={{ title: 'Run map' }} /><EmptyState icon="route" title="No map for this run" body="The runner did not share a route or land, or the result is no longer valid." /></Screen>;

  const line = landLine(land);
  const legend = (
    <View style={{ gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <Txt variant="bodyStrong">{`${p.author.display_name}${p.shared_summary?.activity_date ? ` · ${p.shared_summary.activity_date}` : ''}`}</Txt>
      {line ? <Txt variant="label">{`${line}${land?.area_m2 ? ` · ${fmtArea(land.area_m2, units)}` : ''}`}</Txt> : null}
      <Txt variant="caption">Green dot: start · black dot: finish. The first and last 200 m and the runner&apos;s private areas are never shown. Orange-edged cells were taken from other runners.</Txt>
    </View>
  );
  if (!mapAvailability().ok) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Run map' }} />
        <RouteSketch input={{ route: p.shared_route, cells: land?.cells, taken: land?.taken }} height={420} />
        {legend}
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <Stack.Screen options={{ title: 'Run map' }} />
      <MapCanvas
        fill
        accessibilityLabel={`Map of ${p.author.display_name}'s shared run${line ? `. ${line}` : ''}`}
        layers={{ pathParts: parts, markers, cells }}
        onPressCell={(cell) => router.push({ pathname: '/territory/[cell]', params: { cell } })}
      />
      <View style={{ backgroundColor: t.palette.surface }}>{legend}</View>
    </View>
  );
}
