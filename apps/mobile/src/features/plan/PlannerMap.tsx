import { useMemo, useRef } from 'react';
import { View } from 'react-native';
import { bboxOf, type LatLng, type PlanState } from '@loopfield/core';
import { cellPolygon } from '@/territory/h3';
import { useTheme } from '@/theme/tokens';
import { mapboxModule } from '@/features/map/MapCanvas';

/**
 * The route builder's map: tap to add a point. Legs that follow paths are drawn solid and straight legs dashed,
 * the start is a filled dot and the end a ringed one; for a loop, the cells inside it are shaded (the land
 * preview). Drawn only where Mapbox exists (installed builds); callers check `mapboxModule()` first.
 */
export function PlannerMap({ plan, previewCells, onTap, center, insets, accessibilityLabel }: {
  plan: PlanState;
  /** H3 cells inside a planned loop, shaded as a preview. */
  previewCells: string[] | null;
  onTap: (p: LatLng) => void;
  /** Where to look first when there is no route yet ([lng, lat]). */
  center: [number, number] | null;
  insets: { top: number; bottom: number };
  accessibilityLabel: string;
}) {
  const Mapbox = mapboxModule()!;
  const t = useTheme();
  const tc = t.territory;
  const camera = useRef<{ fitBounds: (ne: [number, number], sw: [number, number], padding?: number | number[], duration?: number) => void } | null>(null);

  const legs = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plan.legs.map((l, i) => ({ type: 'Feature', id: i, properties: { snapped: l.snapped }, geometry: { type: 'LineString', coordinates: l.path.map((p) => [p.lng, p.lat]) } }))
  }), [plan.legs]);
  const points = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plan.points.map((p, i) => ({ type: 'Feature', id: i, properties: { role: i === 0 ? 'start' : i === plan.points.length - 1 ? 'end' : 'mid' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }))
  }), [plan.points]);
  const cells = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!previewCells?.length) return null;
    return { type: 'FeatureCollection', features: previewCells.map((c) => cellPolygon(c)).filter(Boolean).map((g, i) => ({ type: 'Feature', id: i, properties: {}, geometry: g! })) };
  }, [previewCells]);

  const fitToRoute = () => {
    const all = plan.legs.flatMap((l) => l.path);
    if (all.length < 2) return;
    const b = bboxOf(all);
    camera.current?.fitBounds([b.maxLng, b.maxLat], [b.minLng, b.minLat], [insets.top + 24, 32, insets.bottom + 24, 32], 0);
  };

  const { MapView, Camera, ShapeSource, LineLayer, CircleLayer, FillLayer, LocationPuck } = Mapbox;
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={accessibilityLabel}>
      <MapView
        style={{ flex: 1 }}
        styleURL={t.mapStyleUrl}
        attributionEnabled
        attributionPosition={{ bottom: insets.bottom + 6, right: 8 }}
        logoEnabled
        logoPosition={{ bottom: insets.bottom + 6, left: 8 }}
        scaleBarEnabled={false}
        pitchEnabled={false}
        onPress={(f) => {
          const g = f.geometry as GeoJSON.Point | undefined;
          if (g?.type === 'Point') onTap({ lng: g.coordinates[0]!, lat: g.coordinates[1]! });
        }}
        onDidFinishLoadingMap={fitToRoute}>
        <Camera ref={camera as never} defaultSettings={{ zoomLevel: center ? 14.5 : 12, ...(center ? { centerCoordinate: center } : null) }} followUserLocation={!center && plan.points.length === 0} followZoomLevel={14.5} />
        {cells ? (
          <ShapeSource id="plan-preview" shape={cells}>
            <FillLayer id="plan-preview-fill" style={{ fillColor: tc.path, fillOpacity: 0.16 }} />
          </ShapeSource>
        ) : null}
        <ShapeSource id="plan-legs" shape={legs}>
          <LineLayer id="plan-legs-casing" style={{ lineColor: tc.pathCasing, lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="plan-legs-snapped" filter={['==', ['get', 'snapped'], true]} style={{ lineColor: tc.path, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="plan-legs-straight" filter={['==', ['get', 'snapped'], false]} style={{ lineColor: tc.path, lineWidth: 5, lineDasharray: [1.2, 1], lineCap: 'round' }} />
        </ShapeSource>
        <ShapeSource id="plan-points" shape={points}>
          <CircleLayer id="plan-points-dot" style={{
            circleRadius: ['match', ['get', 'role'], 'mid', 5, 8],
            circleColor: ['match', ['get', 'role'], 'start', tc.start, 'end', '#FFFFFF', tc.path],
            circleStrokeColor: ['match', ['get', 'role'], 'end', tc.path, tc.pathCasing],
            circleStrokeWidth: 3
          }} />
        </ShapeSource>
        <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: false }} />
      </MapView>
    </View>
  );
}
