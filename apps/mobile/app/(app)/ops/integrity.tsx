import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Badge, EmptyState, ErrorState, LoadingState, Row, Screen } from '@/components/ui';

interface IntegrityRow {
  id: string;
  kind: 'loop_claim' | 'speed_attempt';
  object_id: string;
  opened_by: string;
  status: string;
  hold: boolean;
  created_at: string;
  reasons: string[];
  object_status: string;
}

/** Integrity queue (integrity_reviewer): automated flags and competitive appeals. */
export default function IntegrityQueue() {
  const q = useQuery({ queryKey: ['ops_integrity_queue'], queryFn: () => rpc<IntegrityRow[]>('ops_integrity_queue', { p_limit: 100 }) });
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: 'Integrity cases' }} />
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.length ? (
        q.data.map((c) => (
          <Row
            key={c.id}
            title={`${c.kind === 'loop_claim' ? 'Loop claim' : 'Speed attempt'} · ${c.object_status}`}
            subtitle={`${c.opened_by} · ${c.reasons.join(', ') || 'no reasons'} · ${fmtRelative(c.created_at)}`}
            right={c.hold ? <Badge label="Held" tone="warning" /> : <Badge label={c.status} tone="muted" />}
            onPress={() => router.push({ pathname: '/ops/integrity/[id]', params: { id: c.id } })}
          />
        ))
      ) : <EmptyState title="No open integrity cases" />}
    </Screen>
  );
}
