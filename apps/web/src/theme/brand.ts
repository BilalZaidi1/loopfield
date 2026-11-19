/**
 * Loopfield's look on the web, mirrored from the app (dark scheme): apps/mobile/src/theme/tokens.ts,
 * apps/mobile/src/theme/motion.ts and apps/mobile/src/components/Brand.tsx (docs/DESIGN.md).
 * The site is art-directed dark, so only the dark values live here. brand.test.ts fails when these drift
 * from the app or from the CSS variables in src/app/globals.css: change all three together.
 *
 * Colours keep one meaning everywhere: violet = you, your land and the brand · blue = runs ·
 * orange = competition (rivals, seasons, route titles) · green = health, goals and points · magenta = achievements.
 */
export const palette = {
  bg: '#101114',
  surface: '#1C1D22',
  surfaceAlt: '#24252B',
  surfaceSunken: '#0B0C0E',
  text: '#F5F6FA',
  textMuted: '#A3A7B5',
  textSubtle: '#7A7E8C',
  border: '#2C2E35',
  borderStrong: '#3A3D46',
  primary: '#8B87FF',
  primaryFill: '#6762F0',
  primaryPressed: '#5853E0',
  primarySoft: '#25244A',
  onPrimarySoft: '#C9C7FF',
  blue: '#0A74E0',
  blueSoft: '#13263B',
  blueText: '#5AB4FF',
  orange: '#FF7A1A',
  orangeSoft: '#35210F',
  orangeText: '#FF9A4D',
  green: '#5CC86A',
  greenSoft: '#15301B',
  greenText: '#4ADE80',
  magenta: '#D57AF0'
} as const;

/** Text colour on the bright blocks (orange, green): the app's light-scheme ink, so every pairing meets AA. */
export const blockInk = '#121318';

/** Map and territory colours (TerritoryColors, dark). Your land is always violet; rivals are warm hues, never violet. */
export const territory = {
  mineFill: '#7C78FF',
  mineLine: '#A9A6FF',
  rivalHues: ['#FF8A3D', '#FF6B9A', '#2CC9B2', '#F5B841', '#4FA8FF', '#9CCB2E', '#FF6B66', '#C9926B'],
  rivalOpacity: 0.36,
  unavailableFill: '#7A7E8C',
  unavailableLine: '#9CA0AE',
  route: '#2BD38A',
  routeMine: '#A9A6FF',
  routeCasing: '#101114',
  path: '#8B87FF',
  pathStart: '#4FA8FF',
  closing: '#FF9A4D',
  start: '#2BD38A',
  finish: '#F5F6FA',
  checkpoint: '#5AB4FF',
  building: '#2A2D37',
  buildingOpacity: 0.8
} as const;

/** Springs from apps/mobile/src/theme/motion.ts, plus the splash ring from Brand.tsx. */
export const springs = {
  press: { damping: 18, stiffness: 340, mass: 0.6 },
  sheet: { damping: 24, stiffness: 240, mass: 0.9 },
  pop: { damping: 12, stiffness: 220, mass: 0.7 },
  splashRing: { damping: 14, stiffness: 120, mass: 0.8 }
} as const;
export type Spring = (typeof springs)[keyof typeof springs];

/** The app's start-up moment (BrandSplash): the loop swings closed from −110°, the dot lands, the name rises. */
export const splash = { ringFromDeg: -110, dotDelayMs: 380, wordDelayMs: 520, wordDurationMs: 360, wordRisePx: 14 } as const;

/** The open loop with the runner's dot at the gap: the moment before a loop closes and claims ground. */
export const mark = {
  viewBox: '0 0 100 100',
  ring: 'M82.84 41.2 A34 34 0 1 1 67 20.56',
  strokeWidth: 11,
  dot: { cx: 67, cy: 20.56, r: 7.5 },
  ringColor: palette.primaryFill,
  dotColor: palette.orange
} as const;

/** Badge metals: bronze, silver, gold and a cool platinum (DESIGN.md "Badges and ranking"). Light → shade. */
export const metals = {
  bronze: ['#F1B88A', '#C9824F', '#7A4626'],
  silver: ['#F4F6FA', '#B9C0CC', '#6D7482'],
  gold: ['#FFE7A0', '#E7B33E', '#8A6214'],
  platinum: ['#EEF8FC', '#A9CFE0', '#5F8798']
} as const;
