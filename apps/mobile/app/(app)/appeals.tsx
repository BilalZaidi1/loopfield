import { View } from 'react-native';
import { useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RETENTION_RULES } from '@loopfield/core';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Section, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

interface Appeal {
  id: string;
  object_type: string;
  object_id: string;
  reason: string;
  status: 'submitted' | 'in_review' | 'upheld' | 'overturned' | 'withdrawn';
  response: string | null;
  created_at: string;
  decided_at: string | null;
}

const TYPE_LABEL: Record<string, string> = { loop_claim: 'Land result', speed_attempt: 'Route time', post: 'Removed post', comment: 'Removed comment', route_proposal: 'Route proposal decision', moderation_case: 'Account or content decision' };
const STATUS: Record<Appeal['status'], { label: string; tone: 'info' | 'success' | 'warning' | 'muted' }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  in_review: { label: 'In review', tone: 'warning' },
  upheld: { label: 'Decision kept', tone: 'muted' },
  overturned: { label: 'Decision changed', tone: 'success' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' }
};

/** S48 Appeal and request status — contested result or content decision, explanation, review state and final response. */
export default function Appeals() {
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: ['appeals'],
    queryFn: async () => {
      const { data, error } = await supabase().from('appeals').select('id, object_type, object_id, reason, status, response, created_at, decided_at').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Appeal[];
    }
  });
  const submit = useMutation({
    mutationFn: () => rpc<string>('submit_appeal', { p_object_type: params.type, p_object_id: params.id, p_reason: reason }),
    onSuccess: () => {
      track('appeal_submitted', { object_type: params.type as 'loop_claim' });
      setReason('');
      void qc.invalidateQueries({ queryKey: ['appeals'] });
    }
  });
  const existing = list.data?.find((a) => a.object_id === params.id && a.object_type === params.type);
  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: 'Reviews and appeals' }} />
      {params.type && params.id && !existing ? (
        <Card accessibilityLabel="New request">
          <Txt variant="headline">{`Request a review: ${TYPE_LABEL[params.type] ?? params.type}`}</Txt>
          <Txt color="textMuted">Explain what you think is wrong. Requests are possible within {RETENTION_RULES.appealWindowDays.value} days of the decision. A reviewer who did not make the original decision checks the evidence; results can change for everyone affected.</Txt>
          <TextField label="Explanation" value={reason} onChangeText={setReason} multiline maxLength={1000} />
          {submit.error ? <Banner tone="danger" text={friendlyError(submit.error)} /> : null}
          {submit.isSuccess ? <Banner tone="success" text="Request submitted. You will be notified of the decision." /> : null}
          <Button label="Submit request" arrow onPress={() => submit.mutate()} loading={submit.isPending} disabled={reason.trim().length < 10 || submit.isSuccess} hint="At least 10 characters." />
        </Card>
      ) : null}
      <Section title="Your requests" icon="flag">
        {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data?.length ? (
          list.data.map((a) => (
            <Card key={a.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Txt variant="heading" style={{ flex: 1 }}>{TYPE_LABEL[a.object_type] ?? a.object_type}</Txt>
                <Badge label={STATUS[a.status].label} tone={STATUS[a.status].tone} />
              </View>
              <Txt variant="caption">Submitted {fmtDate(a.created_at)}{a.decided_at ? ` · decided ${fmtDate(a.decided_at)}` : ''}</Txt>
              <Txt>{a.reason}</Txt>
              {a.response ? <Txt color="textMuted">Response: {a.response}</Txt> : null}
            </Card>
          ))
        ) : <EmptyState icon="flag" title="No requests yet" body="You can ask for a review from a land or route result, a removed post, or a route proposal decision." />}
      </Section>
    </Screen>
  );
}
