import { useImperativeHandle, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { env } from '@/config/env';
import { isExpoGo } from '@/lib/runtime';
import { Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { boundsOf, lineFeature, type Bounds } from '@/territory/h3';
import { radius, spacing, useTheme } from '@/theme/tokens';

/**
 * Mapbox renders only (PRD §14): every layer is data the backend already published. The public token
 * is a restricted client token (EXPO_PUBLIC_MAPBOX_TOKEN); download/build tokens never ship in the app.
 * Mapbox attribution and logo remain visible as the terms require; Mapbox telemetry is disabled.
 */
let Mapbox: typeof import('@rnmapbox/maps') | null = null;
let mapboxError: string | null = null;
if (Platform.OS === 'web') {
  // The browser version does not bundle the Mapbox SDK (metro.config.js); maps are a phone-app feature.
  mapboxError = 'Maps are not available in the browser version. The Loopfield phone app shows this map.';
} else if (isExpoGo) {
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
  /** Published territory cells (properties: cell, status, mine, color). */
  cells?: GeoJSON.FeatureCollection;
  /** Unavailable areas (exclusions) drawn grey with a dashed edge. */
  exclusions?: GeoJSON.FeatureCollection;
  /** Private overlays such as your exploration cells (properties.color). */
  overlayCells?: GeoJSON.FeatureCollection;
  /** Faint outline of the ownership grid (visual only). */
  grid?: GeoJSON.FeatureCollection | null;
  routes?: GeoJSON.FeatureCollection;
  path?: [number, number][];
  closing?: [number, number][];
  markers?: MapMarker[];
}

export interface MapHandle {
  flyTo: (coord: [number, number], zoom?: number) => void;
}

export function mapAvailability(): { ok: true } | { ok: false; reason: string } {
  if (mapboxError) return { ok: false, reason: mapboxError };
  if (!env.mapboxToken) return { ok: false, reason: 'Maps are not configured for this build (EXPO_PUBLIC_MAPBOX_TOKEN is missing).' };
  return { ok: true };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The part of the Mapbox camera handle this screen uses. */
interface CameraHandle {
  setCamera: (config: { centerCoordinate: [number, number]; zoomLevel: number; animationDuration: number; animationMode: 'flyTo' }) => void;
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
  onPressMap,
  selectedCell,
  height = 320,
  fill = false,
  ornamentBottom = 8,
  accessibilityLabel,
  fallback,
  mapRef
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
  /** Tap on the map outside any feature (used to clear a selection). */
  onPressMap?: () => void;
  selectedCell?: string | null;
  height?: number | `${number}%`;
  /** Fill the parent edge to edge (the Map tab) instead of a rounded card. */
  fill?: boolean;
  /** Distance of the Mapbox logo and attribution from the bottom, kept clear of overlays. */
  ornamentBottom?: number;
  accessibilityLabel: string;
  fallback?: ReactNode;
  mapRef?: Ref<MapHandle>;
}) {
  const t = useTheme();
  const tc = t.territory;
  const avail = mapAvailability();
  const camera = useRef<CameraHandle>(null);
  const featureTap = useRef(0);
  useImperativeHandle(mapRef, () => ({
    flyTo: (coord, z) => camera.current?.setCamera({ centerCoordinate: coord, zoomLevel: z ?? 15, animationDuration: 700, animationMode: 'flyTo' })
  }), []);
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
  const frame = fill ? { flex: 1 } : { height, borderRadius: radius.lg, overflow: 'hidden' as const };

  if (!avail.ok || !Mapbox) {
    return (
      <View style={[frame, { backgroundColor: t.scheme === 'dark' ? '#17181C' : '#E9ECF2', overflow: 'hidden' }]} accessibilityRole="summary">
        <BoardPattern />
        <View style={[styles.fallbackCard, { backgroundColor: t.palette.surface }, t.elevation.raised, fill ? { marginTop: '42%', marginHorizontal: 76 } : null]}>
          <Icon name="map" color={t.palette.primary} size={26} />
          <Txt variant="heading" align="center">Map not shown here</Txt>
          <Txt variant="caption" align="center">{avail.ok ? 'The map could not be loaded.' : avail.reason}</Txt>
          {fallback}
        </View>
      </View>
    );
  }
  const { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer, SymbolLayer, LocationPuck } = Mapbox;
  const onFeature = () => {
    featureTap.current = Date.now();
  };
  return (
    <View style={frame} accessible accessibilityLabel={accessibilityLabel}>
      <MapView
        style={{ flex: 1 }}
        styleURL={t.mapStyleUrl}
        attributionEnabled
        attributionPosition={{ bottom: ornamentBottom, right: 8 }}
        logoEnabled
        logoPosition={{ bottom: ornamentBottom, left: 8 }}
        compassEnabled
        compassPosition={{ top: fill ? 120 : 8, right: 12 }}
        scaleBarEnabled={false}
        pitchEnabled={false}
        onPress={() => {
          if (Date.now() - featureTap.current > 300) onPressMap?.();
        }}
        onMapIdle={(s) => {
          if (!onIdle) return;
          const { ne, sw } = s.properties.bounds;
          onIdle({ minLng: sw[0]!, minLat: sw[1]!, maxLng: ne[0]!, maxLat: ne[1]! }, s.properties.zoom);
        }}>
        <Camera
          ref={camera as never}
          defaultSettings={center ? { centerCoordinate: center, zoomLevel: zoom } : undefined}
          bounds={fitBounds ? { ne: [fitBounds.maxLng, fitBounds.maxLat], sw: [fitBounds.minLng, fitBounds.minLat], paddingTop: 48, paddingBottom: 48, paddingLeft: 40, paddingRight: 40 } : undefined}
          followUserLocation={followUser}
          followZoomLevel={followUser ? 16 : undefined}
          animationDuration={0}
        />
        {layers.grid ? (
          <ShapeSource id="grid" shape={layers.grid}>
            <LineLayer id="grid-line" minZoomLevel={14.5} style={{ lineColor: tc.grid, lineWidth: 0.8 }} />
          </ShapeSource>
        ) : null}
        {layers.exclusions ? (
          <ShapeSource id="exclusions" shape={layers.exclusions}>
            <FillLayer id="exclusions-fill" style={{ fillColor: tc.unavailableFill, fillOpacity: 0.2 }} />
            <LineLayer id="exclusions-line" style={{ lineColor: tc.unavailableLine, lineWidth: 1.5, lineDasharray: [2, 2] }} />
          </ShapeSource>
        ) : null}
        {layers.overlayCells ? (
          <ShapeSource id="overlay" shape={layers.overlayCells}>
            <FillLayer id="overlay-fill" style={{ fillColor: ['get', 'color'], fillOpacity: 0.32 }} />
            <LineLayer id="overlay-line" style={{ lineColor: ['get', 'color'], lineWidth: 0.8, lineOpacity: 0.6 }} />
          </ShapeSource>
        ) : null}
        {layers.cells ? (
          <ShapeSource
            id="cells"
            shape={layers.cells}
            onPress={(e) => {
              onFeature();
              const c = e.features[0]?.properties?.cell;
              if (c && onPressCell) onPressCell(String(c));
            }}>
            <FillLayer id="cells-fill" style={{ fillColor: ['get', 'color'], fillOpacity: ['case', ['==', ['get', 'status'], 'excluded'], 0.2, ['==', ['get', 'mine'], true], 0.5, tc.rivalOpacity] }} />
            <LineLayer id="cells-glow" filter={['==', ['get', 'mine'], true]} style={{ lineColor: tc.mineGlow, lineWidth: 6, lineBlur: 3 }} />
            <LineLayer id="cells-line" filter={['!=', ['get', 'status'], 'excluded']} style={{ lineColor: ['case', ['==', ['get', 'mine'], true], tc.mineLine, ['get', 'color']], lineWidth: ['case', ['==', ['get', 'mine'], true], 2, 1], lineOpacity: 0.95 }} />
            <LineLayer id="cells-excluded-line" filter={['==', ['get', 'status'], 'excluded']} style={{ lineColor: tc.unavailableLine, lineWidth: 1.2, lineDasharray: [2, 2] }} />
            <LineLayer id="cells-selected-casing" filter={['==', ['get', 'cell'], selectedCell ?? '']} style={{ lineColor: tc.selectedCasing, lineWidth: 7 }} />
            <LineLayer id="cells-selected" filter={['==', ['get', 'cell'], selectedCell ?? '']} style={{ lineColor: tc.selectedLine, lineWidth: 3 }} />
          </ShapeSource>
        ) : null}
        <ShapeSource
          id="routes"
          shape={layers.routes ?? EMPTY}
          hitbox={{ width: 24, height: 24 }}
          onPress={(e) => {
            onFeature();
            const id = e.features[0]?.properties?.id;
            if (id && onPressRoute) onPressRoute(String(id));
          }}>
          <LineLayer id="routes-casing" filter={['!=', ['get', 'status'], 'suspended']} style={{ lineColor: tc.routeCasing, lineWidth: 8.5, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="routes-line" filter={['!=', ['get', 'status'], 'suspended']} style={{ lineColor: ['case', ['==', ['get', 'mine'], true], tc.routeMine, tc.route], lineWidth: 4.5, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="routes-suspended" filter={['==', ['get', 'status'], 'suspended']} style={{ lineColor: tc.routeSuspended, lineWidth: 3.5, lineDasharray: [1, 2], lineCap: 'round' }} />
        </ShapeSource>
        {pathFc ? (
          <ShapeSource id="path" shape={pathFc}>
            <LineLayer id="path-casing" style={{ lineColor: tc.pathCasing, lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
            <LineLayer id="path-line" style={{ lineColor: tc.path, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }} />
          </ShapeSource>
        ) : null}
        {closingFc ? (
          <ShapeSource id="closing" shape={closingFc}>
            <LineLayer id="closing-line" style={{ lineColor: tc.closing, lineWidth: 3, lineDasharray: [1.5, 1.5], lineCap: 'round' }} />
          </ShapeSource>
        ) : null}
        {markerFc ? (
          <ShapeSource id="markers" shape={markerFc}>
            <CircleLayer id="markers-circle" style={{ circleRadius: 8, circleColor: ['match', ['get', 'kind'], 'start', tc.start, 'finish', tc.finish, tc.checkpoint], circleStrokeColor: tc.pathCasing, circleStrokeWidth: 3 }} />
            <SymbolLayer id="markers-label" style={{ textField: ['get', 'label'], textSize: 12, textOffset: [0, 1.5], textColor: tc.label, textHaloColor: tc.labelHalo, textHaloWidth: 1.5 }} />
          </ShapeSource>
        ) : null}
        {showUser ? <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: true, color: tc.path, radius: 'accuracy' }} /> : null}
      </MapView>
    </View>
  );
}

/** Decorative hex texture behind the "map not shown" message. */
function BoardPattern() {
  const t = useTheme();
  const r = 22;
  const w = Math.sqrt(3) * r;
  const cells: string[] = [];
  for (let row = 0; row < 26; row++)
    for (let col = 0; col < 14; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * r * 1.5;
      cells.push(
        Array.from({ length: 6 }, (_, i) => {
          const a = ((60 * i - 30) * Math.PI) / 180;
          return `${(cx + (r - 1) * Math.cos(a)).toFixed(1)},${(cy + (r - 1) * Math.sin(a)).toFixed(1)}`;
        }).join(' ')
      );
    }
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 520 820" preserveAspectRatio="xMidYMid slice" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cells.map((pts, i) => (
        <Polygon key={i} points={pts} fill="none" stroke={t.territory.grid} strokeWidth={1.2} />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  fallbackCard: { alignSelf: 'center', marginTop: spacing.xl, marginHorizontal: spacing.xl, maxWidth: 340, padding: spacing.xl, borderRadius: radius.lg, alignItems: 'center', gap: spacing.sm }
});
