import { Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Section, Toggle, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { reasonText } from '@/features/results/ResultCards';
import { useReasonPrompt } from '@/features/ops/ReasonPrompt';

/** Integrity case detail: evidence summary (no raw trace), hold, and resolution with reason. */
export default function IntegrityCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useQuery({ queryKey: ['ops_integrity_detail', id], queryFn: () => rpc<Record<string, any> | null>('ops_integrity_detail', { p_case: id }) });
  const prompt = useReasonPrompt();
  const hold = useMutation({ mutationFn: (h: boolean) => rpc('ops_set_hold', { p_case: id, p_hold: h }), onSuccess: () => void d.refetch(), onError: (e) => Alert.alert('Not changed', friendlyError(e)) });
  const resolve = useMutation({
    mutationFn: (v: { resolution: string; notes: string }) => rpc('ops_resolve_integrity', { p_case: id, p_resolution: v.resolution, p_notes: v.notes }),
    onSuccess: () => {
      void d.refetch();
      Alert.alert('Resolved', 'Affected results are recalculated and the runner is notified.');
    },
    onError: (e) => Alert.alert('Not resolved', friendlyError(e))
  });
  if (d.isLoading) return <LoadingState />;
  if (d.error) return <ErrorState error={d.error} onRetry={() => void d.refetch()} />;
  if (!d.data) return <Screen><EmptyState title="Case not found" /></Screen>;
  const c = d.data.case ?? {};
  const claim = d.data.claim;
  const attempt = d.data.attempt;
  const activity = d.data.activity ?? {};
  const ring = claim?.polygon?.coordinates?.[0] as [number, number][] | undefined;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Integrity case' }} />
      {prompt.element}
      <Card>
        <Txt variant="label">{String(c.kind)} · {String(c.status)} · opened by {String(c.opened_by)}</Txt>
        <Toggle label="Hold publication" description="Keeps the result off maps and rankings while under review." value={Boolean(c.hold)} onChange={(v) => hold.mutate(v)} />
      </Card>
      {ring ? <MapCanvas height={220} layers={{ closing: ring }} accessibilityLabel="Claimed loop polygon" /> : null}
      <Section title="Result">
        {claim ? <Txt>Claim: {claim.status} · {Math.round(claim.eligible_area_m2 ?? 0)} m² · {(claim.reasons ?? []).map(reasonText).join('; ')}</Txt> : null}
        {attempt ? <Txt>Attempt: {attempt.status} · {attempt.elapsed_ms} ms ± {attempt.uncertainty_ms} ms · coverage {attempt.coverage}</Txt> : null}
        <Txt variant="caption">Activity: {activity.distance_m ? `${Math.round(activity.distance_m)} m` : '—'} · {activity.sample_count ?? '—'} fixes ({activity.usable_sample_count ?? '—'} usable) · gaps {Array.isArray(activity.gaps) ? activity.gaps.length : 0}</Txt>
        {d.data.appeal ? <Txt>Runner’s appeal: {String(d.data.appeal.reason)}</Txt> : null}
      </Section>
      <Section title="Resolve">
        <Button variant="danger" label="Invalidate result" onPress={() => prompt.ask('Invalidate this result', (notes) => resolve.mutate({ resolution: 'invalidated', notes }))} />
        <Button variant="secondary" label="Overturn earlier invalidation" onPress={() => prompt.ask('Overturn and restore', (notes) => resolve.mutate({ resolution: 'overturned', notes }))} />
        <Button variant="secondary" label="Uphold (result stands)" onPress={() => prompt.ask('Uphold the result', (notes) => resolve.mutate({ resolution: 'upheld', notes }))} />
        <Button variant="ghost" label="No action" onPress={() => prompt.ask('Close with no action', (notes) => resolve.mutate({ resolution: 'no_action', notes }))} />
      </Section>
    </Screen>
  );
}
