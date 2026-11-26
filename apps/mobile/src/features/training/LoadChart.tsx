import { useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import type { TrainingDay } from '@loopfield/core';
import { niceCeil, tickLabel } from '@/components/healthCharts';
import { Txt } from '@/components/ui';
import { fmtDay } from '@/lib/format';
import { fonts, spacing, useTheme, type Theme } from '@/theme/tokens';

/**
 * The Training chart (R2): 6-week load and 7-day load over twelve weeks, two 2 px lines on one axis (both are
 * effort points), named by a legend and at the end of each line. Tapping picks the nearest day and the line
 * above reads it out; the same numbers are on the screen as a table.
 */
const AXIS = 40;
const XBAND = 22;
const TOP = 12;
const END_LABEL = 52;

/** Validated pair (dataviz validator: light on #FCFCFB, dark on #1C1D22): blue for 6-week, orange for 7-day. */
export function loadColors(t: Theme) {
  return t.scheme === 'dark' ? { long: '#3987E5', short: '#D95926' } : { long: '#2A78D6', short: '#EB6834' };
}

export function describeDay(d: TrainingDay): string {
  return `${fmtDay(d.day, { weekday: 'short', day: 'numeric', month: 'short' })}: 6-week load ${Math.round(d.long)}, 7-day load ${Math.round(d.short)}${d.effort ? `, effort that day ${d.effort}` : ''}.`;
}

export function LoadChart({ days, label, height = 190 }: { days: readonly TrainingDay[]; label: string; height?: number }) {
  const t = useTheme();
  const p = t.palette;
  const c = loadColors(t);
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const n = days.length;
  const max = niceCeil(Math.max(1, ...days.map((d) => Math.max(d.long, d.short))));
  const plotW = Math.max(0, w - AXIS - END_LABEL);
  const plotH = height - XBAND - TOP;
  const x = (i: number) => AXIS + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => TOP + plotH - (Math.max(0, v) / max) * plotH;
  const path = (key: 'long' | 'short') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const pick = (e: GestureResponderEvent) => {
    if (!n) return;
    const i = Math.round(((e.nativeEvent.locationX - AXIS) / Math.max(1, plotW)) * (n - 1));
    const clamped = Math.max(0, Math.min(n - 1, i));
    setSel(clamped === sel ? null : clamped);
  };
  const last = days[n - 1];
  const picked = sel != null ? days[sel] : null;
  // End labels never overlap: the lower one moves down when they are close.
  const endY = last ? (() => {
    let a = y(last.long);
    let b = y(last.short);
    if (Math.abs(a - b) < 14) {
      if (a <= b) b = a + 14;
      else a = b + 14;
    }
    return { long: a, short: b };
  })() : null;
  return (
    <View style={{ gap: spacing.sm }}>
      <View accessibilityLiveRegion="polite" style={{ minHeight: 22 }}>
        <Txt variant="label" color={picked ? 'text' : 'textMuted'} numberOfLines={2}>{picked ? describeDay(picked) : 'Tap the chart to see a day.'}</Txt>
      </View>
      <View onLayout={(e: LayoutChangeEvent) => setW(Math.floor(e.nativeEvent.layout.width))} accessible accessibilityRole="image" accessibilityLabel={label}>
        {w && n ? (
          <Pressable onPress={pick} testID="load-chart-touch" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width={w} height={height}>
              {[0, max / 2, max].map((v) => (
                <G key={v}>
                  <Line x1={AXIS} x2={AXIS + plotW} y1={y(v)} y2={y(v)} stroke={p.border} strokeWidth={1} />
                  <SvgText fontFamily={fonts.medium} x={AXIS - 6} y={y(v) + 4} fontSize={11} fill={p.textMuted} textAnchor="end">{tickLabel(v, max)}</SvgText>
                </G>
              ))}
              <Path d={path('long')} stroke={c.long} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Path d={path('short')} stroke={c.short} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {last && endY ? (
                <G>
                  <Circle cx={x(n - 1)} cy={y(last.long)} r={4} fill={c.long} stroke={p.surface} strokeWidth={2} />
                  <Circle cx={x(n - 1)} cy={y(last.short)} r={4} fill={c.short} stroke={p.surface} strokeWidth={2} />
                  <SvgText fontFamily={fonts.medium} x={x(n - 1) + 8} y={endY.long + 4} fontSize={11} fill={p.text}>6-week</SvgText>
                  <SvgText fontFamily={fonts.medium} x={x(n - 1) + 8} y={endY.short + 4} fontSize={11} fill={p.text}>7-day</SvgText>
                </G>
              ) : null}
              {picked ? (
                <G>
                  <Line x1={x(sel!)} x2={x(sel!)} y1={TOP} y2={TOP + plotH} stroke={p.textMuted} strokeWidth={1} />
                  <Circle cx={x(sel!)} cy={y(picked.long)} r={5} fill={c.long} stroke={p.surface} strokeWidth={2} />
                  <Circle cx={x(sel!)} cy={y(picked.short)} r={5} fill={c.short} stroke={p.surface} strokeWidth={2} />
                </G>
              ) : null}
              {[0, n - 1].map((i) => (
                <SvgText fontFamily={fonts.medium} key={i} x={x(i)} y={height - 6} fontSize={11} fill={p.textMuted} textAnchor={i ? 'end' : 'start'}>{fmtDay(days[i]!.day)}</SvgText>
              ))}
            </Svg>
          </Pressable>
        ) : <View style={{ height }} />}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {([['long', '6-week load: your build-up'], ['short', '7-day load: your recent work']] as const).map(([k, text]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: c[k] }} />
            <Txt variant="caption">{text}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
