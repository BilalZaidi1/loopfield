import { Stack } from 'expo-router';
import { useReducedMotion } from '@/theme/motion';

export default function AuthLayout() {
  const reduce = useReducedMotion();
  return <Stack screenOptions={{ headerShown: false, animation: reduce ? 'fade' : 'default' }} />;
}
