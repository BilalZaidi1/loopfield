import Svg, { Circle, Path, Polygon } from 'react-native-svg';

/** Original, minimal line icons for the five main destinations. */
export type IconName = 'home' | 'map' | 'record' | 'progress' | 'clubs' | 'bell' | 'chat' | 'search' | 'plus';

export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const sw = 2;
  const common = { stroke: color, strokeWidth: sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {name === 'home' ? <Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" {...common} /> : null}
      {name === 'map' ? <Polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" {...common} /> : null}
      {name === 'record' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Circle cx={12} cy={12} r={4} fill={color} stroke="none" />
        </>
      ) : null}
      {name === 'progress' ? <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...common} /> : null}
      {name === 'clubs' ? (
        <>
          <Circle cx={8} cy={9} r={3} {...common} />
          <Circle cx={16} cy={9} r={3} {...common} />
          <Path d="M2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5" {...common} />
        </>
      ) : null}
      {name === 'bell' ? <Path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" {...common} /> : null}
      {name === 'chat' ? <Path d="M4 5h16v11H9l-5 4z" {...common} /> : null}
      {name === 'search' ? (
        <>
          <Circle cx={11} cy={11} r={7} {...common} />
          <Path d="M21 21l-5-5" {...common} />
        </>
      ) : null}
      {name === 'plus' ? <Path d="M12 5v14M5 12h14" {...common} /> : null}
    </Svg>
  );
}
