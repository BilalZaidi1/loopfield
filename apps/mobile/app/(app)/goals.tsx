import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { track } from '@/lib/analytics';
import { fmtDay, fmtDistance, fmtDuration } from '@/lib/format';
import { BarChart } from '@/components/charts';
import { Button, Card, ErrorState, IconButton, LoadingState, ProgressBar, ProgressRing, Screen, Section, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { useActivities, weeklyTotals } from '@/features/results/useActivities';
import { getGoals, saveGoals } from '@/health/cache';
import { useUnits } from '@/state/session';

/** S41 Goals and trends — weekly run goals, distance and duration trends, optional perceived effort, descriptive volume. */
export default function Goals() {
  const p = usePalette();
  const units = useUnits();
  const acts = useActivities(12 * 7);
  const [goals, setGoals] = useState(getGoals());
  const [runs, setRuns] = useState(goals.weeklyRuns ? String(goals.weeklyRuns) : '');
  const factor = units === 'metric' ? 1000 : 1609.344;
  const [dist, setDist] = useState(goals.weeklyDistanceM ? String(Math.round(goals.weeklyDistanceM / factor)) : '');
  useEffect(() => track('health_viewed', { screen: 'goals', session_count: 0 }), []);
  const weekly = useMemo(() => weeklyTotals(acts.data ?? [], 12), [acts.data]);
  const efforts = (acts.data ?? []).filter((a) => a.perceived_effort != null);
  const avgEffort = efforts.length ? efforts.reduce((t, a) => t + a.perceived_effort!, 0) / efforts.length : null;
  const last4 = weekly.slice(-5, -1);
  const avg4 = last4.length ? last4.reduce((t, w) => t + w.distanceM, 0) / last4.length : 0;
  const thisWeek = weekly[weekly.length - 1];

  const save = () => {
    const g = { weeklyRuns: runs ? Math.max(1, Math.min(14, Number(runs))) : null, weeklyDistanceM: dist ? Number(dist) * factor : null };
    saveGoals(g);
    setGoals(g);
  };

  const runsN = runs ? Number(runs) : 0;
  const step = (d: number) => setRuns(String(Math.max(1, Math.min(14, (runsN || 0) + d))));
  const unit = units === 'metric' ? 'km' : 'mi';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Goals and trends' }} />
      <Card accessibilityLabel="Weekly goals">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="target" color={p.greenText} size={22} />
          <Txt variant="heading">Weekly goals</Txt>
        </View>
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label">Runs per week</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <IconButton icon="minus" label="One run fewer" variant="soft" onPress={() => step(-1)} disabled={runsN <= 1} />
            <Txt variant="hero" style={{ fontSize: 56, lineHeight: 60, minWidth: 64, textAlign: 'center' }} accessibilityLabel={`${runsN || 'No'} runs per week`}>{runs || '–'}</Txt>
            <IconButton icon="plus" label="One run more" variant="soft" onPress={() => step(1)} disabled={runsN >= 14} />
          </View>
        </View>
        <TextField label={`Distance per week (${unit}, optional)`} value={dist} onChangeText={setDist} keyboardType="number-pad" />
        <Button label="Save goals" icon="check" onPress={save} />
        <Txt variant="caption">{Platform.OS === 'web' ? 'Goals are kept in this browser.' : 'Goals are kept on this phone.'}</Txt>
      </Card>
      {acts.isLoading ? <LoadingState variant="cards" /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : (
        <>
          <Card tone="green" accessibilityLabel="This week">
            <Txt variant="heading">This week</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
              <ProgressRing value={goals.weeklyRuns ? (thisWeek?.runs ?? 0) / goals.weeklyRuns : 0} size={84} tone="ink" label="Runs against your weekly goal">
                <Txt variant="metric" style={{ fontSize: 24, lineHeight: 28 }}>{goals.weeklyRuns ? `${thisWeek?.runs ?? 0}/${goals.weeklyRuns}` : String(thisWeek?.runs ?? 0)}</Txt>
              </ProgressRing>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Txt variant="bodyStrong">{`${thisWeek?.runs ?? 0} runs · ${fmtDistance(thisWeek?.distanceM ?? 0, units, 1)}${goals.weeklyDistanceM ? ` of ${fmtDistance(goals.weeklyDistanceM, units, 0)}` : ''}`}</Txt>
                {goals.weeklyDistanceM ? <ProgressBar value={(thisWeek?.distanceM ?? 0) / goals.weeklyDistanceM} label="Distance against your weekly goal" /> : null}
                <Txt color="textMuted">{`The previous four weeks averaged ${fmtDistance(avg4, units, 1)} per week.`}</Txt>
              </View>
            </View>
            {avgEffort != null ? <Txt variant="caption">Average perceived effort on {efforts.length} rated runs: {avgEffort.toFixed(1)} / 10.</Txt> : <Txt variant="caption">Rate effort on a run’s detail page to see it here.</Txt>}
          </Card>
          <Section title="Last 12 weeks" icon="progress">
            <Card>
              <Txt variant="label" color="textMuted">{`Distance per week (${unit})`}</Txt>
              <BarChart title={`Distance per week (${unit})`} unit={unit} data={weekly.map((w) => ({ label: fmtDay(w.week), value: w.distanceM / factor }))} format={(v) => v.toFixed(1)} />
            </Card>
            <Card>
              <Txt variant="label" color="textMuted">Moving time per week (min)</Txt>
              <BarChart title="Moving time per week (min)" unit="min" data={weekly.map((w) => ({ label: fmtDay(w.week), value: w.durationMs / 60_000 }))} format={(v) => v.toFixed(0)} />
            </Card>
            <Txt variant="caption">Descriptive trends from runs recorded in this app. Total time: {fmtDuration(weekly.reduce((t, w) => t + w.durationMs, 0))}.</Txt>
          </Section>
        </>
      )}
    </Screen>
  );
}
