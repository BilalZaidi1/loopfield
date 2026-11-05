import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Button, Card, ErrorState, LoadingState, Row, Screen, Section, Segmented, StatTile, Txt } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { TopBar } from '@/components/TopBar';
import { fmtDate, fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { personalBests, useActivities, weeklyTotals } from '@/features/results/useActivities';
import { getGoals } from '@/health/cache';
import { PLATFORM_LABEL, STALE_AFTER_MS } from '@/health/sync';
import { useHealthConnection } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/** S36 Progress overview — Activities and Health views, date range, goals, running trends and personal bests. */
export default function Progress() {
  const units = useUnits();
  const [view, setView] = useState<'activities' | 'health'>('activities');
  const [range, setRange] = useState<'28' | '90' | '365'>('90');
  const acts = useActivities(Number(range));
  const health = useHealthConnection();
  const now = useNow();
  const goals = getGoals();
  const weeks = range === '28' ? 4 : range === '90' ? 13 : 52;
  const weekly = useMemo(() => weeklyTotals(acts.data ?? [], weeks), [acts.data, weeks]);
  const pbs = useMemo(() => personalBests(acts.data ?? []), [acts.data]);
  const totals = useMemo(() => (acts.data ?? []).reduce((t, r) => ({ runs: t.runs + 1, d: t.d + (r.distance_m ?? 0), ms: t.ms + (r.moving_ms ?? r.elapsed_ms ?? 0) }), { runs: 0, d: 0, ms: 0 }), [acts.data]);
  const thisWeek = weekly[weekly.length - 1];
  const factor = units === 'metric' ? 1000 : 1609.344;

  return (
    <Screen>
      <TopBar title="Progress" showSocial={false} />
      <Segmented label="Progress view" value={view} onChange={setView} options={[{ value: 'activities', label: 'Activities' }, { value: 'health', label: 'Health' }]} />
      {view === 'activities' ? (
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: '28', label: '4 weeks' }, { value: '90', label: '3 months' }, { value: '365', label: '1 year' }]} />
          {acts.isLoading ? <LoadingState /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : (
            <>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <StatTile label="Runs" value={String(totals.runs)} />
                <StatTile label="Distance" value={fmtDistance(totals.d, units, 1)} />
                <StatTile label="Moving time" value={fmtDuration(totals.ms)} />
              </View>
              <Card accessibilityLabel="Weekly goal">
                <Txt variant="heading">This week</Txt>
                <Txt>{thisWeek?.runs ?? 0} of {goals.weeklyRuns ?? '—'} runs{goals.weeklyDistanceM ? ` · ${fmtDistance(thisWeek?.distanceM ?? 0, units, 1)} of ${fmtDistance(goals.weeklyDistanceM, units, 0)}` : ''}</Txt>
                <Button variant="ghost" label="Goals and trends" onPress={() => router.push('/goals')} />
              </Card>
              <BarChart
                title={`Weekly distance (${units === 'metric' ? 'km' : 'mi'})`}
                unit={units === 'metric' ? 'km' : 'mi'}
                data={weekly.map((w) => ({ label: w.week.slice(5), value: w.distanceM / factor }))}
                format={(v) => v.toFixed(1)}
              />
              <Section title="Personal bests">
                {totals.runs === 0 ? <Txt color="textMuted">Record a run to see personal bests.</Txt> : null}
                {pbs.longest ? <Row title="Longest run" subtitle={fmtDate(pbs.longest.started_at)} right={<Txt variant="label">{fmtDistance(pbs.longest.distance_m, units)}</Txt>} onPress={() => router.push({ pathname: '/activities/[id]', params: { id: pbs.longest!.id } })} /> : null}
                {pbs.fastest5k ? <Row title="Fastest average pace (5 km or longer)" subtitle={fmtDate(pbs.fastest5k.started_at)} right={<Txt variant="label">{fmtPace(pbs.fastest5k.avg_pace_s_per_km, units)}</Txt>} onPress={() => router.push({ pathname: '/activities/[id]', params: { id: pbs.fastest5k!.id } })} /> : null}
                {pbs.longestTime ? <Row title="Longest moving time" subtitle={fmtDate(pbs.longestTime.started_at)} right={<Txt variant="label">{fmtDuration(pbs.longestTime.moving_ms)}</Txt>} /> : null}
              </Section>
              <Button variant="secondary" label="Activity history" onPress={() => router.push('/activities')} />
              <Button variant="secondary" label="Season history" onPress={() => router.push('/seasons')} />
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <Card accessibilityLabel="Health connection">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt variant="heading">{PLATFORM_LABEL}</Txt>
              <Badge label={health.connected ? (health.lastSyncAt && now - health.lastSyncAt > STALE_AFTER_MS ? 'Stale' : 'Connected') : 'Not connected'} tone={health.connected ? 'success' : 'muted'} />
            </View>
            <Txt color="textMuted">Health data stays on this phone. It is never uploaded, shared or used for competition.</Txt>
            {health.connected ? <Button label="Open health dashboard" onPress={() => router.push('/health')} /> : <Button label={`Connect ${PLATFORM_LABEL}`} onPress={() => router.push('/health/connections')} />}
          </Card>
          <Button variant="secondary" label="Heart rate zones" onPress={() => router.push('/health/zones')} />
          <Button variant="secondary" label="Goals and trends" onPress={() => router.push('/goals')} />
        </View>
      )}
    </Screen>
  );
}
