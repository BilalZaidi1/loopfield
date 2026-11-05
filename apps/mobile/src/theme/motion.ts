import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export { useReducedMotion } from 'react-native-reanimated';

/** Motion answers a person's action; nothing loops on its own except the ready-to-run pulse. */
export const durations = { fast: 140, base: 220, slow: 420 } as const;
export const springs = {
  press: { damping: 18, stiffness: 340, mass: 0.6 },
  sheet: { damping: 24, stiffness: 240, mass: 0.9 },
  pop: { damping: 12, stiffness: 220, mass: 0.7 }
} as const;

/** Light haptic tick for confirmations (start, pause, finish). Silently skipped where unsupported. */
export function tick(kind: 'light' | 'medium' | 'success' | 'warning' = 'light'): void {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'success' || kind === 'warning'
      ? Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
      : Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => {});
}
