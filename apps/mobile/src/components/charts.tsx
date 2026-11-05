import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { spacing, usePalette } from '@/theme/tokens';
import { Button, Txt } from './ui';

export interface ChartPoint {
  label: string;
  /** null = no readable data (drawn as a gap marker, never as zero). */
  value: number | null;
}

/**
 * Accessible bar chart: missing values are drawn as hollow markers labelled "no data", and a
 * numeric table alternative is always available (PRD §8, FR54).
 */
export function BarChart({ data, unit, title, height = 160, format = (v: number) => v.toFixed(0) }: {
  data: ChartPoint[];
  unit: string;
  title: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const p = usePalette();
  const [showTable, setShowTable] = useState(false);
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = Math.max(1, ...values);
  const width = Math.max(240, data.length * 22);
  const barW = (width - 8) / Math.max(1, data.length);
  const missing = data.filter((d) => d.value === null).length;
  const summary = `${title}. ${values.length} of ${data.length} periods have data${missing ? `, ${missing} without readable data` : ''}. Highest ${values.length ? format(Math.max(...values)) : 'none'} ${unit}.`;
  return (
    <View style={{ gap: spacing.sm }}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <Line x1={0} y1={height - 16} x2={width} y2={height - 16} stroke={p.border} strokeWidth={1} />
          {data.map((d, i) => {
            const x = 4 + i * barW + barW * 0.15;
            const w = barW * 0.7;
            if (d.value === null) {
              return <Rect key={i} x={x} y={height - 28} width={w} height={10} fill="none" stroke={p.textMuted} strokeDasharray="2,2" />;
            }
            const h = ((height - 24) * d.value) / max;
            return <Rect key={i} x={x} y={height - 16 - h} width={w} height={Math.max(1, h)} rx={2} fill={p.primary} />;
          })}
          {data.length <= 14 &&
            data.map((d, i) => (
              <SvgText key={`l${i}`} x={4 + i * barW + barW / 2} y={height - 2} fontSize={9} fill={p.textMuted} textAnchor="middle">
                {d.label}
              </SvgText>
            ))}
        </Svg>
      </View>
      {missing > 0 ? <Txt variant="caption">Dashed markers mean no readable data for that period — not zero.</Txt> : null}
      <Button label={showTable ? 'Hide numbers' : 'Show numbers'} variant="ghost" onPress={() => setShowTable(!showTable)} />
      {showTable ? <DataTable rows={data.map((d) => [d.label, d.value === null ? 'No data' : `${format(d.value)} ${unit}`])} /> : null}
    </View>
  );
}

export function LineChart({ points, unit, title, height = 140 }: { points: { t: number; value: number }[]; unit: string; title: string; height?: number }) {
  const p = usePalette();
  if (points.length < 2) return <Txt variant="caption">Not enough readings to draw a trend.</Txt>;
  const width = 300;
  const minT = points[0]!.t;
  const maxT = points[points.length - 1]!.t;
  const vals = points.map((q) => q.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (t: number) => ((t - minT) / Math.max(1, maxT - minT)) * (width - 8) + 4;
  const y = (v: number) => height - 8 - ((v - lo) / Math.max(1e-9, hi - lo)) * (height - 16);
  // Break the line at gaps larger than 3x the median spacing: gaps stay gaps.
  const spacings = points.slice(1).map((q, i) => q.t - points[i]!.t).sort((a, b) => a - b);
  const median = spacings[Math.floor(spacings.length / 2)] ?? 0;
  let d = '';
  points.forEach((q, i) => {
    const gap = i > 0 && q.t - points[i - 1]!.t > median * 3;
    d += `${i === 0 || gap ? 'M' : 'L'}${x(q.t).toFixed(1)},${y(q.value).toFixed(1)} `;
  });
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${title}. ${points.length} readings from ${lo.toFixed(0)} to ${hi.toFixed(0)} ${unit}. Gaps are shown as breaks.`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Path d={d} stroke={p.primary} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}

export function DataTable({ rows, header }: { rows: string[][]; header?: string[] }) {
  const p = usePalette();
  return (
    <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: 8 }}>
      {header ? (
        <View style={{ flexDirection: 'row', padding: spacing.sm, backgroundColor: p.surfaceAlt }}>
          {header.map((h, i) => (
            <Txt key={i} variant="label" style={{ flex: 1 }}>{h}</Txt>
          ))}
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={i} accessible accessibilityLabel={r.join(', ')} style={{ flexDirection: 'row', padding: spacing.sm, borderTopWidth: i || header ? 1 : 0, borderColor: p.border }}>
          {r.map((c, j) => (
            <Txt key={j} variant="caption" color="text" style={{ flex: 1 }}>{c}</Txt>
          ))}
        </View>
      ))}
    </View>
  );
}
