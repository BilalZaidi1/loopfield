import { useColorScheme } from 'react-native';

/**
 * Original visual identity: deep forest base, bright "trail" green for land, amber for speed titles.
 * Contrast targets WCAG AA (4.5:1) for text in both schemes for outdoor readability.
 */
const light = {
  bg: '#F5F7F4',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EEE9',
  text: '#0E1A14',
  textMuted: '#40524A',
  border: '#C5D1C9',
  primary: '#1F6F4A',
  primaryText: '#FFFFFF',
  accent: '#B5770C',
  danger: '#B3261E',
  warning: '#8A5A00',
  success: '#1F6F4A',
  info: '#1D5C8C',
  land: '#2E8B57',
  landMine: '#155E3B',
  title: '#B5770C',
  unavailable: '#6B6B6B',
  overlay: 'rgba(14,26,20,0.55)'
};

const dark: typeof light = {
  bg: '#0E1A14',
  surface: '#16261E',
  surfaceAlt: '#1E3228',
  text: '#F2F7F3',
  textMuted: '#B4C6BC',
  border: '#33493E',
  primary: '#7CE0A0',
  primaryText: '#0E1A14',
  accent: '#F4C448',
  danger: '#FF8A80',
  warning: '#F4C448',
  success: '#7CE0A0',
  info: '#8EC5F0',
  land: '#5CC98A',
  landMine: '#A8F0C4',
  title: '#F4C448',
  unavailable: '#9A9A9A',
  overlay: 'rgba(0,0,0,0.6)'
};

export type Palette = typeof light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const type = {
  display: { fontSize: 34, fontWeight: '800' as const, lineHeight: 40 },
  title: { fontSize: 24, fontWeight: '700' as const, lineHeight: 30 },
  heading: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 18 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  metric: { fontSize: 44, fontWeight: '800' as const, lineHeight: 50, fontVariant: ['tabular-nums' as const] }
};

/** Minimum touch target (dp) used by all interactive components. */
export const TOUCH = 48;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Distinct controller hues for rival land; never the only signal (outline style + list alternative). */
export const CONTROLLER_HUES = ['#3B82C4', '#C2410C', '#7C3AED', '#0F766E', '#BE185D', '#4D7C0F', '#9A3412', '#1D4ED8'];

export function controllerColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CONTROLLER_HUES[h % CONTROLLER_HUES.length]!;
}
