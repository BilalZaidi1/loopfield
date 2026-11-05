import { createContext, useContext } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';
import { env } from '@/config/env';

/**
 * Loopfield design tokens.
 *
 * One signature, everything else quiet: huge heavy-italic numerals and saturated colour blocks carry the
 * personality; surfaces stay white (light) or near-black (dark) with hairline dividers.
 *
 * Module colours keep one meaning across the app:
 *   violet = you, your territory and the brand · blue = runs and activity · orange = competition
 *   (seasons, rankings, speed titles) · green = health and goals · magenta = achievements.
 * Cool blocks (violet, blue) carry white text; bright blocks (orange, green) carry ink text, so every
 * pairing meets WCAG AA (4.5:1). Dark mode is designed separately, not inverted: lighter tints for text
 * on dark surfaces, the same saturated blocks for hero cards.
 */
const light = {
  bg: '#EEF0F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F4F8',
  surfaceSunken: '#E6E9F0',
  text: '#121318',
  textMuted: '#5D6170',
  textSubtle: '#8A8F9E',
  border: '#E3E6EE',
  borderStrong: '#CDD2DE',
  primary: '#5B57E3',
  primaryFill: '#5B57E3',
  primaryPressed: '#4A46CF',
  primarySoft: '#ECEBFE',
  onPrimarySoft: '#3D39B5',
  primaryText: '#FFFFFF',
  blue: '#0A74E0',
  blueSoft: '#E4F0FD',
  blueText: '#0A6CC9',
  orange: '#FF7A1A',
  orangeSoft: '#FFEEDF',
  orangeText: '#B4530F',
  green: '#5CC86A',
  greenSoft: '#E3F6E6',
  greenText: '#1E7F3A',
  magenta: '#C04BE0',
  ink: '#121318',
  onInk: '#FFFFFF',
  accent: '#B4530F',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  warning: '#A05A00',
  warningSoft: '#FFF3DC',
  success: '#1E7F3A',
  successSoft: '#E3F6E6',
  info: '#0A6CC9',
  infoSoft: '#E4F0FD',
  land: '#1E7F3A',
  landMine: '#5B57E3',
  title: '#B4530F',
  unavailable: '#8A8F9E',
  overlay: 'rgba(18,19,24,0.48)',
  tabBar: '#FFFFFF'
};

const dark: typeof light = {
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
  primaryText: '#FFFFFF',
  blue: '#0A74E0',
  blueSoft: '#13263B',
  blueText: '#5AB4FF',
  orange: '#FF7A1A',
  orangeSoft: '#35210F',
  orangeText: '#FF9A4D',
  green: '#5CC86A',
  greenSoft: '#15301B',
  greenText: '#4ADE80',
  magenta: '#D57AF0',
  ink: '#F5F6FA',
  onInk: '#121318',
  accent: '#FF9A4D',
  danger: '#FF7B7B',
  dangerSoft: '#3A1A1C',
  warning: '#F5B841',
  warningSoft: '#33280F',
  success: '#4ADE80',
  successSoft: '#15301B',
  info: '#5AB4FF',
  infoSoft: '#13263B',
  land: '#4ADE80',
  landMine: '#8B87FF',
  title: '#FF9A4D',
  unavailable: '#7A7E8C',
  overlay: 'rgba(0,0,0,0.62)',
  tabBar: '#18191D'
};

export type Palette = typeof light;
export type Scheme = 'light' | 'dark';

/** Saturated hero cards. `fg` is the text colour, `fgMuted` secondary text, `chip` an inset pill. */
export type BlockTone = 'violet' | 'blue' | 'orange' | 'green' | 'ink';
export interface Block {
  bg: string;
  fg: string;
  fgMuted: string;
  chip: string;
}
const blocksFor = (p: Palette, scheme: Scheme): Record<BlockTone, Block> => ({
  violet: { bg: p.primaryFill, fg: '#FFFFFF', fgMuted: 'rgba(255,255,255,0.86)', chip: 'rgba(255,255,255,0.18)' },
  blue: { bg: p.blue, fg: '#FFFFFF', fgMuted: 'rgba(255,255,255,0.88)', chip: 'rgba(255,255,255,0.18)' },
  orange: { bg: p.orange, fg: '#121318', fgMuted: 'rgba(18,19,24,0.78)', chip: 'rgba(18,19,24,0.12)' },
  green: { bg: p.green, fg: '#121318', fgMuted: 'rgba(18,19,24,0.78)', chip: 'rgba(18,19,24,0.12)' },
  ink: scheme === 'dark'
    ? { bg: '#F5F6FA', fg: '#121318', fgMuted: 'rgba(18,19,24,0.7)', chip: 'rgba(18,19,24,0.1)' }
    : { bg: '#121318', fg: '#FFFFFF', fgMuted: 'rgba(255,255,255,0.74)', chip: 'rgba(255,255,255,0.14)' }
});

/**
 * Map and territory colours, tuned per theme against the Mapbox light / dark base maps. Your land is
 * always violet; rival runners get warm, clearly different hues (never violet); unavailable land is
 * grey with a dashed edge. Colour is never the only signal: line weight, dashes and the text summary
 * repeat the same information.
 */
export interface TerritoryColors {
  mineFill: string;
  mineLine: string;
  mineGlow: string;
  rivalHues: readonly string[];
  rivalOpacity: number;
  unavailableFill: string;
  unavailableLine: string;
  grid: string;
  selectedLine: string;
  selectedCasing: string;
  route: string;
  routeMine: string;
  routeCasing: string;
  routeSuspended: string;
  path: string;
  pathCasing: string;
  closing: string;
  start: string;
  finish: string;
  checkpoint: string;
  exploration: string;
  label: string;
  labelHalo: string;
}
const territoryLight: TerritoryColors = {
  mineFill: '#5B57E3',
  mineLine: '#4A46CF',
  mineGlow: 'rgba(91,87,227,0.35)',
  rivalHues: ['#F26B1D', '#E2457A', '#0E9F8C', '#C98A00', '#1E88E5', '#6B9A00', '#D64541', '#9C6644'],
  rivalOpacity: 0.34,
  unavailableFill: '#8A8F9E',
  unavailableLine: '#6B7080',
  grid: 'rgba(91,87,227,0.16)',
  selectedLine: '#121318',
  selectedCasing: '#FFFFFF',
  route: '#12A36B',
  routeMine: '#5B57E3',
  routeCasing: '#FFFFFF',
  routeSuspended: '#8A8F9E',
  path: '#5B57E3',
  pathCasing: '#FFFFFF',
  closing: '#FF7A1A',
  start: '#12A36B',
  finish: '#121318',
  checkpoint: '#0A74E0',
  exploration: '#0A74E0',
  label: '#121318',
  labelHalo: '#FFFFFF'
};
const territoryDark: TerritoryColors = {
  mineFill: '#7C78FF',
  mineLine: '#A9A6FF',
  mineGlow: 'rgba(139,135,255,0.42)',
  rivalHues: ['#FF8A3D', '#FF6B9A', '#2CC9B2', '#F5B841', '#4FA8FF', '#9CCB2E', '#FF6B66', '#C9926B'],
  rivalOpacity: 0.36,
  unavailableFill: '#7A7E8C',
  unavailableLine: '#9CA0AE',
  grid: 'rgba(255,255,255,0.09)',
  selectedLine: '#FFFFFF',
  selectedCasing: '#101114',
  route: '#2BD38A',
  routeMine: '#A9A6FF',
  routeCasing: '#101114',
  routeSuspended: '#7A7E8C',
  path: '#8B87FF',
  pathCasing: '#101114',
  closing: '#FF9A4D',
  start: '#2BD38A',
  finish: '#F5F6FA',
  checkpoint: '#5AB4FF',
  exploration: '#4FA8FF',
  label: '#F5F6FA',
  labelHalo: '#101114'
};

export interface Theme {
  scheme: Scheme;
  palette: Palette;
  blocks: Record<BlockTone, Block>;
  territory: TerritoryColors;
  /** Mapbox base style for this theme (a custom style from the environment wins). */
  mapStyleUrl: string;
  /** Floating elements (map controls, sheets, tab bar) only; flat surfaces never get shadows. */
  elevation: { floating: ViewStyle; raised: ViewStyle };
}

export function buildTheme(scheme: Scheme): Theme {
  const palette = scheme === 'dark' ? dark : light;
  return {
    scheme,
    palette,
    blocks: blocksFor(palette, scheme),
    territory: scheme === 'dark' ? territoryDark : territoryLight,
    mapStyleUrl: scheme === 'dark' ? env.mapboxStyleUrlDark : env.mapboxStyleUrl,
    elevation:
      scheme === 'dark'
        ? { floating: { boxShadow: '0px 10px 28px rgba(0,0,0,0.55)' }, raised: { boxShadow: '0px 4px 14px rgba(0,0,0,0.4)' } }
        : { floating: { boxShadow: '0px 10px 28px rgba(27,31,59,0.16)' }, raised: { boxShadow: '0px 4px 14px rgba(27,31,59,0.1)' } }
  };
}

export const themes: Record<Scheme, Theme> = { light: buildTheme('light'), dark: buildTheme('dark') };

export type ThemeMode = 'system' | 'light' | 'dark';
export interface ThemeState {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}
export const ThemeContext = createContext<ThemeState>({ theme: themes.light, mode: 'system', setMode: () => {} });

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}
export function usePalette(): Palette {
  return useContext(ThemeContext).theme.palette;
}
export function useThemeMode(): Pick<ThemeState, 'mode' | 'setMode'> & { scheme: Scheme } {
  const s = useContext(ThemeContext);
  return { mode: s.mode, setMode: s.setMode, scheme: s.theme.scheme };
}

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;

/** Figtree, loaded at start-up (src/theme/fonts.ts). Each weight is its own family so Android never fakes bold. */
export const fonts = {
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  bold: 'Figtree-Bold',
  extrabold: 'Figtree-ExtraBold',
  blackItalic: 'Figtree-BlackItalic'
} as const;

const tabular = ['tabular-nums' as const];
export const type = {
  /** Hero numerals: the one loud element on a screen. */
  hero: { fontFamily: fonts.blackItalic, fontSize: 76, lineHeight: 78, letterSpacing: -2.4, fontVariant: tabular },
  /** Heavy italic headlines (welcome, ready-to-run). */
  display: { fontFamily: fonts.blackItalic, fontSize: 42, lineHeight: 44, letterSpacing: -1.1 },
  metric: { fontFamily: fonts.blackItalic, fontSize: 34, lineHeight: 38, letterSpacing: -0.8, fontVariant: tabular },
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  headline: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.1 }
} satisfies Record<string, TextStyle>;
export type TypeVariant = keyof typeof type;

/** Maps a numeric weight (from a style override) to the matching Figtree family. */
export function familyForWeight(weight: TextStyle['fontWeight'], italic: boolean): string {
  if (italic) return fonts.blackItalic;
  const w = typeof weight === 'number' ? weight : weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 500 : Number(weight) || 500;
  if (w >= 800) return fonts.extrabold;
  if (w >= 700) return fonts.bold;
  if (w >= 600) return fonts.semibold;
  return fonts.medium;
}

/** Minimum touch target (dp) used by all interactive components. */
export const TOUCH = 48;

/** Deterministic hue for a rival controller from the theme's rival set. */
export function controllerColor(key: string, hues: readonly string[] = territoryLight.rivalHues): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return hues[h % hues.length]!;
}

/** Soft, readable avatar background for initials, stable per name. */
export function avatarTint(name: string, scheme: Scheme): { bg: string; fg: string } {
  const set =
    scheme === 'dark'
      ? [['#2B2A55', '#C9C7FF'], ['#13304A', '#8CCBFF'], ['#3A2614', '#FFB37A'], ['#173A22', '#86E59A'], ['#3A1838', '#F0A6F5']]
      : [['#ECEBFE', '#3D39B5'], ['#E4F0FD', '#0A5BAA'], ['#FFEEDF', '#9A460C'], ['#E3F6E6', '#1A6E32'], ['#F7E6FB', '#8A2DA6']];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = set[h % set.length]!;
  return { bg: bg!, fg: fg! };
}
