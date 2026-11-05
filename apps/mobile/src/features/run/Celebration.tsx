import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { useReducedMotion } from '@/theme/motion';

const COLORS = ['#FFFFFF', '#FF7A1A', '#5CC86A', '#FFE27A', '#D57AF0'];
const PARTS = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : 0),
  dist: 70 + (i % 4) * 22,
  size: 6 + (i % 3) * 3,
  color: COLORS[i % COLORS.length]!,
  square: i % 3 === 0
}));

function Particle({ p, progress }: { p: (typeof PARTS)[number]; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const v = progress.value;
    return {
      opacity: v < 0.15 ? v / 0.15 : 1 - (v - 0.15) / 0.85,
      transform: [{ translateX: Math.cos(p.angle) * p.dist * v }, { translateY: Math.sin(p.angle) * p.dist * v + 30 * v * v }, { rotate: `${v * 240}deg` }]
    };
  });
  return <Animated.View style={[styles.part, { width: p.size, height: p.size, borderRadius: p.square ? 2 : p.size / 2, backgroundColor: p.color }, style]} />;
}

/** One short burst of confetti when a run is saved. Nothing at all with Reduce Motion on. */
export function Celebration() {
  const reduce = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!reduce) progress.value = withDelay(150, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }));
  }, [reduce, progress]);
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={styles.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {PARTS.map((p, i) => (
        <Particle key={i} p={p} progress={progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 48, right: 64, width: 1, height: 1, alignItems: 'center', justifyContent: 'center' },
  part: { position: 'absolute' }
});
