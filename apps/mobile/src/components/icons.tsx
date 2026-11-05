import { memo } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Loopfield's own line icons: 24 px grid, 2 px round strokes. Decorative by default (hidden from screen
 * readers); the control that holds an icon carries the accessible label.
 */
type Glyph = { d: string; fill?: boolean; dots?: [number, number, number][] };

function gearPath(): string {
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const at = (deg: number, r: number) => {
      const t = a + (deg * Math.PI) / 180;
      return `${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`;
    };
    pts.push(at(-11, 9.3), at(11, 9.3), at(15, 7.1), at(30, 7.1));
  }
  return `M${pts.join(' L')} Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z`;
}

const GLYPHS = {
  home: { d: 'M3.5 10.6 12 3.5l8.5 7.1V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1z' },
  map: { d: 'M9 4 3.5 6.3v13.4L9 17.5l6 2.5 5.5-2.3V4.3L15 6.5zM9 4v13.5M15 6.5V20' },
  record: { d: 'M13.5 8.6 11.5 13M13.5 8.6 10 9.6 8 12.2M13.5 8.6l2.6 2.6 3-.6M11.5 13l3 2.6-.6 4.6M11.5 13 9 16.2l-4 1', dots: [[15.6, 4.6, 2]] },
  progress: { d: 'M3.5 17.5 9 12l4 4 7.5-8.5M14.5 7.5h6v6' },
  clubs: { d: 'M9 11.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM2.5 20.5a6.5 6.5 0 0 1 13 0M16.2 4.3a3.6 3.6 0 0 1 0 6.8M18.2 14.6a6.5 6.5 0 0 1 3.3 5.9' },
  bell: { d: 'M6 9.5a6 6 0 1 1 12 0c0 5.6 2.3 7 2.3 7H3.7S6 15.1 6 9.5zM10 20.2a2.1 2.1 0 0 0 4 0' },
  chat: { d: 'M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5H10l-5 3.8V7A2.5 2.5 0 0 1 7.5 4.5z' },
  search: { d: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16' },
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  'arrow-right': { d: 'M5 12h14M13 6l6 6-6 6' },
  'arrow-left': { d: 'M19 12H5M11 6l-6 6 6 6' },
  'arrow-up-right': { d: 'M7 17 17 7M8.5 7H17v8.5' },
  'chevron-right': { d: 'M9.5 6l6 6-6 6' },
  'chevron-left': { d: 'M14.5 6l-6 6 6 6' },
  'chevron-down': { d: 'M6 9.5l6 6 6-6' },
  'chevron-up': { d: 'M6 14.5l6-6 6 6' },
  close: { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  play: { d: 'M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5a.8.8 0 0 0-1.2.7z', fill: true },
  pause: { d: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z', fill: true },
  stop: { d: 'M6.5 7.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z', fill: true },
  flag: { d: 'M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11' },
  trophy: { d: 'M8 4h8v5.5a4 4 0 0 1-8 0zM8 6H5.2a2.8 2.8 0 0 0 2.9 4M16 6h2.8a2.8 2.8 0 0 1-2.9 4M12 13.5v3.5M9 20.5h6M10 17h4v3.5h-4z' },
  medal: { d: 'M8 3l3 5.5M16 3l-3 5.5M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.4l1 2.1 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z' },
  crown: { d: 'M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5L19 18.5H5zM5 21h14' },
  flame: { d: 'M12 3c1.2 3.4 5.5 5.6 5.5 10.3a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.3 2.6-5.3.2 2 1.2 3.2 2.5 3.4-1-2.7-.9-5.6.4-8.4z' },
  heart: { d: 'M12 20s-7.8-4.7-7.8-10.2A4.5 4.5 0 0 1 12 7.2a4.5 4.5 0 0 1 7.8 2.6C19.8 15.3 12 20 12 20z' },
  'heart-filled': { d: 'M12 20s-7.8-4.7-7.8-10.2A4.5 4.5 0 0 1 12 7.2a4.5 4.5 0 0 1 7.8 2.6C19.8 15.3 12 20 12 20z', fill: true },
  settings: { d: gearPath() },
  user: { d: 'M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM4 21a8 8 0 0 1 16 0' },
  shield: { d: 'M12 3l7.5 3v5.6c0 4.6-3.2 8.2-7.5 9.4-4.3-1.2-7.5-4.8-7.5-9.4V6z' },
  target: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', dots: [[12, 12, 1.4]] },
  route: { d: 'M7 18.5h9.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H17M5 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  layers: { d: 'M12 3.5 2.8 8.2 12 13l9.2-4.8zM2.8 12.4 12 17.2l9.2-4.8M2.8 16.4 12 21.2l9.2-4.8' },
  locate: { d: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2v3M12 19v3M2 12h3M19 12h3', dots: [[12, 12, 2.6]] },
  bolt: { d: 'M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z' },
  clock: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2' },
  stopwatch: { d: 'M12 21.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9.5v4l2.6 1.6M9.5 2.5h5M18.5 6l1.5-1.5' },
  calendar: { d: 'M4.5 6.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19zM4.5 10h15M8.5 3v4M15.5 3v4' },
  share: { d: 'M12 3.5v11.5M7.5 8 12 3.5 16.5 8M5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-5.5' },
  eye: { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  'eye-off': { d: 'M3.5 3.5l17 17M10.5 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.9M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2' },
  sun: { d: 'M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4' },
  moon: { d: 'M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z' },
  device: { d: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.2h2' },
  lock: { d: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11' },
  mail: { d: 'M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6' },
  info: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.2' },
  alert: { d: 'M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4.5M12 17.2v.2' },
  help: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.7v.4M12 17v.2' },
  star: { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' },
  pin: { d: 'M12 21.5s7-6.1 7-11.8a7 7 0 0 0-14 0c0 5.7 7 11.8 7 11.8zM12 12.2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  compass: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.6 8.4l-2 5.2-5.2 2 2-5.2z' },
  pulse: { d: 'M2.5 12h4l2.5-6.5 4.2 13 2.6-6.5h5.7' },
  mountain: { d: 'M2.5 19.5 9.2 8l4.2 6.8 2.6-3.6 5.5 8.3z' },
  speed: { d: 'M3.5 17.5a8.5 8.5 0 1 1 17 0M12 17.5l4.2-5.2' },
  more: { d: '', dots: [[5.5, 12, 1.8], [12, 12, 1.8], [18.5, 12, 1.8]] },
  edit: { d: 'M4.5 19.5h3.8L19 8.8 15.2 5 4.5 15.7zM13.5 6.7l3.8 3.8' },
  trash: { d: 'M4 7h16M9.5 7V4.5h5V7M6.2 7l1 13h9.6l1-13M10 11v5.5M14 11v5.5' },
  logout: { d: 'M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5 5.5 12 10 7.5M5.5 12h10' },
  globe: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3z' },
  sparkle: { d: 'M11 3.5l1.7 5L17.5 10l-4.8 1.6L11 16.5l-1.7-4.9L4.5 10l4.8-1.5zM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z' },
  hexagon: { d: 'M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z' },
  camera: { d: 'M4 8h3.2l1.8-2.8h6l1.8 2.8H20a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z' },
  image: { d: 'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM3.5 16l5-5 4 4 2.2-2.2 5.8 5.7', dots: [[15.5, 9, 1.5]] },
  refresh: { d: 'M19.5 10.5A7.7 7.7 0 0 0 5.6 7.3L4 9.2M4 4.5v4.7h4.7M4.5 13.5a7.7 7.7 0 0 0 13.9 3.2l1.6-1.9M20 19.5v-4.7h-4.7' },
  external: { d: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' },
  download: { d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14' },
  filter: { d: 'M4 5h16l-6.2 7.6v5.9l-3.6 1.8v-7.7z' },
  link: { d: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 1 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1-1' },
  send: { d: 'M20.5 3.5 10.2 13.8M20.5 3.5l-6.6 17-3.7-6.7-6.7-3.7z' },
  volume: { d: 'M4 9.5v5h3.8L13 18.8V5.2L7.8 9.5zM16.5 8.8a4.6 4.6 0 0 1 0 6.4M18.9 6.4a8 8 0 0 1 0 11.2' },
  'volume-off': { d: 'M4 9.5v5h3.8L13 18.8V5.2L7.8 9.5zM16.5 9.5l5 5M21.5 9.5l-5 5' },
  ban: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8' },
  apple: { d: 'M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.5 1.3-2.6 0 0-2.5-1-2.5-3.7zM14.1 5.9c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z', fill: true }
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS | 'google';

export const Icon = memo(function Icon({ name, color, size = 24, strokeWidth = 2 }: { name: IconName; color: string; size?: number; strokeWidth?: number }) {
  if (name === 'google') return <GoogleMark size={size} />;
  const g: Glyph = GLYPHS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {g.d ? (
        <Path
          d={g.d}
          fill={g.fill ? color : 'none'}
          stroke={g.fill ? 'none' : color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {g.dots?.map(([cx, cy, r], i) => <Circle key={i} cx={cx} cy={cy} r={r} fill={color} />)}
    </Svg>
  );
});

/** Google's standard multicolour "G", used only on the Sign in with Google button as Google's guidelines require. */
function GoogleMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z" />
    </Svg>
  );
}
