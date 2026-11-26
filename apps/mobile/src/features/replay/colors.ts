/**
 * Pace shades for the replay line: one blue hue, slowest to fastest (validated as an ordinal ramp against each
 * map's background: monotone lightness, visible steps, the faint end clearing 2:1). On the light map faster is
 * darker; on the dark map faster is brighter. A kilometre with a pause or gap in it has no pace and is grey.
 */
export const PACE_SHADES = {
  light: ['#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  dark: ['#184f95', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6']
} as const;

export const NO_PACE = { light: '#8A8F9E', dark: '#7A7E8C' } as const;

export function shadeColor(shade: number | null, scheme: 'light' | 'dark'): string {
  if (shade === null) return NO_PACE[scheme];
  const ramp = PACE_SHADES[scheme];
  return ramp[Math.min(ramp.length - 1, Math.max(0, shade))]!;
}
