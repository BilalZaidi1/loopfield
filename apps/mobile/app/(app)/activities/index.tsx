import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { fmtDate, fmtDistance, fmtDuration } from '@/lib/format';
import { Badge, EmptyState, ErrorState, LoadingState, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { useActivities } from '@/features/results/useActivities';
import { useHealthDerived } from '@/health/useHealth';
import { PLATFORM_LABEL } from '@/health/sync';
import { recentLocalRuns } from '@/recording/db';
import { useSession, useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

function resultBadges(claim: string | null, attempts: string[]) {
  const out: { label: string; tone: 'success' | 'title' | 'warning' | 'muted' }[] = [];
  if (claim === 'eligible') out.push({ label: 'Land', tone: 'success' });
  else if (claim === 'pending_review') out.push({ label: 'Land in review', tone: 'warning' });
  else if (claim && claim !== 'processing') out.push({ label: 'No land', tone: 'muted' });
  if (attempts.includes('eligible')) out.push({ label: 'Route time', tone: 'title' });
  return out;
}

/** S23 Activity history — saved first-party runs and clearly marked local imports, dates, totals and results. */
export default function ActivityHistory() {
  const units = useUnits();
  const { userId } = useSession();
  const [filter, setFilter] = useState<'all' | 'recorded' | 'imported'>('all');
  const acts = useActivities(null);
  const health = useHealthDerived();
  const [local, setLocal] = useState(() => (userId ? recentLocalRuns(userId, 20) : []));
  useFocusEffect(useCallback(() => setLocal(userId ? recentLocalRuns(userId, 20) : []), [userId]));
  const pending = local.filter((l) => l.upload_state !== 'received');
  const imported = useMemo(() => health.sessions.filter((s) => s.imported && s.activity !== 'other'), [health.sessions]);

  return (
    <Screen onRefresh={() => void acts.refetch()} refreshing={acts.isRefetching}>
      <Stack.Screen options={{ title: 'Activity history' }} />
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'recorded', label: 'Recorded here' }, { value: 'imported', label: 'Imported' }]} />
      {pending.length && filter !== 'imported' ? (
        <Section title="Waiting to upload">
          {pending.map((l) => {
            const s = l.summary ? JSON.parse(l.summary) : null;
            return <Row key={l.id} title={fmtDate(l.started_at ?? l.created_at, { dateStyle: 'medium', timeStyle: 'short' })} subtitle={`${fmtDistance(s?.distanceM ?? 0, units)} · ${fmtDuration(s?.elapsedMs ?? 0)} · ${l.upload_state === 'failed_permanent' ? 'upload failed' : 'saved on this phone'}`} onPress={() => router.push({ pathname: '/run/summary/[id]', params: { id: l.id } })} />;
          })}
        </Section>
      ) : null}
      {filter !== 'imported' ? (
        <Section title="Recorded in this app">
          {acts.isLoading ? <LoadingState /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : acts.data?.length ? (
            acts.data.map((a) => (
              <Row
                key={a.id}
                title={a.title ?? fmtDate(a.started_at, { dateStyle: 'medium', timeStyle: 'short' })}
                subtitle={`${fmtDistance(a.distance_m, units)} · ${fmtDuration(a.moving_ms ?? a.elapsed_ms)}${a.modes?.territory || a.modes?.speed ? ' · competitive' : ' · private'}`}
                right={<View style={{ gap: spacing.xs }}>{resultBadges(a.claim_status, a.attempt_statuses).map((b) => <Badge key={b.label} label={b.label} tone={b.tone} />)}</View>}
                onPress={() => router.push({ pathname: '/activities/[id]', params: { id: a.id } })}
              />
            ))
          ) : <EmptyState title="No runs yet" body="Runs you record appear here." action={{ label: 'Record a run', onPress: () => router.push('/record') }} />}
        </Section>
      ) : null}
      {filter !== 'recorded' ? (
        <Section title={`Imported from ${PLATFORM_LABEL} (on this phone only)`}>
          <Txt variant="caption">Imported workouts are for your personal history. They never claim land or titles and are not uploaded.</Txt>
          {imported.length ? imported.slice(0, 50).map((s) => (
            <Row key={s.id} title={fmtDate(s.start, { dateStyle: 'medium', timeStyle: 'short' })} subtitle={`${s.activity === 'running' ? 'Run' : 'Walk'} · ${s.distanceM != null ? fmtDistance(s.distanceM, units) : 'distance not recorded'} · ${fmtDuration(s.end - s.start)} · source ${s.primarySourceId}`} right={<Badge label="Imported" tone="muted" />} />
          )) : <Txt color="textMuted">No imported workouts. Connect health data from Progress → Health.</Txt>}
        </Section>
      ) : null}
    </Screen>
  );
}
