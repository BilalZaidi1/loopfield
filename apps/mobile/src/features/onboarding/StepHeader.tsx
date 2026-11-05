import { View } from 'react-native';
import { Txt } from '@/components/ui';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** "Step n of m" with a segmented progress bar, for the two onboarding steps. */
export function StepHeader({ step, of, title, subtitle }: { step: number; of: number; title: string; subtitle?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: spacing.md, marginTop: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${of}`} accessibilityValue={{ min: 1, max: of, now: step }}>
        {Array.from({ length: of }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: i < step ? p.primaryFill : p.surfaceSunken }} />
        ))}
      </View>
      <Txt variant="label" color="textMuted">{`Step ${step} of ${of}`}</Txt>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="title">{title}</Txt>
        {subtitle ? <Txt color="textMuted">{subtitle}</Txt> : null}
      </View>
    </View>
  );
}
