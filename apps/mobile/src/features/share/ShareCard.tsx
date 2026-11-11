import { forwardRef, useMemo, useState } from 'react';
import { View, type HostInstance } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LoopMark } from '@/components/Brand';
import type { SharedLand } from '@/features/social/PostCard';
import { fmtArea, fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import type { Units } from '@/lib/format';
import { qrPath } from './qr';
import { landLine, RouteSketch, type SketchColors } from './RouteSketch';

export type CardFormat = '9:16' | '4:5' | '1:1';

/** Card sizes in points; exported at 3× (1080 px wide). */
export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = {
  '9:16': { w: 360, h: 640 },
  '4:5': { w: 360, h: 450 },
  '1:1': { w: 360, h: 360 }
};

export interface CardContent {
  runnerName: string;
  handle: string;
  date: string | null;
  distanceM: number | null;
  elapsedMs: number | null;
  paceSecPerKm: number | null;
  route: string[] | null;
  land: SharedLand | null;
  achievements: string[];
  /** On-device only (from the phone's health store); drawn into the image, never uploaded. */
  avgHr?: number | null;
  calories?: number | null;
  /** Public activity page for the QR code, when the runner made one. */
  link?: string | null;
}

// One look on every phone and theme: ink ground, the loop's violet and the runner's orange.
const INK = '#101114';
const PANEL = '#1B1C23';
const WHITE = '#FFFFFF';
const MUTED = '#A6A8B7';
const VIOLET = '#7C78FF';
const ORANGE = '#FF7A1A';
const SKETCH: SketchColors = { dots: '#3A3C48', cell: '#6762F0', cellLine: '#8E8AFF', takenLine: ORANGE, path: WHITE, casing: '#2B2C36', start: '#16C47F', finish: ORANGE };

function Qr({ text, size }: { text: string; size: number }) {
  const q = useMemo(() => qrPath(text), [text]);
  const quiet = 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${q.size + quiet * 2} ${q.size + quiet * 2}`} accessibilityLabel="QR code to this run's page">
      <Rect x={-quiet} y={-quiet} width={q.size + quiet * 2} height={q.size + quiet * 2} fill={WHITE} rx={2} />
      <Path d={q.d} fill={INK} />
    </Svg>
  );
}

function Stat({ label, value, size }: { label: string; value: string; size: number }) {
  return (
    <View style={{ flexBasis: '46%', flexGrow: 1, gap: 1, minWidth: 0 }}>
      <Txt variant="micro" style={{ color: MUTED, fontSize: 11, lineHeight: 14 }} numberOfLines={1}>{label}</Txt>
      <Txt variant="headline" style={{ color: WHITE, fontSize: size, lineHeight: size + 4 }} numberOfLines={1} tabular>{value}</Txt>
    </View>
  );
}

/** The route sketch takes whatever height is left on the card (measured, so the SVG is drawn at that size). */
function SketchSlot({ c, width, minHeight }: { c: CardContent; width: number; minHeight: number }) {
  const [h, setH] = useState(0);
  return (
    <View style={{ flex: 1, minHeight, borderRadius: 18, overflow: 'hidden', backgroundColor: PANEL }} onLayout={(e) => setH(Math.floor(e.nativeEvent.layout.height))}>
      {h ? <RouteSketch input={{ route: c.route, cells: c.land?.cells, taken: c.land?.taken }} width={width} height={h} rounded={false} background={PANEL} colors={SKETCH} /> : null}
    </View>
  );
}

/**
 * The branded run card exported as an image (9:16 for stories, 4:5 and 1:1 for posts): the runner, the
 * date, a huge distance, time and pace, the route sketch with the land it holds, what changed hands, any
 * achievements and, when the runner made a public link, a QR code to the run's page.
 */
export const ShareCard = forwardRef<HostInstance, { format: CardFormat; content: CardContent; units: Units }>(function ShareCard({ format, content: c, units }, ref) {
  const { w, h } = CARD_SIZE[format];
  const tall = format === '9:16';
  const square = format === '1:1';
  const pad = square ? 18 : 22;
  const inner = w - pad * 2;
  const dist = c.distanceM != null ? splitValue(fmtDistance(c.distanceM, units)) : null;
  const numeral = tall ? 88 : square ? 52 : 60;
  const stats = [
    c.elapsedMs != null ? { label: 'Time', value: fmtDuration(c.elapsedMs) } : null,
    c.paceSecPerKm != null ? { label: 'Pace', value: fmtPace(c.paceSecPerKm, units) } : null,
    c.avgHr ? { label: 'Heart rate', value: `${c.avgHr} bpm` } : null,
    c.calories ? { label: 'Energy', value: `${c.calories} kcal` } : null
  ].filter(Boolean).slice(0, square ? 2 : 4) as { label: string; value: string }[];
  const land = landLine(c.land);
  // Keep "61.2 ha" together when the line wraps.
  const area = c.land?.area_m2 ? fmtArea(c.land.area_m2, units).replace(' ', '\u00a0') : null;
  const hasSketch = Boolean(c.route?.length || c.land?.cells.length);
  const gap = tall ? 12 : square ? 8 : 10;
  const handleLine = `@${c.handle}${c.date ? ` · ${c.date}` : ''}`;
  return (
    <View ref={ref} collapsable={false} style={{ width: w, height: h, backgroundColor: INK, padding: pad, gap, overflow: 'hidden' }}>
      {/* Brand and runner: two rows on a story, one row on the shorter post formats. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LoopMark size={24} ring={VIOLET} dot={ORANGE} />
        <Txt variant="display" style={{ color: WHITE, fontSize: 19, lineHeight: 22, letterSpacing: -0.5 }}>Loopfield</Txt>
        <View style={{ flex: 1 }} />
        {tall ? (c.date ? <Txt variant="caption" style={{ color: MUTED }} numberOfLines={1}>{c.date}</Txt> : null) : (
          <View style={{ alignItems: 'flex-end', maxWidth: '58%' }}>
            <Txt variant="label" style={{ color: WHITE }} numberOfLines={1}>{c.runnerName}</Txt>
            <Txt variant="micro" style={{ color: MUTED }} numberOfLines={1}>{handleLine}</Txt>
          </View>
        )}
      </View>
      {tall ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: VIOLET, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="label" style={{ color: WHITE }}>{(c.runnerName.trim()[0] ?? 'R').toUpperCase()}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" style={{ color: WHITE }} numberOfLines={1}>{c.runnerName}</Txt>
            <Txt variant="caption" style={{ color: MUTED }} numberOfLines={1}>{`@${c.handle}`}</Txt>
          </View>
        </View>
      ) : null}
      {hasSketch ? <SketchSlot c={c} width={inner} minHeight={square ? 90 : 120} /> : <View style={{ flex: 1 }} />}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        {dist ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <Txt variant="hero" style={{ color: WHITE, fontSize: numeral, lineHeight: numeral * 1.02, letterSpacing: -numeral * 0.035 }} tabular numberOfLines={1}>{dist.value}</Txt>
            <Txt variant="display" style={{ color: VIOLET, fontSize: numeral * 0.34, lineHeight: numeral * 0.5, marginBottom: numeral * 0.08 }}>{dist.unit}</Txt>
          </View>
        ) : <View style={{ flex: 1 }} />}
        {c.link && !tall ? <Qr text={c.link} size={square ? 58 : 64} /> : null}
      </View>
      {stats.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 }}>
          {stats.map((x) => <Stat key={x.label} label={x.label} value={x.value} size={square ? 16 : 18} />)}
        </View>
      ) : null}
      {land ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Icon name="hexagon" color={VIOLET} size={18} />
          <Txt variant="label" style={{ color: WHITE, flex: 1 }} numberOfLines={square ? 1 : 2}>{`${land}${area && !square ? ` · ${area}` : ''}`}</Txt>
        </View>
      ) : null}
      {c.achievements.length && tall ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {c.achievements.slice(0, 2).map((a) => (
            <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,122,26,0.16)' }}>
              <Icon name="trophy" color={ORANGE} size={13} />
              <Txt variant="micro" style={{ color: ORANGE, fontSize: 12 }} numberOfLines={1}>{a}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {c.link && tall ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Qr text={c.link} size={66} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label" style={{ color: WHITE }}>Scan to see this run</Txt>
            <Txt variant="micro" style={{ color: MUTED }} numberOfLines={1}>{c.link.replace(/^https?:\/\//, '')}</Txt>
          </View>
        </View>
      ) : null}
    </View>
  );
});
