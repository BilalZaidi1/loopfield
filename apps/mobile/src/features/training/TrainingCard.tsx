import { View } from 'react-native';
import { router } from 'expo-router';
import { Card, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useTraining } from '@/health/training';
import { spacing, usePalette } from '@/theme/tokens';
import { balanceWord } from './text';

/** The Progress tab's Training card (R2): the two loads and the balance; opens the Training screen. */
export function TrainingCard() {
  const p = usePalette();
  const t = useTraining();
  if (!t.enabled || t.loading || !t.summary || !t.summary.runsCounted) return null;
  const s = t.summary;
  const line = s.balanceReady ? `${balanceWord(s.balance)} · balance ${Math.round(s.balance)}` : 'Balance shows after about three weeks of runs';
  return (
    <Card onPress={() => router.push('/health/training')} accessibilityLabel={`Training. 6-week load ${Math.round(s.long)}, 7-day load ${Math.round(s.short)}. ${line}. Open training and race predictions`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="headline">Training</Txt>
          <Txt color="textMuted">{`6-week load ${Math.round(s.long)} · 7-day load ${Math.round(s.short)}`}</Txt>
          <Txt variant="caption">{line}</Txt>
        </View>
        <Icon name="chevron-right" color={p.textSubtle} size={22} />
      </View>
    </Card>
  );
}
