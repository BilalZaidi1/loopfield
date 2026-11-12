import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { LoadingState, Screen } from '@/components/ui';

/**
 * The Record tab is a doorway: the tab button opens the full-screen recorder directly, and a link to
 * /record (with an optional speed route) lands on Home with the recorder opened over it.
 */
export default function RecordTab() {
  const { course } = useLocalSearchParams<{ course?: string }>();
  useEffect(() => {
    router.navigate('/home');
    router.push({ pathname: '/run/active', params: course ? { course } : {} });
  }, [course]);
  return (
    <Screen>
      <LoadingState variant="cards" />
    </Screen>
  );
}
