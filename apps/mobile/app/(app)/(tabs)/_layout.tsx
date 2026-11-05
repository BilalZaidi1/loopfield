import { Tabs } from 'expo-router';
import { Icon, type IconName } from '@/components/icons';
import { usePalette } from '@/theme/tokens';

/** Main navigation: Home · Map · Record · Progress · Clubs (PRD Appendix D). */
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'home', title: 'Home', icon: 'home' },
  { name: 'map', title: 'Map', icon: 'map' },
  { name: 'record', title: 'Record', icon: 'record' },
  { name: 'progress', title: 'Progress', icon: 'progress' },
  { name: 'clubs', title: 'Clubs', icon: 'clubs' }
];

export default function TabsLayout() {
  const p = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.textMuted,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border, minHeight: 56 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' }
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarAccessibilityLabel: t.title, tabBarIcon: ({ color }) => <Icon name={t.icon} color={String(color)} /> }}
        />
      ))}
    </Tabs>
  );
}
