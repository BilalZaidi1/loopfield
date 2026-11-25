import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { encodePolyline } from '@loopfield/core';
import { env } from '@/config/env';
import { buildSketch, mercator, staticMapUrl, type SketchView } from '@/features/share/sketch';
import { radius, useTheme } from '@/theme/tokens';

/**
 * The live page's map (R1): the visible trail over a street map image, a green dot where the run started and a
 * ringed dot where the runner is now (the trail runs from one to the other, so it needs no arrows). When the runner is near one of their private places, no "now" dot is
 * drawn and the hidden stretch is simply missing from the trail (the server never sends it). Without a public
 * map token the trail is drawn on a plain background.
 */
const NOW_ZOOM = 15.5;
const WORLD_PX = 512;

export function LiveTrail({ trail, last, height = 320, accessibilityLabel }: {
  /** Visible parts of the trail, each a list of [lng, lat]. */
  trail: [number, number][][];
  /** Where the runner is now, or null when hidden or not known. */
  last: { lat: number; lng: number } | null;
  height?: number;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  const tc = t.territory;
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const sketch = useMemo(() => {
    if (!width) return null;
    const route = trail.filter((s) => s.length > 1).map((s) => encodePolyline(s.map(([lng, lat]) => ({ lat, lng }))));
    return buildSketch({ route }, width, height, 28);
  }, [trail, width, height]);

  // A run that has only just started (or a single visible point) is shown around the runner at street level.
  const view = useMemo<SketchView | null>(() => sketch?.view ?? (last ? { lng: last.lng, lat: last.lat, zoom: NOW_ZOOM } : null), [sketch, last]);
  const nowXY = useMemo(() => {
    if (!last || !view || !width) return null;
    const scale = WORLD_PX * 2 ** view.zoom;
    const [cx, cy] = mercator(view.lng, view.lat);
    const [x, y] = mercator(last.lng, last.lat);
    return [width / 2 + (x - cx) * scale, height / 2 + (y - cy) * scale] as const;
  }, [last, view, width, height]);

  const style = t.scheme === 'dark' ? 'mapbox/dark-v11' : 'mapbox/light-v11';
  const mapUrl = view && width ? staticMapUrl(view, Math.min(width, 1280), height, env.mapboxToken, style) : null;
  const bg = t.palette.surfaceAlt;
  return (
    <View onLayout={onLayout} style={{ width: '100%', height, borderRadius: radius.md, overflow: 'hidden', backgroundColor: bg }}
      accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {mapUrl ? <Image source={{ uri: mapUrl }} style={{ position: 'absolute', left: 0, top: 0, width: Math.min(width, 1280), height }} contentFit="fill" /> : null}
      {width && (sketch || nowXY) ? (
        <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
          {sketch?.routes.map((d, i) => <Path key={`k${i}`} d={d} stroke={tc.pathCasing} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {sketch?.routes.map((d, i) => <Path key={`r${i}`} d={d} stroke={tc.path} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {sketch?.start ? <Circle cx={sketch.start[0]} cy={sketch.start[1]} r={6} fill={tc.start} stroke="#FFFFFF" strokeWidth={2.2} /> : null}
          {/* Where they are now; nothing marks the end of the trail when the position is hidden. */}
          {nowXY ? (
            <>
              <Circle cx={nowXY[0]} cy={nowXY[1]} r={16} fill={tc.path} fillOpacity={0.22} />
              <Circle cx={nowXY[0]} cy={nowXY[1]} r={8} fill={tc.path} stroke="#FFFFFF" strokeWidth={3} />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
