import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, BigNumber, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Medal, ProgressRing, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BarChart } from '@/components/charts';
import { TopBar } from '@/components/TopBar';
import { fmtDate, fmtDay, fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { personalBests, useActivities, weeklyTotals } from '@/features/results/useActivities';
import { getGoals } from '@/health/cache';
import { PLATFORM_LABEL, STALE_AFTER_MS, UNAVAILABLE_BADGE } from '@/health/sync';
import { useHealthAvailability, useHealthConnection } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S36 Progress overview — Activities and Health views, date range, goals, running trends and personal bests. */
export default function Progress() {
  const p = usePalette();
  const units = useUnits();
  const [view, setView] = useState<'activities' | 'health'>('activities');
  const [range, setRange] = useState<'28' | '90' | '365'>('90');
  const acts = useActivities(Number(range));
  const health = useHealthConnection();
  const availability = useHealthAvailability();
  const healthAvailable = availability !== 'unavailable';
  const now = useNow();
  const goals = getGoals();
  const weeks = range === '28' ? 4 : range === '90' ? 13 : 52;
  const weekly = useMemo(() => weeklyTotals(acts.data ?? [], weeks), [acts.data, weeks]);
  const pbs = useMemo(() => personalBests(acts.data ?? []), [acts.data]);
  const totals = useMemo(() => (acts.data ?? []).reduce((t, r) => ({ runs: t.runs + 1, d: t.d + (r.distance_m ?? 0), ms: t.ms + (r.moving_ms ?? r.elapsed_ms ?? 0) }), { runs: 0, d: 0, ms: 0 }), [acts.data]);
  const thisWeek = weekly[weekly.length - 1];
  const factor = units === 'metric' ? 1000 : 1609.344;

  const dist = splitValue(fmtDistance(totals.d, units, 1));
  const goalRuns = goals.weeklyRuns ?? 0;
  const runsThisWeek = thisWeek?.runs ?? 0;

  return (
    <Screen onRefresh={() => void acts.refetch()} refreshing={acts.isRefetching}>
      <TopBar title="Progress" showSocial={false} />
      <Segmented label="Progress view" value={view} onChange={setView} options={[{ value: 'activities', label: 'Activities' }, { value: 'health', label: 'Health' }]} />
      {view === 'activities' ? (
        <>
          <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: '28', label: '4 weeks' }, { value: '90', label: '3 months' }, { value: '365', label: '1 year' }]} />
          {acts.isLoading ? <LoadingState variant="cards" /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : (
            <>
              <Card tone="violet" accessibilityLabel={`${dist.value} ${dist.unit} over ${totals.runs} runs`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Icon name="progress" color="#FFFFFF" size={22} />
                  <Txt variant="heading" style={{ flex: 1 }}>{range === '28' ? 'Last 4 weeks' : range === '90' ? 'Last 3 months' : 'Last 12 months'}</Txt>
                </View>
                <BigNumber value={dist.value} unit={dist.unit} />
                <Txt color="textMuted">{`${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'} · ${fmtDuration(totals.ms)} moving`}</Txt>
                <BarChart
                  title={`Weekly distance (${units === 'metric' ? 'km' : 'mi'})`}
                  unit={units === 'metric' ? 'km' : 'mi'}
                  height={110}
                  data={weekly.map((w, i) => ({ label: fmtDay(w.week), value: w.distanceM / factor, current: i === weekly.length - 1 }))}
                  format={(v) => v.toFixed(1)}
                  table={{ period: 'Week of', series: units === 'metric' ? 'Distance (km)' : 'Distance (mi)', currentTag: 'This week', total: true }}
                />
              </Card>
              <Card onPress={() => router.push('/goals')} accessibilityLabel={`Weekly goal: ${runsThisWeek} of ${goalRuns || 'no'} runs. Open goals and trends`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                  <ProgressRing value={goalRuns ? runsThisWeek / goalRuns : 0} size={76} tone="green" label="Weekly run goal">
                    <Txt variant="metric" style={{ fontSize: 22, lineHeight: 26 }}>{goalRuns ? `${runsThisWeek}/${goalRuns}` : String(runsThisWeek)}</Txt>
                  </ProgressRing>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="headline">This week</Txt>
                    <Txt color="textMuted">
                      {goalRuns ? `${runsThisWeek} of ${goalRuns} runs` : `${runsThisWeek} runs · no goal set`}
                      {goals.weeklyDistanceM ? ` · ${fmtDistance(thisWeek?.distanceM ?? 0, units, 1)} of ${fmtDistance(goals.weeklyDistanceM, units, 0)}` : ''}
                    </Txt>
                  </View>
                  <Icon name="chevron-right" color={p.textSubtle} size={22} />
                </View>
              </Card>
              <Section title="Personal bests" icon="medal">
                {totals.runs === 0 ? (
                  <EmptyState icon="medal" title="No personal bests yet" body="Record a run and your bests appear here." action={{ label: 'Start a run', onPress: () => router.push('/run/active') }} />
                ) : (
                  <ListGroup>
                    {pbs.longest ? <Row leading={<Medal label={splitValue(fmtDistance(pbs.longest.distance_m, units, pbs.longest.distance_m && pbs.longest.distance_m >= 10000 ? 0 : 1)).value} tone="violet" size={52} />} title="Longest run" subtitle={fmtDate(pbs.longest.started_at)} value={fmtDistance(pbs.longest.distance_m, units)} onPress={() => router.push({ pathname: '/activities/[id]', params: { id: pbs.longest!.id } })} /> : null}
                    {pbs.fastest5k ? <Row leading={<Medal label="5K+" tone="orange" size={52} />} title="Fastest pace, 5 km or longer" subtitle={fmtDate(pbs.fastest5k.started_at)} value={fmtPace(pbs.fastest5k.avg_pace_s_per_km, units)} onPress={() => router.push({ pathname: '/activities/[id]', params: { id: pbs.fastest5k!.id } })} /> : null}
                    {pbs.longestTime ? <Row leading={<Medal label={`${Math.round((pbs.longestTime.moving_ms ?? 0) / 60000)}′`} tone="blue" size={52} />} title="Longest moving time" subtitle={fmtDate(pbs.longestTime.started_at)} value={fmtDuration(pbs.longestTime.moving_ms)} onPress={() => router.push({ pathname: '/activities/[id]', params: { id: pbs.longestTime!.id } })} /> : null}
                  </ListGroup>
                )}
              </Section>
              <ListGroup>
                <Row icon="trophy" title="Challenges and badges" subtitle="Progress toward every badge" onPress={() => router.push('/achievements')} />
                <Row icon="medal" title="Global ranking" subtitle="Ranked by badges, never by points" onPress={() => router.push('/achievements/ranking')} />
                <Row icon="bolt" title="Movement points" subtitle="Earned on every verified run; reclaim lost ground" onPress={() => router.push('/points')} />
                <Row icon="record" title="Activity history" subtitle="Every run, month by month" onPress={() => router.push('/activities')} />
                <Row icon="calendar" title="Season history" subtitle="Past standings and route titles" onPress={() => router.push('/seasons')} />
                <Row icon="target" title="Goals and trends" subtitle="Weekly goals and 12-week trends" onPress={() => router.push('/goals')} />
              </ListGroup>
            </>
          )}
        </>
      ) : (
        <>
          <Card tone="green" accessibilityLabel="Health connection">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="heart" color="#121318" size={22} />
              <Txt variant="heading" style={{ flex: 1 }}>{PLATFORM_LABEL}</Txt>
              <Badge label={!healthAvailable ? UNAVAILABLE_BADGE : health.connected ? (health.lastSyncAt && now - health.lastSyncAt > STALE_AFTER_MS ? 'Stale' : 'Connected') : 'Not connected'} tone={health.connected ? 'success' : 'muted'} />
            </View>
            <Txt variant="headline">{health.connected ? 'Your private health dashboard' : 'Heart rate, sleep and steps, privately'}</Txt>
            <Txt color="textMuted">Health data stays on this phone. It is never uploaded, shared or used for competition.</Txt>
            {health.connected ? <Button label="Open health dashboard" arrow onPress={() => router.push('/health')} /> : <Button label={healthAvailable ? `Connect ${PLATFORM_LABEL}` : 'How health data works'} arrow onPress={() => router.push('/health/connections')} />}
          </Card>
          <ListGroup>
            <Row icon="pulse" title="Heart rate zones" subtitle="Set up zones and see time in each" onPress={() => router.push('/health/zones')} />
            <Row icon="target" title="Goals and trends" subtitle="Weekly goals and 12-week trends" onPress={() => router.push('/goals')} />
          </ListGroup>
        </>
      )}
    </Screen>
  );
}
