import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { effortText, useRunEffort } from '@/health/training';
import { spacing, usePalette } from '@/theme/tokens';

/**
 * A run's effort score (R2) on the run summary and the run's detail page: the score, how it compares with the
 * last eight weeks, and how it was worked out. Worked out on this phone; hidden while training is paused.
 */
export function EffortLine({ runId, fallback }: { runId: string | null | undefined; fallback?: { start: number; durationMs: number; distanceM: number } | null }) {
  const p = usePalette();
  const effort = useRunEffort(runId, fallback);
  if (!effort) return null;
  const text = effortText(effort);
  return (
    <Pressable onPress={() => router.push('/health/training')} accessibilityRole="button"
      accessibilityLabel={`Effort ${text.value}. ${text.detail}. For training, not medical advice. Open training`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md }}>
      <Icon name="pulse" color={p.textMuted} size={22} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">Effort</Txt>
        <Txt variant="caption">{text.detail}</Txt>
      </View>
      <Txt variant="bodyStrong" tabular>{text.value}</Txt>
    </Pressable>
  );
}
