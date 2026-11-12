import { useState, type ReactNode } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fonts, spacing, useTheme, type Theme } from '@/theme/tokens';
import type { DayRange, PeriodPoint, Stage } from '@/features/health/series';
import { fmtDay } from '@/lib/format';
import { Txt } from './ui';

/**
 * Charts for the health screens, one series each, drawn to the same rules: thin columns with 4 px
 * rounded tops and a 2 px gap, 2 px lines, markers ringed in the surface colour, solid hairline axes and
 * ticks at clean numbers. Tapping the plot picks the nearest day (or week) and the line above the chart
 * reads it out; the same values are always available as a table on the screen.
 */

/** Validated colours (dataviz validator, light on #FFFFFF and dark on #1C1D22). */
export function healthColors(t: Theme) {
  const dark = t.scheme === 'dark';
  return {
    bar: dark ? '#55AE66' : '#3A944F',
    line: dark ? '#7CCB88' : '#257539',
    ramp: dark ? ['#2E6A3B', '#3E8A4F', '#55AE66', '#7CCB88', '#B4EBBC'] : ['#7CC88B', '#56B06A', '#3A944F', '#257539', '#145628'],
    stages: (dark
      ? { deep: '#6762F0', light: '#199E70', rem: '#3987E5', awake: '#D95926' }
      : { deep: '#5B57E3', light: '#1BAF7A', rem: '#2A78D6', awake: '#EB6834' }) as Record<Stage, string>
  };
}

const AXIS = 44;
const XBAND = 22;
const TOP = 10;

function useWidth() {
  const [w, setW] = useState(0);
  return { w, onLayout: (e: LayoutChangeEvent) => setW(Math.floor(e.nativeEvent.layout.width)) };
}

/** 0 / 1 / 2 / 2.5 / 5 steps: the smallest clean number at or above v. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/** Axis numbers: in full below 10,000, compact (10K) on an axis that reaches it. */
export function tickLabel(v: number, axisMax: number): string {
  if (v === 0) return '0';
  if (axisMax >= 10_000) return `${Math.round(v / 1000)}K`;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: v < 10 && v % 1 ? 1 : 0 }).format(v);
}

/** The line above a chart: what is picked, or how to pick. */
function Readout({ text, hint }: { text: string | null; hint: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ minHeight: 22 }}>
      <Txt variant="label" color={text ? 'text' : 'textMuted'} numberOfLines={2}>{text ?? hint}</Txt>
    </View>
  );
}

function Frame({ label, onLayout, children, readout }: { label: string; onLayout: (e: LayoutChangeEvent) => void; children: ReactNode; readout: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {readout}
      <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={label}>{children}</View>
    </View>
  );
}

const roundedTop = (x: number, top: number, bottom: number, w: number) => {
  const r = Math.min(4, w / 2, Math.max(0, bottom - top));
  return `M${x} ${bottom} L${x} ${top + r} Q${x} ${top} ${x + r} ${top} L${x + w - r} ${top} Q${x + w} ${top} ${x + w} ${top + r} L${x + w} ${bottom} Z`;
};

/** Indexes that get an x label: about four, counted back from the last so the latest is always named. */
const labelled = (n: number, i: number) => (n <= 8 ? true : (n - 1 - i) % Math.ceil(n / 4) === 0);

function YAxis({ ticks, y, width, max, color, grid }: { ticks: number[]; y: (v: number) => number; width: number; max: number; color: string; grid: string }) {
  return (
    <G>
      {ticks.map((v) => (
        <G key={v}>
          <Line x1={AXIS} x2={width} y1={y(v)} y2={y(v)} stroke={grid} strokeWidth={1} />
          <SvgText fontFamily={fonts.medium} x={AXIS - 6} y={y(v) + 4} fontSize={11} fill={color} textAnchor="end">{tickLabel(v, max)}</SvgText>
        </G>
      ))}
    </G>
  );
}

/**
 * Columns for a total or an average per day (or per week on long periods), with an optional average line.
 * Days without a reading get a small hollow marker on the baseline, never a zero-height bar.
 */
export function ColumnChart({ points, describe, label, average, height = 172 }: {
  points: PeriodPoint[];
  describe: (p: PeriodPoint) => string;
  label: string;
  average?: number | null;
  height?: number;
}) {
  const t = useTheme();
  const p = t.palette;
  const c = healthColors(t);
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const n = points.length;
  const plotW = Math.max(0, w - AXIS);
  const plotH = height - XBAND - TOP;
  const max = niceCeil(Math.max(1, average ?? 0, ...points.map((x) => x.value ?? 0)));
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const pick = (e: GestureResponderEvent) => {
    const i = Math.floor((e.nativeEvent.locationX - AXIS) / slot);
    setSel(i >= 0 && i < n && i !== sel ? i : null);
  };
  return (
    <Frame label={label} onLayout={onLayout} readout={<Readout text={sel != null && points[sel] ? describe(points[sel]!) : null} hint="Tap a column to see its value." />}>
      {w ? (
        <Pressable onPress={pick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={w} height={height}>
            <YAxis ticks={[0, max / 2, max]} y={y} width={w} max={max} color={p.textMuted} grid={p.border} />
            {points.map((pt, i) => {
              const x = AXIS + i * slot + (slot - barW) / 2;
              const dim = sel != null && sel !== i;
              return (
                <G key={pt.key}>
                  {pt.value != null ? (
                    <Path d={roundedTop(x, Math.min(y(pt.value), y(0) - (pt.value > 0 ? 2 : 0)), y(0), barW)} fill={c.bar} opacity={dim ? 0.35 : 1} />
                  ) : (
                    <Circle cx={x + barW / 2} cy={y(0) - 4} r={3} fill="none" stroke={p.textSubtle} strokeWidth={1.5} />
                  )}
                  {labelled(n, i) ? <SvgText fontFamily={fonts.medium} x={i === n - 1 && n > 8 ? x + barW : x + barW / 2} y={height - 6} fontSize={11} fill={p.textMuted} textAnchor={i === n - 1 && n > 8 ? 'end' : 'middle'}>{pt.label}</SvgText> : null}
                </G>
              );
            })}
            {average != null && average > 0 ? (
              <G>
                <Line x1={AXIS} x2={w} y1={y(average)} y2={y(average)} stroke={p.text} strokeWidth={1.5} strokeOpacity={0.55} />
                <Rect x={w - 50} y={y(average) - 17} width={50} height={15} rx={4} fill={p.surface} opacity={0.9} />
                <SvgText fontFamily={fonts.medium} x={w - 2} y={y(average) - 5} fontSize={11} fill={p.text} textAnchor="end">Average</SvgText>
              </G>
            ) : null}
          </Svg>
        </Pressable>
      ) : <View style={{ height }} />}
    </Frame>
  );
}

/**
 * A calendar: one row per week, Monday to Sunday, each day shaded by its value in five steps of one
 * colour (more is stronger). Days without a reading stay empty; days outside the period are left out.
 */
export function CalendarHeat({ days, daily, describe, label }: {
  days: readonly string[];
  daily: ReadonlyMap<string, number>;
  describe: (day: string, value: number | null) => string;
  label: string;
}) {
  const t = useTheme();
  const p = t.palette;
  const c = healthColors(t);
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<string | null>(null);
  if (!days.length) return null;
  const [y0, m0, d0] = days[0]!.split('-').map(Number);
  const lead = (new Date(y0!, m0! - 1, d0!).getDay() + 6) % 7;
  const rows = Math.ceil((lead + days.length) / 7);
  const LEFT = 46;
  const gap = 3;
  const cell = Math.max(10, Math.min(34, Math.floor((w - LEFT - gap * 6) / 7)));
  const vals = days.map((k) => daily.get(k)).filter((v): v is number => v != null).sort((a, b) => a - b);
  const cut = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] ?? 0);
  const step = (v: number) => (vals.length && vals[0] === vals[vals.length - 1] ? 2 : cut.filter((x) => v > x).length);
  const HEAD = 18;
  const height = HEAD + rows * (cell + gap);
  const pick = (e: GestureResponderEvent) => {
    const col = Math.floor((e.nativeEvent.locationX - LEFT) / (cell + gap));
    const row = Math.floor((e.nativeEvent.locationY - HEAD) / (cell + gap));
    const i = row * 7 + col - lead;
    const k = col >= 0 && col < 7 && i >= 0 && i < days.length ? days[i]! : null;
    setSel(k && k !== sel ? k : null);
  };
  return (
    <Frame label={label} onLayout={onLayout} readout={<Readout text={sel ? describe(sel, daily.get(sel) ?? null) : null} hint="Tap a day to see its value." />}>
      {w ? (
        <View style={{ gap: spacing.sm }}>
          <Pressable onPress={pick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width={w} height={height}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <SvgText fontFamily={fonts.medium} key={i} x={LEFT + i * (cell + gap) + cell / 2} y={12} fontSize={11} fill={p.textMuted} textAnchor="middle">{d}</SvgText>
              ))}
              {Array.from({ length: rows }, (_, r) => {
                const first = days[Math.max(0, r * 7 - lead)]!;
                return <SvgText fontFamily={fonts.medium} key={`r${r}`} x={0} y={HEAD + r * (cell + gap) + cell / 2 + 4} fontSize={11} fill={p.textMuted}>{fmtDay(first)}</SvgText>;
              })}
              {days.map((k, i) => {
                const pos = i + lead;
                const x = LEFT + (pos % 7) * (cell + gap);
                const yy = HEAD + Math.floor(pos / 7) * (cell + gap);
                const v = daily.get(k);
                return (
                  <G key={k}>
                    <Rect x={x} y={yy} width={cell} height={cell} rx={4} fill={v == null ? p.surfaceAlt : c.ramp[step(v)]} />
                    {sel === k ? <Rect x={x - 1.5} y={yy - 1.5} width={cell + 3} height={cell + 3} rx={5} fill="none" stroke={p.text} strokeWidth={2} /> : null}
                  </G>
                );
              })}
            </Svg>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-end' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Txt variant="caption">Less</Txt>
            {c.ramp.map((col) => <View key={col} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: col }} />)}
            <Txt variant="caption">More</Txt>
            <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: p.surfaceAlt, marginLeft: spacing.sm }} />
            <Txt variant="caption">No data</Txt>
          </View>
        </View>
      ) : <View style={{ height: 200 }} />}
    </Frame>
  );
}

/** Each day's (or week's) lowest to highest reading as a band, with the average as a ringed dot. */
export function RangeChart({ points, describe, label, height = 184 }: {
  points: { key: string; label: string; long: string; range: DayRange | null }[];
  describe: (p: { long: string; range: DayRange | null }) => string;
  label: string;
  height?: number;
}) {
  const t = useTheme();
  const p = t.palette;
  const c = healthColors(t);
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const n = points.length;
  const rs = points.map((x) => x.range).filter((r): r is DayRange => Boolean(r));
  const lo = rs.length ? Math.floor(Math.min(...rs.map((r) => r.min)) / 10) * 10 : 40;
  const hi = rs.length ? Math.ceil(Math.max(...rs.map((r) => r.max)) / 10) * 10 : 180;
  const span = Math.max(10, hi - lo);
  const plotW = Math.max(0, w - AXIS);
  const plotH = height - XBAND - TOP;
  const y = (v: number) => TOP + plotH - ((v - lo) / span) * plotH;
  const slot = plotW / Math.max(1, n);
  const band = Math.max(3, Math.min(10, slot * 0.45));
  const pick = (e: GestureResponderEvent) => {
    const i = Math.floor((e.nativeEvent.locationX - AXIS) / slot);
    setSel(i >= 0 && i < n && i !== sel ? i : null);
  };
  const ticks = [lo, lo + span / 2, hi];
  return (
    <Frame label={label} onLayout={onLayout} readout={<Readout text={sel != null && points[sel] ? describe(points[sel]!) : null} hint="Tap a day to see its lowest, average and highest." />}>
      {w ? (
        <Pressable onPress={pick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={w} height={height}>
            <YAxis ticks={ticks} y={y} width={w} max={hi} color={p.textMuted} grid={p.border} />
            {points.map((pt, i) => {
              const cx = AXIS + i * slot + slot / 2;
              const r = pt.range;
              const dim = sel != null && sel !== i;
              return (
                <G key={pt.key} opacity={dim ? 0.35 : 1}>
                  {r ? (
                    <>
                      <Rect x={cx - band / 2} y={y(r.max)} width={band} height={Math.max(band, y(r.min) - y(r.max))} rx={band / 2} fill={c.bar} fillOpacity={0.35} />
                      {slot >= 6 ? <Circle cx={cx} cy={y(r.avg)} r={4} fill={c.line} stroke={p.surface} strokeWidth={2} /> : null}
                    </>
                  ) : (
                    <Circle cx={cx} cy={y(lo) - 4} r={3} fill="none" stroke={p.textSubtle} strokeWidth={1.5} />
                  )}
                  {labelled(n, i) ? <SvgText fontFamily={fonts.medium} x={i === n - 1 && n > 8 ? cx + band / 2 : cx} y={height - 6} fontSize={11} fill={p.textMuted} textAnchor={i === n - 1 && n > 8 ? 'end' : 'middle'}>{pt.label}</SvgText> : null}
                </G>
              );
            })}
          </Svg>
        </Pressable>
      ) : <View style={{ height }} />}
    </Frame>
  );
}

/**
 * A trend through the days with readings: a 2 px line (broken where more than `joinDays` pass without a
 * reading), dots on short periods, and an optional shaded "usual range" named in a legend under the plot.
 * With `smooth`, the line is the average of the last `smooth` days and each day's reading is a faint dot.
 */
export function TrendLine({ days, daily, describe, label, band, digits = 0, joinDays = 7, smooth, height = 176 }: {
  days: readonly string[];
  daily: ReadonlyMap<string, number>;
  describe: (day: string, value: number) => string;
  label: string;
  /** Low and high of the usual range (shaded), when there is one. */
  band?: [number, number] | null;
  digits?: number;
  /** Longest stretch without readings that the line still bridges (estimates far apart: Infinity). */
  joinDays?: number;
  /** Draw the average of this many days as the line, the daily readings as faint dots. */
  smooth?: number;
  height?: number;
}) {
  const t = useTheme();
  const p = t.palette;
  const c = healthColors(t);
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const pts = days.map((k, i) => ({ k, i, v: daily.get(k) })).filter((x): x is { k: string; i: number; v: number } => x.v != null);
  const line = smooth
    ? pts.map((pt) => {
        const win = pts.filter((q) => q.i <= pt.i && q.i > pt.i - smooth);
        return { ...pt, v: win.reduce((a, q) => a + q.v, 0) / win.length };
      })
    : pts;
  const n = days.length;
  const values = [...pts.map((x) => x.v), ...(band ?? [])];
  const pad = values.length ? Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.15) : 1;
  const lo = values.length ? Math.floor((Math.min(...values) - pad) * 10 ** digits) / 10 ** digits : 0;
  const hi = values.length ? Math.ceil((Math.max(...values) + pad) * 10 ** digits) / 10 ** digits : 1;
  const plotW = Math.max(0, w - AXIS - 8);
  const plotH = height - XBAND - TOP;
  const x = (i: number) => AXIS + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => TOP + plotH - ((v - lo) / Math.max(1e-9, hi - lo)) * plotH;
  const segments: string[] = [];
  let d = '';
  line.forEach((pt, j) => {
    if (j > 0 && pt.i - line[j - 1]!.i > joinDays && d) {
      segments.push(d);
      d = '';
    }
    d += `${d ? 'L' : 'M'}${x(pt.i).toFixed(1)} ${y(pt.v).toFixed(1)} `;
  });
  if (d) segments.push(d);
  const dots = pts.length <= 31;
  const pick = (e: GestureResponderEvent) => {
    if (!pts.length) return;
    const lx = e.nativeEvent.locationX;
    let best = 0;
    pts.forEach((pt, j) => {
      if (Math.abs(x(pt.i) - lx) < Math.abs(x(pts[best]!.i) - lx)) best = j;
    });
    setSel(best === sel ? null : best);
  };
  const last = line[line.length - 1];
  const fmt = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  const picked = sel != null ? pts[sel] : null;
  return (
    <Frame label={label} onLayout={onLayout} readout={<Readout text={picked ? describe(picked.k, picked.v) : null} hint="Tap the line to see a day's value." />}>
      {w ? (
        <View style={{ gap: spacing.sm }}>
          <Pressable onPress={pick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width={w} height={height}>
              {[lo, hi].map((v) => (
                <G key={v}>
                  <Line x1={AXIS} x2={w} y1={y(v)} y2={y(v)} stroke={p.border} strokeWidth={1} />
                  <SvgText fontFamily={fonts.medium} x={AXIS - 6} y={y(v) + 4} fontSize={11} fill={p.textMuted} textAnchor="end">{fmt(v)}</SvgText>
                </G>
              ))}
              {band ? <Rect x={AXIS} y={y(band[1])} width={w - AXIS} height={Math.max(2, y(band[0]) - y(band[1]))} fill={c.line} fillOpacity={0.12} /> : null}
              {smooth ? pts.map((pt) => <Circle key={`d${pt.k}`} cx={x(pt.i)} cy={y(pt.v)} r={3} fill={c.line} fillOpacity={0.35} />) : null}
              {segments.map((sg, i) => <Path key={i} d={sg} stroke={c.line} strokeWidth={smooth ? 2.5 : 2} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
              {(dots && !smooth ? line : last ? [last] : []).map((pt) => (
                <Circle key={pt.k} cx={x(pt.i)} cy={y(pt.v)} r={4} fill={c.line} stroke={p.surface} strokeWidth={2} />
              ))}
              {picked ? <Circle cx={x(picked.i)} cy={y(picked.v)} r={6} fill={c.line} stroke={p.text} strokeWidth={2} /> : null}
              {[0, n - 1].map((i) => (
                <SvgText fontFamily={fonts.medium} key={i} x={x(i)} y={height - 6} fontSize={11} fill={p.textMuted} textAnchor={i ? 'end' : 'start'}>
                  {fmtDay(days[i]!)}
                </SvgText>
              ))}
            </Svg>
          </Pressable>
          {band || smooth ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {smooth ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: c.line }} />
                  <Txt variant="caption">{`${smooth}-day average`}</Txt>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.line, opacity: 0.35, marginLeft: spacing.sm }} />
                  <Txt variant="caption">Each day</Txt>
                </View>
              ) : null}
              {band ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <View style={{ width: 16, height: 10, borderRadius: 2, backgroundColor: c.line, opacity: 0.18 }} />
                  <Txt variant="caption">Your usual range</Txt>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : <View style={{ height }} />}
    </Frame>
  );
}

/**
 * One average night split into its stages: a thin segmented bar (each stage its own block, a 2 px gap
 * between) above a list giving each stage's time and share, in the same order.
 */
export function StageBar({ minutes, names, fmt }: { minutes: Record<Stage, number>; names: Record<Stage, string>; fmt: (m: number) => string }) {
  const t = useTheme();
  const c = healthColors(t);
  const { w, onLayout } = useWidth();
  const order: Stage[] = ['deep', 'light', 'rem', 'awake'];
  const parts = order.filter((st) => minutes[st] > 0);
  const total = parts.reduce((a, st) => a + minutes[st], 0);
  const gap = 2;
  const usable = Math.max(0, w - gap * (parts.length - 1));
  const share = (st: Stage) => Math.round((minutes[st] / total) * 100);
  let x = 0;
  return (
    <View style={{ gap: spacing.md }} accessible accessibilityLabel={`An average night: ${parts.map((st) => `${names[st]} ${fmt(minutes[st])}, ${share(st)} percent`).join('; ')}`}>
      <View onLayout={onLayout}>
        {w && total ? (
          <Svg width={w} height={10}>
            {parts.map((st) => {
              const bw = (minutes[st] / total) * usable;
              const el = <Rect key={st} x={x} y={0} width={Math.max(2, bw)} height={10} rx={5} fill={c.stages[st]} />;
              x += bw + gap;
              return el;
            })}
          </Svg>
        ) : <View style={{ height: 10 }} />}
      </View>
      <View style={{ gap: spacing.sm }}>
        {parts.map((st) => (
          <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.stages[st] }} />
            <Txt variant="label" style={{ flex: 1 }}>{names[st]}</Txt>
            <Txt variant="label" tabular>{fmt(minutes[st])}</Txt>
            <Txt variant="caption" tabular style={{ width: 40, textAlign: 'right' }}>{`${share(st)}%`}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
