import type { IconName } from '@/content/en';

/** The app's 2 px line icons (apps/mobile/src/components/icons.tsx), same paths on a 24-unit grid. */
const GLYPHS: Record<IconName | 'play', { d: string; dots?: [number, number, number][]; fill?: boolean }> = {
  home: { d: 'M3.5 10.6 12 3.5l8.5 7.1V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1z' },
  map: { d: 'M9 4 3.5 6.3v13.4L9 17.5l6 2.5 5.5-2.3V4.3L15 6.5zM9 4v13.5M15 6.5V20' },
  record: { d: 'M13.5 8.6 11.5 13M13.5 8.6 10 9.6 8 12.2M13.5 8.6l2.6 2.6 3-.6M11.5 13l3 2.6-.6 4.6M11.5 13 9 16.2l-4 1', dots: [[15.6, 4.6, 2]] },
  progress: { d: 'M3.5 17.5 9 12l4 4 7.5-8.5M14.5 7.5h6v6' },
  clubs: { d: 'M9 11.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM2.5 20.5a6.5 6.5 0 0 1 13 0M16.2 4.3a3.6 3.6 0 0 1 0 6.8M18.2 14.6a6.5 6.5 0 0 1 3.3 5.9' },
  chat: { d: 'M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5H10l-5 3.8V7A2.5 2.5 0 0 1 7.5 4.5z' },
  plus: { d: 'M12 5v14M5 12h14' },
  'arrow-right': { d: 'M5 12h14M13 6l6 6-6 6' },
  close: { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  play: { d: 'M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5a.8.8 0 0 0-1.2.7z', fill: true },
  flag: { d: 'M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11' },
  trophy: { d: 'M8 4h8v5.5a4 4 0 0 1-8 0zM8 6H5.2a2.8 2.8 0 0 0 2.9 4M16 6h2.8a2.8 2.8 0 0 1-2.9 4M12 13.5v3.5M9 20.5h6M10 17h4v3.5h-4z' },
  heart: { d: 'M12 20s-7.8-4.7-7.8-10.2A4.5 4.5 0 0 1 12 7.2a4.5 4.5 0 0 1 7.8 2.6C19.8 15.3 12 20 12 20z' },
  route: { d: 'M7 18.5h9.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H17M5 20.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  bolt: { d: 'M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z' },
  calendar: { d: 'M4.5 6.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19zM4.5 10h15M8.5 3v4M15.5 3v4' },
  share: { d: 'M12 3.5v11.5M7.5 8 12 3.5 16.5 8M5 13.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-5.5' },
  'eye-off': { d: 'M3.5 3.5l17 17M10.5 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.9M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2' },
  lock: { d: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11' },
  compass: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.6 8.4l-2 5.2-5.2 2 2-5.2z' },
  hexagon: { d: 'M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z' },
  camera: { d: 'M4 8h3.2l1.8-2.8h6l1.8 2.8H20a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z' }
};

export function Icon({ name, size = 24, className, strokeWidth = 2 }: { name: IconName | 'play'; size?: number; className?: string; strokeWidth?: number }) {
  const g = GLYPHS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path
        d={g.d}
        fill={g.fill ? 'currentColor' : 'none'}
        stroke={g.fill ? 'none' : 'currentColor'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {g.dots?.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" />)}
    </svg>
  );
}
