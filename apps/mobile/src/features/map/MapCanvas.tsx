import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { env } from '@/config/env';
import { isExpoGo } from '@/lib/runtime';
import { Txt } from '@/components/ui';
import { boundsOf, lineFeature, type Bounds } from '@/territory/h3';
import { radius, spacing, usePalette } from '@/theme/tokens';

/**
 * Mapbox renders only (PRD §14): every layer is data the backend already published. The public token
 * is a restricted client token (EXPO_PUBLIC_MAPBOX_TOKEN); download/build tokens never ship in the app.
 * Mapbox attribution and logo remain visible as the terms require; Mapbox telemetry is disabled.
 */
let Mapbox: typeof import('@rnmapbox/maps') | null = null;
let mapboxError: string | null = null;
if (isExpoGo) {
  // Expo Go has no Mapbox code; loading it there fails at render time, so it is never loaded.
  mapboxError = 'Maps are not included in Expo Go, so this map cannot be drawn here. The installed Loopfield app shows it.';
} else {
  try {
    Mapbox = require('@rnmapbox/maps');
    if (env.mapboxToken) {
      void Mapbox!.default.setAccessToken(env.mapboxToken);
      Mapbox!.default.setTelemetryEnabled(false);
    }
  } catch {
    mapboxError = 'The map module is not available in this build.';
  }
}

export interface MapMarker {
  id: string;
  coord: [number, number];
  label: string;
  kind: 'start' | 'finish' | 'checkpoint' | 'cell';
}

export interface MapLayers {
  cells?: GeoJSON.FeatureCollection;
  overlayCells?: GeoJSON.FeatureCollection;
  routes?: GeoJSON.FeatureCollection;
  path?: [number, number][];
  closing?: [number, number][];
  markers?: MapMarker[];
}

export function mapAvailability(): { ok: true } | { ok: false; reason: string } {
  if (mapboxError) return { ok: false, reason: mapboxError };
  if (!env.mapboxToken) return { ok: false, reason: 'Maps are not configured for this build (EXPO_PUBLIC_MAPBOX_TOKEN is missing).' };
  return { ok: true };
}

export function MapCanvas({
  layers,
  fit,
  center,
  zoom = 14,
  showUser = false,
  followUser = false,
  onIdle,
  onPressCell,
  onPressRoute,
  height = 320,
  accessibilityLabel,
  fallback
}: {
  layers: MapLayers;
  fit?: Bounds | null;
  center?: [number, number] | null;
  zoom?: number;
  showUser?: boolean;
  followUser?: boolean;
  onIdle?: (b: Bounds, zoom: number) => void;
  onPressCell?: (cell: string) => void;
  onPressRoute?: (id: string) => void;
  height?: number | `${number}%`;
  accessibilityLabel: string;
  fallback?: ReactNode;
}) {
  const p = usePalette();
  const avail = mapAvailability();
  const pathFc = useMemo(() => (layers.path && layers.path.length > 1 ? { type: 'FeatureCollection' as const, features: [lineFeature(layers.path)] } : null), [layers.path]);
  const closingFc = useMemo(() => (layers.closing && layers.closing.length > 1 ? { type: 'FeatureCollection' as const, features: [lineFeature(layers.closing)] } : null), [layers.closing]);
  const markerFc = useMemo<GeoJSON.FeatureCollection | null>(
    () =>
      layers.markers?.length
        ? { type: 'FeatureCollection', features: layers.markers.map((m) => ({ type: 'Feature', id: m.id, geometry: { type: 'Point', coordinates: m.coord }, properties: { label: m.label, kind: m.kind } })) }
        : null,
    [layers.markers]
  );
  const fitBounds = fit ?? (layers.path?.length ? boundsOf(layers.path) : null);

  if (!avail.ok || !Mapbox) {
    return (
      <View style={{ height, borderRadius: radius.md, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }} accessibilityRole="summary">
        <Txt variant="label">Map unavailable</Txt>
        <Txt variant="caption" style={{ textAlign: 'center' }}>{avail.ok ? 'The map could not be loaded.' : avail.reason}</Txt>
        {fallback}
      </View>
    );
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer, SymbolLayer, UserLocation } = Mapbox;
  return (
    <View style={{ height, borderRadius: radius.md, overflow: 'hidden' }} accessible accessibilityLabel={accessibilityLabel}>
      <MapView
        style={{ flex: 1 }}
        styleURL={env.mapboxStyleUrl}
        attributionEnabled
        logoEnabled
        scaleBarEnabled={false}
        pitchEnabled={false}
        onMapIdle={(s) => {
          if (!onIdle) return;
          const { ne, sw } = s.properties.bounds;
          onIdle({ minLng: sw[0]!, minLat: sw[1]!, maxLng: ne[0]!, maxLat: ne[1]! }, s.properties.zoom);
        }}>
        <Camera
          defaultSettings={center ? { centerCoordinate: center, zoomLevel: zoom } : undefined}
          bounds={fitBounds ? { ne: [fitBounds.maxLng, fitBounds.maxLat], sw: [fitBounds.minLng, fitBounds.minLat], paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 } : undefined}
          followUserLocation={followUser}
          followZoomLevel={followUser ? 16 : undefined}
          animationDuration={0}
        />
        {layers.cells ? (
          <ShapeSource id="cells" shape={layers.cells} onPress={(e) => { const c = e.features[0]?.properties?.cell; if (c && onPressCell) onPressCell(String(c)); }}>
            <FillLayer id="cells-fill" style={{ fillColor: ['get', 'color'], fillOpacity: ['case', ['==', ['get', 'status'], 'excluded'], 0.25, ['get', 'mine'], 0.55, 0.4] }} />
            <LineLayer id="cells-line" style={{ lineColor: ['get', 'color'], lineWidth: ['case', ['get', 'mine'], 1.5, 0.5], lineOpacity: 0.8 }} />
          </ShapeSource>
        ) : null}
        {layers.overlayCells ? (
          <ShapeSource id="overlay" shape={layers.overlayCells}>
            <FillLayer id="overlay-fill" style={{ fillColor: ['get', 'color'], fillOpacity: 0.35 }} />
          </ShapeSource>
        ) : null}
        {layers.routes ? (
          <ShapeSource id="routes" shape={layers.routes} hitbox={{ width: 24, height: 24 }} onPress={(e) => { const id = e.features[0]?.properties?.id; if (id && onPressRoute) onPressRoute(String(id)); }}>
            <LineLayer id="routes-line" style={{ lineColor: ['coalesce', ['get', 'color'], p.title], lineWidth: 4, lineCap: 'round', lineJoin: 'round', lineDasharray: ['case', ['==', ['get', 'status'], 'suspended'], ['literal', [1, 2]], ['literal', [1, 0]]] }} />
          </ShapeSource>
        ) : null}
        {pathFc ? (
          <ShapeSource id="path" shape={pathFc}>
            <LineLayer id="path-line" style={{ lineColor: p.primary, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
          </ShapeSource>
        ) : null}
        {closingFc ? (
          <ShapeSource id="closing" shape={closingFc}>
            <LineLayer id="closing-line" style={{ lineColor: p.accent, lineWidth: 2, lineDasharray: [2, 2] }} />
          </ShapeSource>
        ) : null}
        {markerFc ? (
          <ShapeSource id="markers" shape={markerFc}>
            <CircleLayer id="markers-circle" style={{ circleRadius: 7, circleColor: ['match', ['get', 'kind'], 'start', p.success, 'finish', p.danger, p.info], circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2 }} />
            <SymbolLayer id="markers-label" style={{ textField: ['get', 'label'], textSize: 12, textOffset: [0, 1.4], textColor: p.text, textHaloColor: p.surface, textHaloWidth: 1.5 }} />
          </ShapeSource>
        ) : null}
        {showUser ? <UserLocation visible showsUserHeadingIndicator={false} /> : null}
      </MapView>
    </View>
  );
}
