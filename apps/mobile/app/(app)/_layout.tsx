import { Stack } from 'expo-router';
import { StackHeader } from '@/components/StackHeader';
import { useReducedMotion } from '@/theme/motion';
import { usePalette } from '@/theme/tokens';

/** Signed-in app: the five-tab shell plus reusable detail screens pushed on top. */
export default function AppLayout() {
  const p = usePalette();
  const reduce = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        header: (props) => <StackHeader {...props} />,
        contentStyle: { backgroundColor: p.bg },
        animation: reduce ? 'fade' : 'default'
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New post' }} />
      <Stack.Screen name="tour" options={{ headerShown: false, presentation: 'fullScreenModal', animation: reduce ? 'fade' : 'slide_from_bottom' }} />
      <Stack.Screen name="run/active" options={{ headerShown: false, gestureEnabled: false, animation: reduce ? 'fade' : 'slide_from_bottom' }} />
    </Stack>
  );
}
