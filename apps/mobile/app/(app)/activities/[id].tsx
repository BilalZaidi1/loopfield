import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { decodePolyline, heartRateSummary } from '@loopfield/core';
import { friendlyError, rpc } from '@/lib/api';
import { fmtDate, fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Section, Segmented, StatTile, TextField, Txt } from '@/components/ui';
import { DataTable } from '@/components/charts';
import { MapCanvas } from '@/features/map/MapCanvas';
import { LandCard, TitleCards } from '@/features/results/ResultCards';
import { useActivityDetail, type ActivityJson } from '@/features/results/useActivity';
import { canExportRuns, exportRun } from '@/health/export';
import { PLATFORM_LABEL } from '@/health/sync';
import { quantities, useHealthStore } from '@/health/useHealth';
import { useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S24 Activity detail — private map, splits, charts, sources, contest explanation, export and delete. */
export default function ActivityDetailScreen() {
  const p = usePalette();
  const units = useUnits();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useActivityDetail(id);
  const store = useHealthStore();
  const a = detail.data?.activity;
  const claim = detail.data?.claim;
  const path = useMemo(() => (a?.personal_route ? decodePolyline(a.personal_route).map((x) => [x.lng, x.lat] as [number, number]) : []), [a]);
  const claimRing = useMemo(() => (claim?.polygon ? (claim.polygon.coordinates[0] as [number, number][]) : undefined), [claim]);
  const hr = useMemo(() => (a ? heartRateSummary(quantities(store, 'heart_rate'), Date.parse(a.started_at), Date.parse(a.ended_at)) : null), [a, store]);

  if (detail.isLoading) return <LoadingState />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data || !a) return <Screen><EmptyState title="Activity not found" body="It may have been deleted." /></Screen>;

  const remove = () =>
    Alert.alert('Delete this activity?', 'It is removed from your history, and any land or titles it earned are withdrawn and recalculated for everyone affected. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await rpc('delete_activity', { p_activity: a.id });
            void qc.invalidateQueries({ queryKey: ['activities'] });
            router.back();
          } catch (e) {
            Alert.alert('Not deleted', friendlyError(e));
          }
        }
      }
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: a.title ?? fmtDate(a.started_at) }} />
      <Txt variant="caption">{fmtDate(a.started_at, { dateStyle: 'full', timeStyle: 'short' })} · {a.modes?.territory || a.modes?.speed ? 'Competitive' : 'Private'} · summary from {a.summary_source === 'server' ? 'the server' : 'this phone'}</Txt>
      {path.length > 1 ? (
        <MapCanvas height={260} layers={{ path, closing: claimRing }} accessibilityLabel="Private map of this run. Only you can see it." />
      ) : <Banner text={a.raw_evidence_purged_at ? 'The detailed route was removed under the retention policy; totals remain.' : 'The route map appears after the server processes this run.'} />}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Distance" value={fmtDistance(a.distance_m, units)} />
        <StatTile label="Moving" value={fmtDuration(a.moving_ms)} />
        <StatTile label="Pace" value={fmtPace(a.avg_pace_s_per_km, units)} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Elapsed" value={fmtDuration(a.elapsed_ms)} />
        <StatTile label="Elevation gain" value={a.elevation_gain_m != null ? `${a.elevation_gain_m} m` : '—'} note={a.elevation_gain_m == null ? 'Not enough reliable altitude data' : 'From GPS altitude'} />
      </View>
      {a.gaps?.length ? <Banner tone="warning" text={`${a.gaps.length} recording gap(s), ${Math.round(a.gaps.reduce((t, g) => t + g.seconds, 0))} s in total. Missing movement is never filled in.`} /> : null}
      {a.splits?.length ? (
        <Section title={`Splits (${units === 'metric' ? 'per km' : 'per mile'})`}>
          <DataTable header={['#', 'Distance', 'Time', 'Note']} rows={a.splits.map((s) => [String(s.index + 1), fmtDistance(s.distanceM, units), fmtDuration(s.elapsedMs), s.containsGap ? 'includes a gap' : ''])} />
        </Section>
      ) : null}
      {hr && hr.sampleCount > 0 ? (
        <Card accessibilityLabel="Heart rate from your health data">
          <Txt variant="heading">Heart rate (on this phone only)</Txt>
          <Txt>Average {hr.avg ?? '—'} bpm · max {hr.max ?? '—'} bpm · coverage {Math.round(hr.coverage * 100)}%</Txt>
          <Txt variant="caption">From {PLATFORM_LABEL}. Never uploaded or shared, and never used for competition.</Txt>
        </Card>
      ) : null}
      <LandCard claim={detail.data.claim} territoryRequested={Boolean(a.modes?.territory)} />
      <TitleCards attempts={detail.data.attempts} context={detail.data.title_context} />
      {detail.data.proposals.length ? (
        <Card>
          <Txt variant="heading">Route proposals from this run</Txt>
          {detail.data.proposals.map((pr) => <Txt key={pr.id}>{pr.name}: {pr.status.replace('_', ' ')}</Txt>)}
        </Card>
      ) : null}
      <NotesForm key={a.id} activity={a} onSaved={() => void qc.invalidateQueries({ queryKey: ['activities'] })} />
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Button label="Share" variant="secondary" onPress={() => router.push({ pathname: '/share/[id]', params: { id: a.id } })} />
        <Button label="Propose as a speed route" variant="secondary" onPress={() => router.push({ pathname: '/propose-route/[activityId]', params: { activityId: a.id } })} />
        {canExportRuns() ? <Button variant="ghost" label={`Save workout to ${PLATFORM_LABEL}`} onPress={() => void exportRun({ activityId: a.id, start: Date.parse(a.started_at), end: Date.parse(a.ended_at), distanceM: a.distance_m ?? 0 }).then(() => Alert.alert('Saved', `Saved to ${PLATFORM_LABEL}.`)).catch((e) => Alert.alert('Not saved', friendlyError(e)))} /> : null}
        <Button label="Delete activity" variant="danger" onPress={remove} />
      </View>
      <Txt variant="caption" style={{ color: p.textMuted, marginTop: spacing.md }}>Rules: territory {detail.data.claim?.rule_version ?? '—'} · thresholds are proposed and may change after field validation.</Txt>
    </Screen>
  );
}

/** Owner-editable notes; initial values come from the server record (keyed by activity id). */
function NotesForm({ activity, onSaved }: { activity: ActivityJson; onSaved: () => void }) {
  const [title, setTitle] = useState(activity.title ?? '');
  const [notes, setNotes] = useState(activity.notes ?? '');
  const [effort, setEffort] = useState<string>(activity.perceived_effort ? String(activity.perceived_effort) : 'none');
  const save = async () => {
    const { error } = await supabase().from('activities').update({ title: title.trim() || null, notes: notes.trim() || null, perceived_effort: effort === 'none' ? null : Number(effort) }).eq('id', activity.id);
    if (error) Alert.alert('Not saved', friendlyError(error));
    else onSaved();
  };
  return (
    <Section title="Your notes">
      <TextField label="Title" value={title} onChangeText={setTitle} maxLength={80} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <Segmented label="Perceived effort (optional)" value={effort} onChange={setEffort} options={[{ value: 'none', label: '—' }, ...['1', '3', '5', '7', '10'].map((v) => ({ value: v, label: v }))]} />
      <Button variant="secondary" label="Save notes" onPress={() => void save()} />
    </Section>
  );
}
