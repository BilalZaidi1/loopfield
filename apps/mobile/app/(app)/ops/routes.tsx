import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { fmtDistance, fmtRelative } from '@/lib/format';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { useReasonPrompt } from '@/features/ops/ReasonPrompt';
import { useUnits } from '@/state/session';

interface ProposalRow {
  id: string;
  name: string;
  creator_handle: string;
  length_m: number;
  closed: boolean;
  created_at: string;
  path_geojson: GeoJSON.LineString | null;
  score_founding_run: boolean;
}

/** Route review queue (route_reviewer): safety, public access, duplicates; reasons recorded. */
export default function RouteQueue() {
  const units = useUnits();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ops_route_queue'], queryFn: () => rpc<ProposalRow[]>('ops_route_queue', { p_limit: 50 }) });
  const prompt = useReasonPrompt();
  const review = useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason: string }) => rpc('ops_review_route', { p_proposal: v.id, p_approve: v.approve, p_reason: v.reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ops_route_queue'] }),
    onError: (e) => Alert.alert('Not recorded', friendlyError(e))
  });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: 'Route proposals' }} />
      {prompt.element}
      <Txt variant="caption">Approve only public, safe, legally accessible routes. Map appearance alone is not evidence of public access.</Txt>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.length ? (
        q.data.map((r) => (
          <Card key={r.id}>
            <Txt variant="heading">{r.name}</Txt>
            <Txt variant="caption">@{r.creator_handle} · {fmtDistance(r.length_m, units)} · {r.closed ? 'loop' : 'one way'} · {fmtRelative(r.created_at)}{r.score_founding_run ? ' · founding run requested' : ''}</Txt>
            {r.path_geojson ? <MapCanvas height={180} layers={{ path: r.path_geojson.coordinates as [number, number][] }} accessibilityLabel={`Proposed route ${r.name}`} /> : null}
            <Button label="Approve" onPress={() => prompt.ask(`Approve ${r.name}`, (reason) => review.mutate({ id: r.id, approve: true, reason }))} />
            <Button variant="secondary" label="Decline" onPress={() => prompt.ask(`Decline ${r.name}`, (reason) => review.mutate({ id: r.id, approve: false, reason }))} />
          </Card>
        ))
      ) : <EmptyState title="No proposals waiting" />}
    </Screen>
  );
}
