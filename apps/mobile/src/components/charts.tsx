import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';
import { Icon } from './icons';
import { Txt, useBlock } from './ui';

export interface ChartPoint {
  label: string;
  /** null = no readable data (drawn as a gap marker, never as zero). */
  value: number | null;
}

/** Bars grow up from the baseline once, when the chart first appears. */
function useGrow() {
  const reduce = useReducedMotion();
  const g = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) g.value = withTiming(1, { duration: 650 });
  }, [reduce, g]);
  return useAnimatedStyle(() => ({ transform: [{ scaleY: g.value }] }));
}

/**
 * Accessible bar chart: missing values are drawn as hollow markers labelled "no data", and a numeric
 * table alternative is always one tap away (PRD §8, FR54). `compare` draws a thin second series (for
 * example the previous period) next to each bar.
 */
export function BarChart({ data, unit, title, height = 150, format = (v: number) => v.toFixed(0), compare, showTableToggle = true }: {
  data: ChartPoint[];
  unit: string;
  title: string;
  height?: number;
  format?: (v: number) => string;
  compare?: (number | null)[];
  showTableToggle?: boolean;
}) {
  const t = useTheme();
  const p = t.palette;
  const block = useBlock();
  const grow = useGrow();
  const [showTable, setShowTable] = useState(false);
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const compareValues = (compare ?? []).filter((v): v is number => v !== null);
  const max = Math.max(1e-9, ...values, ...compareValues);
  const n = Math.max(1, data.length);
  const width = 320;
  const slot = width / n;
  const barW = Math.min(14, Math.max(4, slot * (compare ? 0.28 : 0.42)));
  const chartH = height;
  const bar = block ? block.fg : p.primaryFill;
  const ghost = block ? block.chip : p.surfaceSunken;
  const grid = block ? block.chip : p.border;
  const missing = data.filter((d) => d.value === null).length;
  const summary = `${title}. ${values.length} of ${data.length} periods have data${missing ? `, ${missing} without readable data` : ''}. Highest ${values.length ? format(Math.max(...values)) : 'none'} ${unit}.`;
  const [labelsW, setLabelsW] = useState(0);
  const slotPx = labelsW / n;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(labelsW / 52))));
  return (
    <View style={{ gap: spacing.sm }}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary}>
        <Animated.View style={[{ height: chartH, transformOrigin: 'bottom' }, grow]}>
          <Svg width="100%" height={chartH} viewBox={`0 0 ${width} ${chartH}`} preserveAspectRatio="none">
            {[0.33, 0.66].map((f) => (
              <Line key={f} x1={0} x2={width} y1={chartH * f} y2={chartH * f} stroke={grid} strokeWidth={1} strokeDasharray="3,5" />
            ))}
            {data.map((d, i) => {
              const cx = slot * i + slot / 2;
              const x = compare ? cx - barW - 1.5 : cx - barW / 2;
              const prev = compare?.[i];
              const prevH = prev != null ? Math.max(barW, (chartH - 4) * (prev / max)) : 0;
              return (
                <G key={i}>
                  {compare && prev != null ? <Rect x={cx + 1.5} y={chartH - prevH} width={barW} height={prevH} rx={barW / 2} fill={ghost} /> : null}
                  {d.value === null ? (
                    <Rect x={x} y={chartH - 14} width={barW} height={12} rx={barW / 2} fill="none" stroke={block ? block.fgMuted : p.textSubtle} strokeDasharray="2,2" />
                  ) : (
                    <Rect x={x} y={chartH - Math.max(barW, (chartH - 4) * (d.value / max))} width={barW} height={Math.max(barW, (chartH - 4) * (d.value / max))} rx={barW / 2} fill={bar} opacity={d.value === 0 ? 0.35 : 1} />
                  )}
                </G>
              );
            })}
          </Svg>
        </Animated.View>
        <View style={styles.labels} onLayout={(e) => setLabelsW(e.nativeEvent.layout.width)}>
          {labelsW > 0
            ? data.map((d, i) =>
                i % labelEvery === 0 ? (
                  <Txt key={i} variant="micro" color="textMuted" align="center" numberOfLines={1} style={{ position: 'absolute', left: Math.min(Math.max(0, i * slotPx + slotPx / 2 - 26), labelsW - 52), width: 52, fontSize: 11 }}>
                    {d.label}
                  </Txt>
                ) : null
              )
            : null}
        </View>
      </View>
      {missing > 0 ? <Txt variant="caption">Dashed markers mean no readable data for that period, not zero.</Txt> : null}
      {showTableToggle ? (
        <Pressable onPress={() => setShowTable(!showTable)} accessibilityRole="button" accessibilityLabel={showTable ? `Hide numbers for ${title}` : `Show numbers for ${title}`} hitSlop={6} style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={showTable ? 'chevron-up' : 'chevron-down'} color={block ? block.fg : p.primary} size={18} />
          <Txt variant="label" style={{ color: block ? block.fg : p.primary }}>{showTable ? 'Hide numbers' : 'Show numbers'}</Txt>
        </Pressable>
      ) : null}
      {showTable ? <DataTable rows={data.map((d) => [d.label, d.value === null ? 'No data' : `${format(d.value)} ${unit}`])} /> : null}
    </View>
  );
}

export function LineChart({ points, unit, title, height = 140 }: { points: { t: number; value: number }[]; unit: string; title: string; height?: number }) {
  const t = useTheme();
  const p = t.palette;
  if (points.length < 2) return <Txt variant="caption">Not enough readings to draw a trend.</Txt>;
  const width = 300;
  const minT = points[0]!.t;
  const maxT = points[points.length - 1]!.t;
  const vals = points.map((q) => q.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (v: number) => ((v - minT) / Math.max(1, maxT - minT)) * (width - 12) + 6;
  const y = (v: number) => height - 10 - ((v - lo) / Math.max(1e-9, hi - lo)) * (height - 24);
  // Break the line at gaps larger than 3x the median spacing: gaps stay gaps.
  const spacings = points.slice(1).map((q, i) => q.t - points[i]!.t).sort((a, b) => a - b);
  const median = spacings[Math.floor(spacings.length / 2)] ?? 0;
  let d = '';
  points.forEach((q, i) => {
    const gap = i > 0 && q.t - points[i - 1]!.t > median * 3;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(q.t).toFixed(1)},${y(q.value).toFixed(1)} `;
  });
  const last = points[points.length - 1]!;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${title}. ${points.length} readings from ${lo.toFixed(0)} to ${hi.toFixed(0)} ${unit}. Gaps are shown as breaks.`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="lc" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.primaryFill} stopOpacity={0.22} />
            <Stop offset="1" stopColor={p.primaryFill} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={`${d} L${x(last.t).toFixed(1)},${height} L${x(points[0]!.t).toFixed(1)},${height} Z`} fill="url(#lc)" />
        <Path d={d} stroke={p.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={x(last.t)} cy={y(last.value)} r={4.5} fill={p.primaryFill} stroke={p.surface} strokeWidth={2} />
      </Svg>
    </View>
  );
}

export function DataTable({ rows, header }: { rows: string[][]; header?: string[] }) {
  const { palette: p } = useTheme();
  return (
    <View style={{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: p.surfaceAlt }}>
      {header ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: p.surfaceSunken }}>
          {header.map((h, i) => (
            <Txt key={i} variant="label" style={{ flex: 1 }}>{h}</Txt>
          ))}
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={i} accessible accessibilityLabel={r.join(', ')} style={{ flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderTopWidth: i || header ? StyleSheet.hairlineWidth : 0, borderColor: p.border }}>
          {r.map((c, j) => (
            <Txt key={j} variant="caption" color={j === 0 ? 'textMuted' : 'text'} tabular style={{ flex: 1 }}>{c}</Txt>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { height: 16, marginTop: spacing.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', minHeight: 40 }
});
