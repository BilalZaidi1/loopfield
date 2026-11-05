import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { Medal } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, useTheme } from '@/theme/tokens';

/**
 * Explainer illustrations for the welcome screen and the first-run tour. They are drawings of how the
 * game works (a hex board, a loop, a route), never real runners, places or results.
 */
type Fill = 'mine' | 'rival' | 'rival2' | 'unavailable';

const W = 320;
const H = 220;
const R = 17;
const HEX_W = Math.sqrt(3) * R;

function hexPoints(cx: number, cy: number, r = R - 1.2): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}
const centre = (col: number, row: number): [number, number] => [col * HEX_W + (row % 2 ? HEX_W / 2 : 0) + 4, row * R * 1.5 + 8];

/** Smooth closed curve through points (Catmull-Rom converted to cubic Béziers). */
function smoothLoop(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]!.toFixed(1)},${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)},${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

const BOARDS: Record<'claim' | 'rivals' | 'route', { fills: Record<string, Fill>; loop?: [number, number][]; route?: string }> = {
  claim: {
    fills: { '4,3': 'mine', '5,3': 'mine', '6,3': 'mine', '4,4': 'mine', '5,4': 'mine', '6,4': 'mine', '5,5': 'mine', '4,5': 'mine', '5,2': 'mine', '8,6': 'rival', '9,6': 'rival', '9,5': 'rival', '1,7': 'unavailable', '2,7': 'unavailable' },
    loop: [[132, 34], [196, 44], [226, 92], [208, 148], [150, 170], [104, 142], [92, 88]]
  },
  rivals: {
    fills: { '2,3': 'mine', '3,3': 'mine', '2,4': 'mine', '3,4': 'mine', '3,2': 'mine', '4,3': 'mine', '6,3': 'rival', '7,3': 'rival', '7,4': 'rival', '6,4': 'rival', '8,3': 'rival', '7,2': 'rival', '5,6': 'rival2', '6,6': 'rival2', '5,7': 'rival2', '9,7': 'unavailable', '9,6': 'unavailable' }
  },
  route: {
    fills: { '3,4': 'mine', '4,4': 'mine' },
    route: 'M30 176 C70 150, 96 170, 128 136 S180 70, 214 84 S262 60, 292 38'
  }
};

export function HexBoard({ variant, height = 220 }: { variant: keyof typeof BOARDS; height?: number }) {
  const t = useTheme();
  const tc = t.territory;
  const dark = t.scheme === 'dark';
  const ground = dark ? '#191A1F' : '#F4F5F8';
  const road = dark ? '#262830' : '#FFFFFF';
  const park = dark ? '#16291C' : '#DDF1E2';
  const board = BOARDS[variant];
  const cells = useMemo(() => {
    const out: { key: string; x: number; y: number }[] = [];
    for (let row = 0; row < 10; row++) for (let col = 0; col < 11; col++) {
      const [x, y] = centre(col, row);
      out.push({ key: `${col},${row}`, x, y });
    }
    return out;
  }, []);
  const fillFor = (f: Fill) => (f === 'mine' ? tc.mineFill : f === 'rival' ? tc.rivalHues[0]! : f === 'rival2' ? tc.rivalHues[1]! : tc.unavailableFill);
  const loop = board.loop ? smoothLoop(board.loop) : null;
  const start = board.loop?.[0];
  return (
    <View style={{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: ground }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={W} height={H} fill={ground} />
        <Path d="M-10 120 C80 100, 160 150, 330 110" stroke={road} strokeWidth={14} fill="none" />
        <Path d="M150 -10 C140 60, 190 140, 170 230" stroke={road} strokeWidth={10} fill="none" />
        <Path d="M240 -10 L280 230" stroke={road} strokeWidth={6} fill="none" />
        <Path d="M10 190 C40 160, 90 170, 96 206 L10 230 Z" fill={park} />
        <G>
          {cells.map((c) => {
            const f = board.fills[c.key];
            if (!f) return <Polygon key={c.key} points={hexPoints(c.x, c.y)} fill="none" stroke={tc.grid} strokeWidth={1} />;
            return (
              <Polygon
                key={c.key}
                points={hexPoints(c.x, c.y)}
                fill={fillFor(f)}
                fillOpacity={f === 'mine' ? 0.62 : f === 'unavailable' ? 0.28 : 0.5}
                stroke={f === 'mine' ? tc.mineLine : f === 'unavailable' ? tc.unavailableLine : fillFor(f)}
                strokeWidth={f === 'mine' ? 2 : 1.4}
                strokeDasharray={f === 'unavailable' ? '3,3' : undefined}
              />
            );
          })}
        </G>
        {loop ? (
          <>
            <Path d={loop} stroke={tc.pathCasing} strokeWidth={9} fill="none" strokeLinejoin="round" />
            <Path d={loop} stroke={tc.path} strokeWidth={4.5} fill="none" strokeLinejoin="round" />
          </>
        ) : null}
        {board.route ? (
          <>
            <Path d={board.route} stroke={tc.routeCasing} strokeWidth={10} fill="none" strokeLinecap="round" />
            <Path d={board.route} stroke={tc.route} strokeWidth={5} fill="none" strokeLinecap="round" />
            <Circle cx={30} cy={176} r={7} fill={tc.start} stroke={tc.routeCasing} strokeWidth={3} />
          </>
        ) : null}
        {start ? <Circle cx={start[0]} cy={start[1]} r={8} fill="#FF7A1A" stroke={tc.pathCasing} strokeWidth={3} /> : null}
      </Svg>
      {board.route ? (
        <View style={{ position: 'absolute', right: 14, top: 10 }}>
          <Medal label="1st" tone="orange" size={58} />
        </View>
      ) : null}
    </View>
  );
}

/** Weekly bars and a medal: progress and personal bests. */
export function ProgressArt({ height = 220 }: { height?: number }) {
  const t = useTheme();
  const p = t.palette;
  const bars = [0.42, 0.7, 0.35, 0.9, 0.58, 0.78, 1];
  return (
    <View style={{ height, borderRadius: radius.xl, backgroundColor: t.blocks.violet.bg, padding: 24, justifyContent: 'flex-end' }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', right: 20, top: 18 }}>
        <Medal label="10K" tone="violet" size={70} />
      </View>
      <Svg width="100%" height={height * 0.55} viewBox="0 0 280 120" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="pa" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.75} />
          </LinearGradient>
        </Defs>
        {bars.map((b, i) => (
          <G key={i}>
            <Rect x={i * 40 + 6} y={120 - b * 110} width={11} height={b * 110} rx={5.5} fill="url(#pa)" />
            <Rect x={i * 40 + 21} y={120 - b * 80} width={11} height={b * 80} rx={5.5} fill="#FFFFFF" opacity={0.25} />
          </G>
        ))}
      </Svg>
      <View style={{ position: 'absolute', left: 24, top: 24, width: 64, height: 6, borderRadius: 3, backgroundColor: p.green }} />
    </View>
  );
}

/** A ring of runners around a club badge: following, clubs and sharing. */
export function CommunityArt({ height = 220 }: { height?: number }) {
  const t = useTheme();
  const p = t.palette;
  const tints = [p.primarySoft, p.orangeSoft, p.blueSoft, p.greenSoft, p.primarySoft, p.orangeSoft];
  const icons = [p.primary, p.orangeText, p.blueText, p.greenText, p.primary, p.orangeText];
  return (
    <View style={{ height, borderRadius: radius.xl, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: t.blocks.green.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clubs" color="#121318" size={44} />
      </View>
      {tints.map((bg, i) => {
        const a = (i / tints.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <View key={i} style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: Math.cos(a) * 96 - 26, marginTop: Math.sin(a) * 74 - 26, width: 52, height: 52, borderRadius: 26, backgroundColor: bg, borderWidth: 3, borderColor: p.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="user" color={icons[i]!} size={24} />
          </View>
        );
      })}
    </View>
  );
}
