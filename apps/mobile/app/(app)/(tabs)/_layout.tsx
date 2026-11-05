import { Tabs } from 'expo-router';
import { AppTabBar } from '@/components/TabBar';
import { useFirstRunTour } from '@/features/onboarding/tour';
import { useSession } from '@/state/session';
import { useLayout } from '@/theme/layout';
import { useReducedMotion } from '@/theme/motion';
import { usePalette } from '@/theme/tokens';

/** Main navigation: Home · Map · Record · Progress · Clubs (PRD Appendix D). Bottom bar on phones, sidebar on wide screens. */
const TABS: { name: string; title: string }[] = [
  { name: 'home', title: 'Home' },
  { name: 'map', title: 'Map' },
  { name: 'record', title: 'Record' },
  { name: 'progress', title: 'Progress' },
  { name: 'clubs', title: 'Clubs' }
];

export default function TabsLayout() {
  const p = usePalette();
  const { isWide } = useLayout();
  const reduce = useReducedMotion();
  const { userId } = useSession();
  useFirstRunTour(userId);
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarPosition: isWide ? 'left' : 'bottom', sceneStyle: { backgroundColor: p.bg }, animation: reduce ? 'none' : 'fade' }}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}
