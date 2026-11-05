import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Button, Screen, Txt } from '@/components/ui';
import { LoopMark, Wordmark } from '@/components/Brand';
import { HexBoard } from '@/features/onboarding/Illustrations';
import { useLayout } from '@/theme/layout';
import { spacing, usePalette } from '@/theme/tokens';

/** S01 Welcome — territory, speed, social and health introduction; Get started and Log in stay pinned on screen. */
export default function Welcome() {
  const p = usePalette();
  const { height, isTablet } = useLayout();
  const compact = height < 740;
  return (
    <Screen
      maxWidth={560}
      gap={compact ? spacing.md : spacing.xl}
      footer={
        <>
          <Button label="Get started" size="lg" arrow onPress={() => router.push('/sign-up')} />
          <Button label="I have an account" variant="ghost" size="lg" onPress={() => router.push('/sign-in')} />
        </>
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
        <LoopMark size={30} ring={p.primaryFill} dot={p.orange} />
        <Wordmark size={22} />
      </View>
      <HexBoard variant="claim" height={compact ? 170 : isTablet ? 280 : 230} />
      <View style={{ gap: spacing.md }}>
        <Txt variant="display" style={compact ? { fontSize: 34, lineHeight: 36 } : undefined}>{'RUN A LOOP.\nCLAIM THE GROUND.'}</Txt>
        <Txt color="textMuted">Loopfield turns the loops you run into territory on a shared map. Hold your ground, race route titles and run with your clubs.</Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Badge label="Claim land with loops" tone="violet" icon="hexagon" />
        <Badge label="Hold route titles" tone="title" icon="trophy" />
        <Badge label="Run with clubs" tone="success" icon="clubs" />
        <Badge label="Health stays on your phone" tone="info" icon="lock" />
      </View>
      <Txt variant="caption">For adults in supported pilot cities. Competition rules are proposed and may change after field testing.</Txt>
    </Screen>
  );
}
