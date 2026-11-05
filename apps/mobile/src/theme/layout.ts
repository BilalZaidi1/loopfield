import { useWindowDimensions } from 'react-native';

/** Phone first. ≥ 700 px gets roomier spacing and two-column grids; ≥ 1024 px swaps the tab bar for a sidebar. */
export const BREAKPOINTS = { tablet: 700, wide: 1024 } as const;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= BREAKPOINTS.tablet;
  const isWide = width >= BREAKPOINTS.wide;
  return {
    width,
    height,
    isTablet,
    isWide,
    landscape: width > height,
    /** Horizontal screen padding. */
    gutter: isTablet ? 28 : 20,
    /** Reading width for content columns. */
    contentMax: isWide ? 980 : isTablet ? 720 : width
  };
}
