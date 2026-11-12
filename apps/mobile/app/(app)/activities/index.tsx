import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { fmtDate, fmtDistance, fmtDuration } from '@/lib/format';
import { Badge, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { useActivities, type ActivityRow } from '@/features/results/useActivities';
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

  const months = useMemo(() => {
    const out: { key: string; label: string; rows: ActivityRow[] }[] = [];
    for (const a of acts.data ?? []) {
      const d = new Date(a.started_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let group = out.find((g) => g.key === key);
      if (!group) {
        group = { key, label: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(d), rows: [] };
        out.push(group);
      }
      group.rows.push(a);
    }
    return out;
  }, [acts.data]);

  return (
    <Screen onRefresh={() => void acts.refetch()} refreshing={acts.isRefetching}>
      <Stack.Screen options={{ title: 'Activity history' }} />
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'recorded', label: 'Recorded' }, { value: 'imported', label: 'Imported' }]} />
      {pending.length && filter !== 'imported' ? (
        <Section title="Waiting to upload" icon="refresh">
          <ListGroup>
            {pending.map((l) => {
              const s = l.summary ? JSON.parse(l.summary) : null;
              return (
                <Row
                  key={l.id}
                  icon={l.upload_state === 'failed_permanent' ? 'alert' : 'refresh'}
                  destructive={l.upload_state === 'failed_permanent'}
                  title={fmtDate(l.started_at ?? l.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                  subtitle={`${fmtDistance(s?.distanceM ?? 0, units)} · ${fmtDuration(s?.elapsedMs ?? 0)} · ${l.upload_state === 'failed_permanent' ? 'upload failed' : 'saved on this phone'}`}
                  onPress={() => router.push({ pathname: '/run/summary/[id]', params: { id: l.id } })}
                />
              );
            })}
          </ListGroup>
        </Section>
      ) : null}
      {filter !== 'imported' ? (
        acts.isLoading ? <LoadingState rows={5} /> : acts.error ? <ErrorState error={acts.error} onRetry={() => void acts.refetch()} /> : months.length ? (
          months.map((m) => (
            <Section key={m.key} title={m.label} subtitle={`${m.rows.length} ${m.rows.length === 1 ? 'run' : 'runs'} · ${fmtDistance(m.rows.reduce((t, r) => t + (r.distance_m ?? 0), 0), units, 1)}`}>
              <ListGroup>
                {m.rows.map((a) => (
                  <Row
                    key={a.id}
                    icon={a.claim_status === 'eligible' ? 'hexagon' : a.attempt_statuses.includes('eligible') ? 'stopwatch' : a.modes?.territory || a.modes?.speed ? 'record' : 'lock'}
                    title={a.title ?? fmtDate(a.started_at, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
                    subtitle={`${fmtDate(a.started_at, { day: 'numeric', month: 'short' })} · ${fmtDistance(a.distance_m, units)} · ${fmtDuration(a.moving_ms ?? a.elapsed_ms)}${a.modes?.territory || a.modes?.speed ? '' : ' · private'}`}
                    right={<View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>{resultBadges(a.claim_status, a.attempt_statuses).map((b) => <Badge key={b.label} label={b.label} tone={b.tone} />)}</View>}
                    onPress={() => router.push({ pathname: '/activities/[id]', params: { id: a.id } })}
                  />
                ))}
              </ListGroup>
            </Section>
          ))
        ) : <EmptyState icon="record" title="No runs yet" body="Runs you record appear here." action={{ label: 'Record a run', onPress: () => router.push('/run/active') }} />
      ) : null}
      {filter !== 'recorded' ? (
        <Section title={`Imported from ${PLATFORM_LABEL}`} icon="pulse" subtitle="On this phone only">
          <Txt variant="caption">Imported workouts are for your personal history. They never claim land or titles and are not uploaded.</Txt>
          {imported.length ? (
            <ListGroup>
              {imported.slice(0, 50).map((s) => (
                <Row key={s.id} icon="pulse" title={fmtDate(s.start, { dateStyle: 'medium', timeStyle: 'short' })} subtitle={`${s.activity === 'running' ? 'Run' : 'Walk'} · ${s.distanceM != null ? fmtDistance(s.distanceM, units) : 'distance not recorded'} · ${fmtDuration(s.end - s.start)} · source ${s.primarySourceId}`} right={<Badge label="Imported" tone="muted" />} />
              ))}
            </ListGroup>
          ) : <Txt color="textMuted">No imported workouts. Connect health data from Progress → Health.</Txt>}
        </Section>
      ) : null}
    </Screen>
  );
}
