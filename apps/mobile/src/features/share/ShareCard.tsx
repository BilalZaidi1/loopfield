import { forwardRef, useEffect, useMemo, useState } from 'react';
import { View, type HostInstance } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path, Rect } from 'react-native-svg';
import { Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LoopMark } from '@/components/Brand';
import type { SharedLand } from '@/features/social/PostCard';
import { fmtArea, fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import type { Units } from '@/lib/format';
import { qrPath } from './qr';
import { landLine, RouteSketch, type SketchColors } from './RouteSketch';
import { buildSketch, staticMapUrl, type Sketch } from './sketch';

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
  /** The runner's profile picture (a short-lived link); their initial is drawn without one. */
  avatarUri?: string | null;
  date: string | null;
  distanceM: number | null;
  elapsedMs: number | null;
  paceSecPerKm: number | null;
  route: string[] | null;
  land: SharedLand | null;
  achievements: string[];
  /** Public Mapbox token: draws a street map under the route. Without one the route is drawn on its own. */
  mapToken?: string | null;
  /** On-device only (from the phone's health store); drawn into the image, never uploaded. */
  avgHr?: number | null;
  calories?: number | null;
  /** Public activity page for the QR code, when the runner made one. */
  link?: string | null;
}

type Load = 'loading' | 'ready' | 'failed';

// One look on every phone and theme: ink ground, the loop's violet and the runner's orange.
const INK = '#101114';
const PANEL = '#1B1C23';
const WHITE = '#FFFFFF';
const MUTED = '#A6A8B7';
const VIOLET = '#7C78FF';
const ORANGE = '#FF7A1A';
const SKETCH: SketchColors = { dots: '#3A3C48', cell: '#6762F0', cellLine: '#8E8AFF', takenLine: ORANGE, path: WHITE, casing: '#2B2C36', start: '#16C47F', finish: ORANGE };
// Over the street map the route needs a darker edge to stand out from roads.
const SKETCH_ON_MAP: SketchColors = { ...SKETCH, casing: '#0B0C10', cellLine: '#A9A6FF' };

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

/** The runner's picture in a ring, or their initial when they have none (or it cannot load). */
function RunnerPicture({ name, uri, size, onLoad }: { name: string; uri: string | null | undefined; size: number; onLoad: (uri: string, s: Load) => void }) {
  // Failure is remembered per picture, so a new picture is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const ring = { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' as const, backgroundColor: VIOLET, alignItems: 'center' as const, justifyContent: 'center' as const };
  if (uri && failedUri !== uri) {
    return (
      <View style={ring}>
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" accessibilityLabel={`${name}'s picture`} accessible
          onLoad={() => onLoad(uri, 'ready')} onError={() => { setFailedUri(uri); onLoad(uri, 'failed'); }} />
      </View>
    );
  }
  return (
    <View style={ring}>
      <Txt variant="label" style={{ color: WHITE, fontSize: size * 0.42, lineHeight: size * 0.5 }}>{(name.trim()[0] ?? 'R').toUpperCase()}</Txt>
    </View>
  );
}

/**
 * The route takes whatever height is left on the card (measured, so it is drawn at that size). With a map
 * token, a street map of exactly the same area sits underneath; if the map cannot load, the route is drawn
 * on its own dark ground as before. The card works out the drawing and the map, so it knows what to wait for.
 */
function SketchSlot({ c, width, height, minHeight, onHeight, sketch, mapUrl, mapState, onMap }: {
  c: CardContent;
  width: number;
  height: number;
  minHeight: number;
  onHeight: (h: number) => void;
  sketch: Sketch | null;
  mapUrl: string | null;
  mapState: Load | null;
  onMap: (url: string, s: Load) => void;
}) {
  const showMap = Boolean(mapUrl) && mapState !== 'failed';
  return (
    <View testID="share-route" style={{ flex: 1, minHeight, borderRadius: showMap ? 12 : 18, overflow: 'hidden', backgroundColor: PANEL }} onLayout={(e) => onHeight(Math.floor(e.nativeEvent.layout.height))}>
      {showMap && mapUrl ? (
        <Image source={{ uri: mapUrl }} style={{ position: 'absolute', left: 0, top: 0, width, height }} contentFit="fill" cachePolicy="memory-disk"
          accessibilityLabel="Street map of the area the route crosses" accessible
          onLoad={() => onMap(mapUrl, 'ready')} onError={() => onMap(mapUrl, 'failed')} />
      ) : null}
      {height ? <RouteSketch input={{ route: c.route, cells: c.land?.cells, taken: c.land?.taken }} sketch={sketch} width={width} height={height} rounded={false} background={PANEL}
        colors={showMap ? SKETCH_ON_MAP : SKETCH} overMap={showMap} /> : null}
    </View>
  );
}

/** Without a route or land to draw, the loop mark fills the space so the card still looks composed. */
function Watermark() {
  const [size, setSize] = useState(0);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(e) => setSize(Math.floor(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height) * 0.72))}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {size > 40 ? <View style={{ opacity: 0.16 }}><LoopMark size={size} ring={VIOLET} dot={ORANGE} /></View> : null}
    </View>
  );
}

/**
 * The branded run card exported as an image (9:16 for stories, 4:5 and 1:1 for posts): the runner and their
 * picture, the date, a huge distance, time and pace, the route on a street map with the land it holds,
 * what changed hands, any achievements and, when the runner made a public link, a QR code to the run's
 * page. `onReady` says when the pictures have loaded (or failed), so the image is never taken half-drawn.
 */
export const ShareCard = forwardRef<HostInstance, { format: CardFormat; content: CardContent; units: Units; onReady?: (ready: boolean) => void }>(function ShareCard({ format, content: c, units, onReady }, ref) {
  const { w, h } = CARD_SIZE[format];
  const tall = format === '9:16';
  const square = format === '1:1';
  const pad = square ? 18 : 22;
  const inner = w - pad * 2;
  const dist = c.distanceM != null ? splitValue(fmtDistance(c.distanceM, units)) : null;
  const hasSketch = Boolean(c.route?.length || c.land?.cells.length);
  // Without a route the distance is the picture, so it grows.
  const numeral = (tall ? 88 : square ? 52 : 60) * (hasSketch ? 1 : 1.18);
  const stats = [
    c.elapsedMs != null ? { label: 'Time', value: fmtDuration(c.elapsedMs) } : null,
    c.paceSecPerKm != null ? { label: 'Pace', value: fmtPace(c.paceSecPerKm, units) } : null,
    c.avgHr ? { label: 'Heart rate', value: `${c.avgHr} bpm` } : null,
    c.calories ? { label: 'Energy', value: `${c.calories} kcal` } : null
  ].filter(Boolean).slice(0, square ? 2 : 4) as { label: string; value: string }[];
  const land = landLine(c.land);
  // Keep "61.2 ha" together when the line wraps.
  const area = c.land?.area_m2 ? fmtArea(c.land.area_m2, units).replace(' ', ' ') : null;
  const gap = tall ? 12 : square ? 8 : 10;
  const handleLine = `@${c.handle}${c.date ? ` · ${c.date}` : ''}`;

  // What the image waits for, each tied to the picture it describes so a new picture starts out loading.
  const [slotH, setSlotH] = useState(0);
  const sketch = useMemo(() => (hasSketch && slotH ? buildSketch({ route: c.route, cells: c.land?.cells, taken: c.land?.taken }, inner, slotH, 18) : null), [hasSketch, c.route, c.land, inner, slotH]);
  const mapUrl = sketch ? staticMapUrl(sketch.view, inner, slotH, c.mapToken) : null;
  const [mapLoad, setMapLoad] = useState<{ url: string; state: Load } | null>(null);
  const mapState: Load | null = mapUrl ? (mapLoad?.url === mapUrl ? mapLoad.state : 'loading') : null;
  const [avatarLoad, setAvatarLoad] = useState<{ uri: string; state: Load } | null>(null);
  const avatarState: Load | null = c.avatarUri ? (avatarLoad?.uri === c.avatarUri ? avatarLoad.state : 'loading') : null;
  const onAvatar = (uri: string, state: Load) => setAvatarLoad({ uri, state });
  const ready = avatarState !== 'loading' && (!hasSketch || (slotH > 0 && mapState !== 'loading'));
  useEffect(() => {
    onReady?.(ready);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View ref={ref} collapsable={false} style={{ width: w, height: h, backgroundColor: INK, padding: pad, gap, overflow: 'hidden' }}>
      {/* Brand and runner: two rows on a story, one row on the shorter post formats. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LoopMark size={24} ring={VIOLET} dot={ORANGE} />
        <Txt variant="display" style={{ color: WHITE, fontSize: 19, lineHeight: 22, letterSpacing: -0.5 }}>Loopfield</Txt>
        <View style={{ flex: 1 }} />
        {tall ? (c.date ? <Txt variant="caption" style={{ color: MUTED }} numberOfLines={1}>{c.date}</Txt> : null) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '62%' }}>
            <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
              <Txt variant="label" style={{ color: WHITE }} numberOfLines={1}>{c.runnerName}</Txt>
              <Txt variant="micro" style={{ color: MUTED }} numberOfLines={1}>{handleLine}</Txt>
            </View>
            <RunnerPicture name={c.runnerName} uri={c.avatarUri} size={30} onLoad={onAvatar} />
          </View>
        )}
      </View>
      {tall ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <RunnerPicture name={c.runnerName} uri={c.avatarUri} size={38} onLoad={onAvatar} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="bodyStrong" style={{ color: WHITE }} numberOfLines={1}>{c.runnerName}</Txt>
            <Txt variant="caption" style={{ color: MUTED }} numberOfLines={1}>{`@${c.handle}`}</Txt>
          </View>
        </View>
      ) : null}
      {hasSketch ? (
        <SketchSlot c={c} width={inner} height={slotH} minHeight={square ? 90 : 120} onHeight={setSlotH} sketch={sketch} mapUrl={mapUrl} mapState={mapState}
          onMap={(url, state) => setMapLoad({ url, state })} />
      ) : <Watermark />}
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
