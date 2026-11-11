import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Line, Rect } from 'react-native-svg';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';
import { Icon } from './icons';
import { Txt, useBlock } from './ui';

export interface ChartPoint {
  /** Short axis label (for example "M" or "2 Nov"). */
  label: string;
  /** null = no readable data (drawn as a gap marker, never as zero). */
  value: number | null;
  /** Full name for the numbers table and screen readers (for example "Monday"). Defaults to `label`. */
  long?: string;
  /** The period in progress (today, this week): highlighted in the numbers table. */
  current?: boolean;
}

export interface ChartTableOptions {
  /** Header of the first column, for example "Day" or "Week". */
  period?: string;
  /** Header of the value column; defaults to the unit. */
  series?: string;
  /** Header of the comparison column, for example "Last week". */
  compareSeries?: string;
  /** Tag shown on the current row, for example "Today". */
  currentTag?: string;
  /** Add a total row (only for additive measures such as distance or time). */
  total?: boolean;
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
export function BarChart({ data, unit, title, height = 150, format = (v: number) => v.toFixed(0), compare, showTableToggle = true, table }: {
  data: ChartPoint[];
  unit: string;
  title: string;
  height?: number;
  format?: (v: number) => string;
  compare?: (number | null)[];
  showTableToggle?: boolean;
  table?: ChartTableOptions;
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
  // Axis labels are as wide as the longest label needs, so seven single-letter days all fit.
  const labelW = Math.min(52, Math.max(18, Math.max(...data.map((d) => d.label.length)) * 7 + 6));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(labelsW / labelW))));
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
                  <Txt key={i} variant="micro" color="textMuted" align="center" numberOfLines={1} style={{ position: 'absolute', left: Math.min(Math.max(0, i * slotPx + slotPx / 2 - labelW / 2), labelsW - labelW), width: labelW, fontSize: 11 }}>
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
      {showTable ? <ChartTable data={data} compare={compare} unit={unit} format={format} options={table} /> : null}
    </View>
  );
}

/** Colours for tables, following the coloured card they sit on (so a table on violet stays violet). */
function useTableColors() {
  const { palette: p } = useTheme();
  const block = useBlock();
  return block
    ? { panel: block.chip, rule: block.chip, head: block.fgMuted, text: block.fg, muted: block.fgMuted, track: block.chip, fill: block.fg, current: block.chip, tagBg: block.fg, tagFg: block.bg }
    : { panel: p.surfaceAlt, rule: p.border, head: p.textMuted, text: p.text, muted: p.textSubtle, track: p.surfaceSunken, fill: p.primaryFill, current: p.primarySoft, tagBg: p.primaryFill, tagFg: '#FFFFFF' };
}

/**
 * The numbers behind a chart: full period names, right-aligned tabular values with a small magnitude
 * bar, an optional comparison column and total. "No data" is written out, never shown as zero.
 */
export function ChartTable({ data, compare, unit, format, options = {} }: { data: ChartPoint[]; compare?: (number | null)[]; unit: string; format: (v: number) => string; options?: ChartTableOptions }) {
  const c = useTableColors();
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = Math.max(1e-9, ...values);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((t, v) => t + (v ?? 0), 0);
  const cell = (v: number | null, strong: boolean) => (
    <Txt variant="label" tabular align="right" numberOfLines={1} style={{ color: v === null || v === 0 ? c.muted : c.text, fontWeight: strong && v ? '700' : '600' }}>
      {v === null ? '–' : format(v)}
    </Txt>
  );
  return (
    <View style={[styles.table, { backgroundColor: c.panel }]}>
      <View style={[styles.row, styles.head, { borderBottomColor: c.rule }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Txt variant="micro" style={{ flex: 1, color: c.head }}>{options.period ?? 'Period'}</Txt>
        <Txt variant="micro" align="right" numberOfLines={1} style={[styles.value, { color: c.head }]}>{options.series ?? unit}</Txt>
        {compare ? <Txt variant="micro" align="right" numberOfLines={1} style={[styles.num, { color: c.head }]}>{options.compareSeries ?? 'Before'}</Txt> : null}
      </View>
      {data.map((d, i) => {
        const prev = compare?.[i] ?? null;
        const name = d.long ?? d.label;
        const spoken = `${name}: ${d.value === null ? 'no data' : `${format(d.value)} ${unit}`}${compare ? `, ${options.compareSeries ?? 'before'} ${prev === null ? 'no data' : `${format(prev)} ${unit}`}` : ''}`;
        return (
          <View key={i} accessible accessibilityLabel={d.current && options.currentTag ? `${spoken}, ${options.currentTag}` : spoken} style={[styles.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.rule }, d.current ? { backgroundColor: c.current } : null]}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
              <Txt variant="label" numberOfLines={1} style={{ color: c.text, flexShrink: 1 }}>{name}</Txt>
              {d.current && options.currentTag ? (
                <View style={[styles.tag, { backgroundColor: c.tagBg }]}>
                  <Txt variant="micro" style={{ color: c.tagFg }}>{options.currentTag}</Txt>
                </View>
              ) : null}
            </View>
            <View style={[styles.value, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm }]}>
              <View style={[styles.track, { backgroundColor: c.track }]}>
                {d.value ? <View style={{ width: Math.max(3, (d.value / max) * 32), height: 6, borderRadius: 3, backgroundColor: c.fill }} /> : null}
              </View>
              <View style={{ flex: 1 }}>{cell(d.value, true)}</View>
            </View>
            {compare ? <View style={styles.num}>{cell(prev, false)}</View> : null}
          </View>
        );
      })}
      {options.total ? (
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: c.rule }]} accessible accessibilityLabel={`Total: ${format(sum(data.map((d) => d.value)))} ${unit}${compare ? `, ${options.compareSeries ?? 'before'} ${format(sum(compare))} ${unit}` : ''}`}>
          <Txt variant="label" style={{ flex: 1, color: c.text, fontWeight: '700' }}>Total</Txt>
          <Txt variant="label" tabular align="right" numberOfLines={1} style={[styles.value, { color: c.text, fontWeight: '800' }]}>{`${format(sum(data.map((d) => d.value)))} ${unit}`}</Txt>
          {compare ? <Txt variant="label" tabular align="right" numberOfLines={1} style={[styles.num, { color: c.muted, fontWeight: '700' }]}>{`${format(sum(compare))} ${unit}`}</Txt> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * General table (splits, daily readings). The first column is the row name; every other column is
 * a right-aligned tabular value.
 */
export function DataTable({ rows, header }: { rows: string[][]; header?: string[] }) {
  const c = useTableColors();
  return (
    <View style={[styles.table, { backgroundColor: c.panel }]}>
      {header ? (
        <View style={[styles.row, styles.head, { borderBottomColor: c.rule }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {header.map((h, i) => (
            <Txt key={i} variant="micro" align={i === 0 ? 'left' : 'right'} numberOfLines={1} style={{ flex: i === 0 ? 1.2 : 1, color: c.head }}>{h}</Txt>
          ))}
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={i} accessible accessibilityLabel={header ? r.map((v, j) => `${header[j] ?? ''} ${v}`.trim()).join(', ') : r.join(', ')} style={[styles.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.rule }]}>
          {r.map((v, j) => (
            <Txt key={j} variant="label" tabular align={j === 0 ? 'left' : 'right'} numberOfLines={1} style={{ flex: j === 0 ? 1.2 : 1, color: j === 0 ? c.text : /^(no data|–|-)$/i.test(v) ? c.muted : c.text, fontWeight: j === 0 ? '600' : '700' }}>{v}</Txt>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { height: 16, marginTop: spacing.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', minHeight: 40 },
  table: { borderRadius: radius.md, overflow: 'hidden', paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 42 },
  head: { minHeight: 34, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { width: 96, alignItems: 'flex-end' },
  num: { width: 60, alignItems: 'flex-end' },
  track: { width: 32, height: 6, borderRadius: 3, overflow: 'hidden' },
  tag: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }
});
