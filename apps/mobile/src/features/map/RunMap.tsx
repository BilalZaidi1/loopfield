import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { View } from 'react-native';
import { lineFeature } from '@/territory/h3';
import { useReducedMotion } from '@/theme/motion';
import { useTheme } from '@/theme/tokens';
import { mapboxModule } from './MapCanvas';

/**
 * The recorder's full-screen map, before and during the run, navigation style: the camera follows the runner through
 * Mapbox's own viewport (native and smooth, no JavaScript per frame). Any pan, pinch or rotate hands the
 * camera to the runner ("exploring"); the recenter button, or 15 seconds without touching the map, brings
 * following back. 3D adds perspective, course-up bearing and extruded buildings; terrain stays off while
 * recording to save battery. Drawn only where Mapbox exists (installed builds); callers check
 * `mapboxModule()` first and show a stats-first layout otherwise.
 */
export interface RunMapHandle {
  recenter: () => void;
}

/** Seconds after the last touch before the map follows the runner again on its own. */
export const AUTO_RESUME_MS = 15_000;

export function followPuckState(threeD: boolean, insets: { top: number; bottom: number }) {
  return {
    kind: 'followPuck' as const,
    options: {
      zoom: threeD ? 16.6 : 16,
      pitch: threeD ? 58 : 0,
      bearing: threeD ? ('course' as const) : 0,
      padding: { top: insets.top, bottom: insets.bottom, left: 0, right: 0 }
    }
  };
}

export function RunMap({
  path,
  captureStart,
  closing,
  threeD,
  insets,
  following,
  onFollowingChange,
  accessibilityLabel,
  handle,
  fallbackCenter
}: {
  path: [number, number][];
  /** Where the loop capture started: drawn as a flag, with a dashed hint back to it while the loop is open. */
  captureStart: [number, number] | null;
  closing: boolean;
  threeD: boolean;
  /** Space taken by the floating panels, so the runner stays centred in the open part of the map. */
  insets: { top: number; bottom: number };
  following: boolean;
  onFollowingChange: (following: boolean) => void;
  accessibilityLabel: string;
  handle?: Ref<RunMapHandle>;
  /** Where to look before the phone has a position (location not allowed yet). */
  fallbackCenter?: [number, number] | null;
}) {
  const Mapbox = mapboxModule()!;
  const t = useTheme();
  const tc = t.territory;
  const reduced = useReducedMotion();
  const viewport = useRef<{ transitionTo: (s: unknown, tr?: unknown) => Promise<boolean> } | null>(null);
  const lastTouch = useRef(0);
  const followingRef = useRef(following);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  const recenter = useCallback(() => {
    void viewport.current?.transitionTo(followPuckState(threeD, insets), reduced ? { kind: 'immediate' } : { kind: 'default', maxDurationMs: 900 });
    onFollowingChange(true);
  }, [threeD, insets, reduced, onFollowingChange]);
  useImperativeHandle(handle, () => ({ recenter }), [recenter]);

  // Re-apply the follow camera when 3D or the panel size changes while following.
  useEffect(() => {
    if (followingRef.current) void viewport.current?.transitionTo(followPuckState(threeD, insets), reduced ? { kind: 'immediate' } : { kind: 'default', maxDurationMs: 600 });
  }, [threeD, insets.top, insets.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exploring: resume following once the map has been left alone for a while.
  useEffect(() => {
    if (following) return;
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current > AUTO_RESUME_MS) recenter();
    }, 1000);
    return () => clearInterval(id);
  }, [following, recenter]);

  const pathFc = useMemo(() => (path.length > 1 ? { type: 'FeatureCollection' as const, features: [lineFeature(path)] } : null), [path]);
  const last = path[path.length - 1];
  const hintFc = useMemo(
    () => (closing && captureStart && last ? { type: 'FeatureCollection' as const, features: [lineFeature([last, captureStart])] } : null),
    [closing, captureStart, last]
  );
  const startFc = useMemo<GeoJSON.FeatureCollection | null>(
    () => (captureStart ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: captureStart }, properties: {} }] } : null),
    [captureStart]
  );

  const { MapView, Camera, Viewport, ShapeSource, LineLayer, CircleLayer, FillExtrusionLayer, LocationPuck, SkyLayer } = Mapbox;
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={accessibilityLabel}>
      <MapView
        style={{ flex: 1 }}
        styleURL={t.mapStyleUrl}
        attributionEnabled
        attributionPosition={{ bottom: insets.bottom + 6, right: 8 }}
        logoEnabled
        logoPosition={{ bottom: insets.bottom + 6, left: 8 }}
        compassEnabled
        compassPosition={{ top: insets.top + 8, left: 12 }}
        scaleBarEnabled={false}
        pitchEnabled
        rotateEnabled
        onCameraChanged={(s) => {
          if (s.gestures.isGestureActive || !followingRef.current) lastTouch.current = Date.now();
        }}
        onDidFinishLoadingMap={() => {
          void viewport.current?.transitionTo(followPuckState(threeD, insets), { kind: 'immediate' });
          onFollowingChange(true);
        }}>
        <Camera defaultSettings={{ zoomLevel: fallbackCenter ? 12 : 16, pitch: threeD ? 58 : 0, ...(fallbackCenter ? { centerCoordinate: fallbackCenter } : null) }} />
        <Viewport
          ref={viewport as never}
          onStatusChanged={(e) => {
            if (e.to.kind === 'idle' && e.reason === 'UserInteraction') {
              lastTouch.current = Date.now();
              onFollowingChange(false);
            }
          }}
        />
        {threeD ? (
          <>
            <SkyLayer id="sky" style={{ skyType: 'atmosphere', skyAtmosphereSun: [0, 0], skyAtmosphereSunIntensity: 12 }} />
            <FillExtrusionLayer
              id="buildings-3d"
              sourceID="composite"
              sourceLayerID="building"
              minZoomLevel={14.5}
              maxZoomLevel={22}
              filter={['==', ['get', 'extrude'], 'true']}
              style={{
                fillExtrusionColor: tc.building,
                fillExtrusionOpacity: tc.buildingOpacity,
                fillExtrusionHeight: ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.2, ['get', 'height']],
                fillExtrusionBase: ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.2, ['get', 'min_height']]
              }}
            />
          </>
        ) : null}
        {pathFc ? (
          <ShapeSource id="run-path" shape={pathFc} lineMetrics>
            <LineLayer id="run-path-casing" style={{ lineColor: tc.pathCasing, lineWidth: 10, lineCap: 'round', lineJoin: 'round' }} />
            <LineLayer
              id="run-path-line"
              style={{ lineWidth: 6, lineCap: 'round', lineJoin: 'round', lineGradient: ['interpolate', ['linear'], ['line-progress'], 0, tc.pathStart, 1, tc.path] }}
            />
          </ShapeSource>
        ) : null}
        {hintFc ? (
          <ShapeSource id="run-closing" shape={hintFc}>
            <LineLayer id="run-closing-line" style={{ lineColor: tc.closing, lineWidth: 3, lineDasharray: [1.5, 1.5], lineCap: 'round' }} />
          </ShapeSource>
        ) : null}
        {startFc ? (
          <ShapeSource id="run-capture-start" shape={startFc}>
            <CircleLayer id="run-capture-start-dot" style={{ circleRadius: 8, circleColor: tc.start, circleStrokeColor: tc.pathCasing, circleStrokeWidth: 3, circlePitchAlignment: 'map' }} />
          </ShapeSource>
        ) : null}
        <LocationPuck puckBearingEnabled={threeD} puckBearing="course" pulsing={{ isEnabled: !reduced, color: tc.path, radius: 'accuracy' }} />
      </MapView>
    </View>
  );
}
