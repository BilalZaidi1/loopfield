import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import { radius, useTheme } from '@/theme/tokens';
import { buildSketch, type Sketch, type SketchInput } from './sketch';

/**
 * A light route sketch for cards and share images: the shared route with a direction arrow every so
 * often, start and finish dots at its visible ends, the land the run holds and, edged, the cells it took
 * from other runners. The sketch itself fetches nothing; share images can put a street map under it.
 */
/** Fixed colours (share images look the same whatever the app theme). */
export interface SketchColors {
  dots: string;
  cell: string;
  cellLine: string;
  takenLine: string;
  path: string;
  casing: string;
  start: string;
  finish: string;
}

export function RouteSketch({
  input,
  height = 180,
  width: fixedWidth,
  rounded = true,
  background,
  colors,
  accessibilityLabel,
  sketch: given,
  overMap = false
}: {
  input: SketchInput;
  height?: number;
  /** Fixed width (share images); otherwise the sketch fills its container. */
  width?: number;
  rounded?: boolean;
  background?: string;
  colors?: SketchColors;
  accessibilityLabel?: string;
  /** Already projected (share images, where a street map underneath uses the same projection). */
  sketch?: Sketch | null;
  /** Drawn over a street map: no background and no dot grid. */
  overMap?: boolean;
}) {
  const t = useTheme();
  const p = t.palette;
  const c: SketchColors = colors ?? {
    dots: p.textSubtle, cell: t.territory.mineFill, cellLine: t.territory.mineLine, takenLine: p.orange,
    path: t.territory.path, casing: t.territory.pathCasing, start: t.territory.start, finish: t.territory.finish
  };
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;
  const computed = useMemo(() => (given === undefined && width ? buildSketch(input, width, height, 18) : null), [given, input, width, height]);
  const sketch = given === undefined ? computed : given;
  const onLayout = (e: LayoutChangeEvent) => {
    if (!fixedWidth) setMeasured(Math.round(e.nativeEvent.layout.width));
  };
  const bg = background ?? p.surfaceAlt;
  return (
    <View onLayout={onLayout} style={{ width: fixedWidth ?? '100%', height, borderRadius: rounded ? radius.md : 0, overflow: 'hidden', backgroundColor: overMap ? 'transparent' : bg }}
      accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? 'Route of the run, with start, finish and the land it holds'}>
      {sketch && width ? (
        <Svg width={width} height={height}>
          {overMap ? null : (
            <>
              <Rect x={0} y={0} width={width} height={height} fill={bg} />
              {/* Without a map, a faint dot grid gives the sketch a sense of scale. */}
              <G opacity={0.35}>
                {Array.from({ length: Math.ceil(width / 24) * Math.ceil(height / 24) }, (_, i) => {
                  const cols = Math.ceil(width / 24);
                  return <Circle key={i} cx={12 + (i % cols) * 24} cy={12 + Math.floor(i / cols) * 24} r={0.9} fill={p.textSubtle} />;
                })}
              </G>
            </>
          )}
          {sketch.cells.map((pts, i) => <Polygon key={`c${i}`} points={pts} fill={c.cell} fillOpacity={0.32} stroke={c.cellLine} strokeOpacity={0.5} strokeWidth={0.6} />)}
          {sketch.taken.map((pts, i) => <Polygon key={`t${i}`} points={pts} fill={c.cell} fillOpacity={0.55} stroke={c.takenLine} strokeWidth={1.2} />)}
          {sketch.routes.map((d, i) => <Path key={`k${i}`} d={d} stroke={c.casing} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {sketch.routes.map((d, i) => <Path key={`r${i}`} d={d} stroke={c.path} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {sketch.arrows.map((a, i) => (
            <Path key={`a${i}`} d="M -3.5 -3.2 L 1.5 0 L -3.5 3.2" transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`} stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          {sketch.start ? <Circle cx={sketch.start[0]} cy={sketch.start[1]} r={6} fill={c.start} stroke="#FFFFFF" strokeWidth={2.2} /> : null}
          {sketch.finish ? <Circle cx={sketch.finish[0]} cy={sketch.finish[1]} r={6} fill={c.finish} stroke="#FFFFFF" strokeWidth={2.2} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** "Took 20 cells · 10 from 2 runners" for a card's land line. */
export function landLine(land: { cell_count?: number | null; gained_cells?: number; kept_cells?: number; taken_cells?: number; rivals?: number } | null | undefined): string | null {
  if (!land) return null;
  const gained = land.gained_cells ?? 0;
  const kept = land.kept_cells ?? 0;
  const taken = land.taken_cells ?? 0;
  if (!gained && kept) return `Defended ${kept} ${kept === 1 ? 'cell' : 'cells'}`;
  const total = gained || land.cell_count || 0;
  if (!total) return null;
  const from = taken ? ` · ${taken} from ${land.rivals ?? 1} ${land.rivals === 1 ? 'runner' : 'runners'}` : '';
  return `Captured ${total} ${total === 1 ? 'cell' : 'cells'}${from}`;
}
