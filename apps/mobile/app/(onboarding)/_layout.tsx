import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'profile-setup' };

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
