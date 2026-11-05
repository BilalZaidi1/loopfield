import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { springs, useReducedMotion } from '@/theme/motion';
import { Txt } from './ui';

/**
 * The Loopfield mark: an open loop with a runner's dot at the gap, the moment before a loop closes and
 * claims ground. Same geometry as the app icon and native splash, in the new colours.
 */
export function LoopMark({ size = 48, ring = '#6762F0', dot = '#FF7A1A' }: { size?: number; ring?: string; dot?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M82.84 41.2 A34 34 0 1 1 67 20.56" stroke={ring} strokeWidth={11} strokeLinecap="round" fill="none" />
      <Circle cx={67} cy={20.56} r={7.5} fill={dot} />
    </Svg>
  );
}

export function Wordmark({ size = 24, color }: { size?: number; color?: string }) {
  return (
    <Txt variant="display" style={{ fontSize: size, lineHeight: size * 1.1, letterSpacing: -size * 0.03, ...(color ? { color } : null) }} accessibilityRole="header">
      Loopfield
    </Txt>
  );
}

const SPLASH_BG = '#101114';

/**
 * Start-up moment shown over the first screen: the loop swings closed, the dot lands, the name rises,
 * then everything fades to the app. It takes over from the native splash (same dark ground and mark
 * position) and stays until the app is ready. With Reduce Motion on, the mark is shown still.
 */
export function BrandSplash({ ready, fontsReady, onDone }: { ready: boolean; fontsReady: boolean; onDone: () => void }) {
  const reduce = useReducedMotion();
  const ring = useSharedValue(reduce ? 1 : 0);
  const dot = useSharedValue(reduce ? 1 : 0);
  const word = useSharedValue(reduce ? 1 : 0);
  const fade = useSharedValue(1);
  const [introDone, setIntroDone] = useState(reduce);
  const hidNative = useRef(false);

  useEffect(() => {
    if (reduce) return;
    ring.value = withSpring(1, { damping: 14, stiffness: 120, mass: 0.8 });
    dot.value = withDelay(380, withSpring(1, springs.pop));
    word.value = withDelay(520, withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setIntroDone)(true);
    }));
  }, [reduce, ring, dot, word]);

  useEffect(() => {
    if (!ready || !introDone) return;
    fade.value = withDelay(reduce ? 0 : 160, withTiming(0, { duration: reduce ? 150 : 320 }, (finished) => {
      if (finished) runOnJS(onDone)();
    }));
  }, [ready, introDone, reduce, fade, onDone]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, ring.value * 1.6),
    transform: [{ rotate: `${(1 - ring.value) * -110}deg` }, { scale: 0.82 + ring.value * 0.18 }]
  }));
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.value }] }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 14 }] }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents={ready && introDone ? 'none' : 'auto'}
      accessibilityLabel="Loopfield is starting"
      accessibilityRole="progressbar"
      onLayout={() => {
        if (hidNative.current) return;
        hidNative.current = true;
        void SplashScreen.hideAsync().catch(() => {});
      }}
      style={[StyleSheet.absoluteFill, styles.root, rootStyle]}>
      <View style={styles.markBox}>
        <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
          <Svg width={158} height={158} viewBox="0 0 100 100">
            <Path d="M82.84 41.2 A34 34 0 1 1 67 20.56" stroke="#6762F0" strokeWidth={11} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.dot, dotStyle]} />
      </View>
      {fontsReady ? (
        <Animated.View style={[styles.word, wordStyle]}>
          <Wordmark size={30} color="#F5F6FA" />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  markBox: { width: 158, height: 158 },
  // Dot centre sits at (67, 20.56) of the 100-unit mark: 105.9 px, 32.5 px at 158 px.
  dot: { position: 'absolute', left: 105.9 - 11.85, top: 32.5 - 11.85, width: 23.7, height: 23.7, borderRadius: 12, backgroundColor: '#FF7A1A' },
  word: { position: 'absolute', top: '50%', marginTop: 96 }
});
