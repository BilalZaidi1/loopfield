import { Stack } from 'expo-router';
import { usePalette } from '@/theme/tokens';

/** Signed-in app: the five-tab shell plus reusable detail screens pushed on top. */
export default function AppLayout() {
  const p = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: p.surface },
        headerTintColor: p.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: p.bg },
        headerBackButtonDisplayMode: 'minimal'
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New post' }} />
      <Stack.Screen name="run/active" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
