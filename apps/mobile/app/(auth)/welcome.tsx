import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Screen, Txt } from '@/components/ui';
import { spacing, usePalette } from '@/theme/tokens';

/** S01 Welcome — territory, speed, social and health introduction; Get Started and Log In. */
const PILLARS = [
  { title: 'Claim land with loops', body: 'Start a capture, run a loop anywhere and close it near where you began. The newest eligible loop takes the cells it fully encloses.' },
  { title: 'Hold route titles', body: 'Race approved routes in their set direction. Titles are separate from land and change hands only with a clear margin.' },
  { title: 'Run with people', body: 'Follow runners, join clubs you choose and message people who allow it. You decide who sees each post.' },
  { title: 'Your health, on your phone', body: 'Optionally connect Apple Health or Health Connect for a private dashboard. Health data never leaves this phone.' }
];

export default function Welcome() {
  const p = usePalette();
  return (
    <Screen>
      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <Txt variant="display" accessibilityRole="header">Loopfield</Txt>
        <Txt color="textMuted">Running territory and route titles for adults in supported cities. Pilot rules are proposed and may change after field testing.</Txt>
      </View>
      <View style={{ gap: spacing.md, marginVertical: spacing.xl }}>
        {PILLARS.map((x) => (
          <Card key={x.title}>
            <Txt variant="heading">{x.title}</Txt>
            <Txt color="textMuted">{x.body}</Txt>
          </Card>
        ))}
      </View>
      <View style={{ gap: spacing.md, paddingBottom: spacing.xl, borderTopColor: p.border }}>
        <Button label="Get started" onPress={() => router.push('/sign-up')} />
        <Button label="Log in" variant="secondary" onPress={() => router.push('/sign-in')} />
      </View>
    </Screen>
  );
}
