import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { PressableScale, Txt } from '@/components/ui';
import { tick, useReducedMotion } from '@/theme/motion';
import { useTheme } from '@/theme/tokens';

/**
 * The big round start button with two slow sonar rings while it is ready (still when Reduce Motion is on).
 * Without `halo` it takes only its own size (the rings spill over), for the recorder's bottom panel.
 */
export function GoButton({ label = 'GO!', accessibilityLabel, onPress, disabled, busy, size = 132, halo = true }: {
  label?: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  size?: number;
  halo?: boolean;
}) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const live = !disabled && !busy && !reduce;
  useEffect(() => {
    if (!live) {
      a.value = 0;
      b.value = 0;
      return;
    }
    a.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1);
    b.value = withDelay(1100, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1));
  }, [live, a, b]);
  const ringA = useAnimatedStyle(() => ({ opacity: live ? 0.5 * (1 - a.value) : 0, transform: [{ scale: 1 + a.value * 0.55 }] }));
  const ringB = useAnimatedStyle(() => ({ opacity: live ? 0.5 * (1 - b.value) : 0, transform: [{ scale: 1 + b.value * 0.55 }] }));
  const fill = disabled ? '#3A3C45' : t.palette.primaryFill;
  return (
    <View style={{ width: halo ? size * 1.7 : size + 24, height: halo ? size * 1.7 : size + 24, alignItems: 'center', justifyContent: 'center' }}>
      {halo ? <View style={[styles.halo, { width: size * 1.42, height: size * 1.42, borderRadius: size, backgroundColor: 'rgba(255,255,255,0.06)' }]} /> : null}
      <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: t.palette.primaryFill }, ringA]} />
      <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: t.palette.primaryFill }, ringB]} />
      <PressableScale
        onPress={() => {
          tick('medium');
          onPress();
        }}
        disabled={disabled || busy}
        scaleTo={0.94}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center', boxShadow: disabled ? undefined : '0px 12px 32px rgba(91,87,227,0.55)' }}>
        <Txt variant="display" style={{ color: disabled ? '#8A8F9E' : '#FFFFFF', fontSize: size * 0.3, lineHeight: size * 0.34 }}>{busy ? '…' : label}</Txt>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 3 }
});
