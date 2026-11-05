import { useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { track } from '@/lib/analytics';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { BarChart } from '@/components/charts';
import { Button, Card, ErrorState, LoadingState, Screen, Section, TextField, Txt } from '@/components/ui';
import { useActivities, weeklyTotals } from '@/features/results/useActivities';
import { getGoals, saveGoals } from '@/health/cache';
import { useUnits } from '@/state/session';

/** S41 Goals and trends — weekly run goals, distance and duration trends, optional perceived effort, descriptive volume. */
export default function Goals() {
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

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Goals and trends' }} />
      <Card accessibilityLabel="Weekly goals">
        <Txt variant="heading">Weekly goals</Txt>
        <TextField label="Runs per week" value={runs} onChangeText={setRuns} keyboardType="number-pad" />
        <TextField label={`Distance per week (${units === 'metric' ? 'km' : 'mi'}, optional)`} value={dist} onChangeText={setDist} keyboardType="number-pad" />
        <Button variant="secondary" label="Save goals" onPress={save} />
        <Txt variant="caption">Goals are kept on this phone.</Txt>
      </Card>
      {acts.isLoading ? <LoadingState /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : (
        <>
          <Card accessibilityLabel="This week">
            <Txt>This week: {thisWeek?.runs ?? 0} runs{goals.weeklyRuns ? ` of ${goals.weeklyRuns}` : ''} · {fmtDistance(thisWeek?.distanceM ?? 0, units, 1)}{goals.weeklyDistanceM ? ` of ${fmtDistance(goals.weeklyDistanceM, units, 0)}` : ''}</Txt>
            <Txt color="textMuted">The previous four weeks averaged {fmtDistance(avg4, units, 1)} per week.</Txt>
            {avgEffort != null ? <Txt variant="caption">Average perceived effort on {efforts.length} rated runs: {avgEffort.toFixed(1)} / 10.</Txt> : <Txt variant="caption">Rate effort on a run’s detail page to see it here.</Txt>}
          </Card>
          <Section title="Last 12 weeks">
            <BarChart title={`Distance per week (${units === 'metric' ? 'km' : 'mi'})`} unit={units === 'metric' ? 'km' : 'mi'} data={weekly.map((w) => ({ label: w.week.slice(5), value: w.distanceM / factor }))} format={(v) => v.toFixed(1)} />
            <BarChart title="Moving time per week (min)" unit="min" data={weekly.map((w) => ({ label: w.week.slice(5), value: w.durationMs / 60_000 }))} format={(v) => v.toFixed(0)} />
            <Txt variant="caption">Descriptive trends from runs recorded in this app. Total time: {fmtDuration(weekly.reduce((t, w) => t + w.durationMs, 0))}.</Txt>
          </Section>
        </>
      )}
    </Screen>
  );
}
