import { Alert } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Section, Txt } from '@/components/ui';
import { useReasonPrompt } from '@/features/ops/ReasonPrompt';

interface CaseJson {
  case: { id: string; object_type: string; object_id: string; status: string; priority: string; outcome: string | null; subject_user_id: string | null };
  object: Record<string, unknown> | null;
  reports: { category: string; details: string | null; created_at: string }[] | null;
  evidence: unknown[] | null;
  actions: { action: string; reason: string; at: string }[] | null;
}

const ACTIONS = [
  { action: 'remove_content', label: 'Remove content' },
  { action: 'restore_content', label: 'Restore content' },
  { action: 'warn', label: 'Warn the author' },
  { action: 'suspend_account', label: 'Suspend account' },
  { action: 'reinstate_account', label: 'Reinstate account' },
  { action: 'dismiss', label: 'Dismiss (no action)' }
];

/** Moderation case detail with minimal restricted evidence and reasoned actions. */
export default function ModerationCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useQuery({ queryKey: ['ops_moderation_case', id], queryFn: () => rpc<CaseJson | null>('ops_moderation_case', { p_case: id }) });
  const prompt = useReasonPrompt();
  const act = useMutation({
    mutationFn: (v: { action: string; reason: string }) => rpc('ops_moderate', { p_case: id, p_action: v.action, p_reason: v.reason }),
    onSuccess: () => {
      void detail.refetch();
      Alert.alert('Recorded');
    },
    onError: (e) => Alert.alert('Not applied', friendlyError(e))
  });
  if (detail.isLoading) return <LoadingState />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const d = detail.data;
  if (!d) return <Screen><EmptyState title="Case not found" /></Screen>;
  return (
    <Screen>
      <Stack.Screen options={{ title: `Case · ${d.case.object_type}` }} />
      {prompt.element}
      <Card>
        <Txt variant="label">Status: {d.case.status}{d.case.outcome ? ` · outcome ${d.case.outcome}` : ''}</Txt>
        <Txt variant="caption">Object {d.case.object_type} {d.case.object_id}</Txt>
        {d.object ? Object.entries(d.object).map(([k, v]) => <Txt key={k} variant="caption">{k}: {typeof v === 'string' ? v : JSON.stringify(v)}</Txt>) : <Txt color="textMuted">The object no longer exists.</Txt>}
        {d.case.object_type === 'post' ? <Button variant="ghost" label="Open post" onPress={() => router.push({ pathname: '/post/[id]', params: { id: d.case.object_id } })} /> : null}
      </Card>
      <Section title={`Reports (${d.reports?.length ?? 0})`}>
        {d.reports?.map((r, i) => <Txt key={i}>• {r.category} · {fmtDate(r.created_at)}{r.details ? ` — ${r.details}` : ''}</Txt>)}
      </Section>
      {d.evidence?.length ? (
        <Section title="Captured evidence (restricted)">
          {d.evidence.map((e, i) => <Txt key={i} variant="caption">{JSON.stringify(e)}</Txt>)}
        </Section>
      ) : null}
      <Section title="Decision">
        {ACTIONS.map((a) => (
          <Button key={a.action} variant={a.action === 'suspend_account' || a.action === 'remove_content' ? 'danger' : 'secondary'} label={a.label} onPress={() => prompt.ask(a.label, (reason) => act.mutate({ action: a.action, reason }))} />
        ))}
      </Section>
      <Section title="History">
        {d.actions?.length ? d.actions.map((a, i) => <Txt key={i} variant="caption">{fmtDate(a.at, { dateStyle: 'medium', timeStyle: 'short' })}: {a.action} — {a.reason}</Txt>) : <Txt color="textMuted">No actions yet.</Txt>}
      </Section>
    </Screen>
  );
}
