import { useState } from 'react';
import { Alert } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Row, Screen, Section, Segmented, Txt } from '@/components/ui';
import { useReasonPrompt } from '@/features/ops/ReasonPrompt';

interface QueueRow {
  id: string;
  object_type: string;
  object_id: string;
  priority: string;
  status: string;
  report_count: number;
  created_at: string;
  categories: string[];
}

/** Moderation queue and content appeals (moderator role). */
export default function ModerationQueue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'in_review' | 'resolved'>('open');
  const queue = useQuery({ queryKey: ['ops_moderation_queue', status], queryFn: () => rpc<QueueRow[]>('ops_moderation_queue', { p_status: status, p_limit: 100 }) });
  const appeals = useQuery({
    queryKey: ['ops_content_appeals'],
    queryFn: async () => {
      const { data, error } = await supabase().from('appeals').select('id, object_type, object_id, reason, status, created_at').in('object_type', ['post', 'comment', 'moderation_case']).in('status', ['submitted', 'in_review']).order('created_at');
      if (error) throw error;
      return data ?? [];
    }
  });
  const prompt = useReasonPrompt();
  const decide = useMutation({
    mutationFn: (v: { id: string; overturn: boolean; response: string }) => rpc('ops_decide_content_appeal', { p_appeal: v.id, p_overturn: v.overturn, p_response: v.response }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ops_content_appeals'] }),
    onError: (e) => Alert.alert('Not decided', friendlyError(e))
  });
  return (
    <Screen onRefresh={() => { void queue.refetch(); void appeals.refetch(); }} refreshing={queue.isRefetching}>
      <Stack.Screen options={{ title: 'Moderation' }} />
      {prompt.element}
      <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'in_review', label: 'In review' }, { value: 'resolved', label: 'Resolved' }]} />
      {queue.isLoading ? <LoadingState /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : queue.data?.length ? (
        queue.data.map((c) => (
          <Row key={c.id} title={`${c.object_type} · ${c.categories.join(', ')}`} subtitle={`${c.report_count} report(s) · ${fmtRelative(c.created_at)}`} right={<Badge label={c.priority} tone={c.priority === 'high' ? 'danger' : 'muted'} />} onPress={() => router.push({ pathname: '/ops/moderation/[id]', params: { id: c.id } })} />
        ))
      ) : <EmptyState title="Queue is empty" />}
      <Section title="Content appeals">
        {appeals.data?.length ? appeals.data.map((a) => (
          <Card key={a.id as string}>
            <Txt variant="label">{String(a.object_type)} · {fmtRelative(a.created_at as string)}</Txt>
            <Txt>{String(a.reason)}</Txt>
            <Button variant="secondary" label="Overturn (restore)" onPress={() => prompt.ask('Overturn the decision', (r) => decide.mutate({ id: a.id as string, overturn: true, response: r }))} />
            <Button variant="ghost" label="Keep decision" onPress={() => prompt.ask('Keep the decision', (r) => decide.mutate({ id: a.id as string, overturn: false, response: r }))} />
          </Card>
        )) : <Txt color="textMuted">No open content appeals.</Txt>}
      </Section>
    </Screen>
  );
}
