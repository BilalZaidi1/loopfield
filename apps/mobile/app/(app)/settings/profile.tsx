import { router, Stack } from 'expo-router';
import { LoadingState, Screen } from '@/components/ui';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { useSession } from '@/state/session';

/** Edit profile (from S35 / S43): name, handle, avatar, bio, city, units and visibility. */
export default function EditProfile() {
  const { profile, settings } = useSession();
  if (!profile || !settings) return <LoadingState />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Edit profile' }} />
      <ProfileForm profile={profile} units={settings.units} submitLabel="Save" onSaved={() => router.back()} />
    </Screen>
  );
}
