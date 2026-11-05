import { Redirect } from 'expo-router';
import { useSession } from '@/state/session';

/** Entry redirect; the root Stack's protected groups enforce the same rules. */
export default function Index() {
  const { session, profile } = useSession();
  if (!session) return <Redirect href="/welcome" />;
  if (!profile?.onboarding_completed_at) return <Redirect href="/profile-setup" />;
  return <Redirect href="/home" />;
}
