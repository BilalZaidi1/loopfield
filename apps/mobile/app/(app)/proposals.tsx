import { Alert, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDate, fmtDistance } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { useSession, useUnits } from '@/state/session';

interface Proposal {
  id: string;
  name: string;
  status: 'processing' | 'pending_review' | 'duplicate_linked' | 'approved' | 'declined' | 'withdrawn';
  length_m: number | null;
  closed: boolean | null;
  decision_reason: string | null;
  canonical_course_id: string | null;
  created_at: string;
  decided_at: string | null;
}

const STATUS: Record<Proposal['status'], { label: string; tone: 'info' | 'warning' | 'success' | 'muted' | 'danger'; help: string }> = {
  processing: { label: 'Checking', tone: 'info', help: 'Automatic checks are running.' },
  pending_review: { label: 'Waiting for review', tone: 'warning', help: 'A reviewer will check safety, public access and duplicates.' },
  duplicate_linked: { label: 'Linked to an existing route', tone: 'info', help: 'This matches a route that already exists, so it was linked to it.' },
  approved: { label: 'Approved', tone: 'success', help: 'The route is open for titles.' },
  declined: { label: 'Declined', tone: 'danger', help: 'See the reason below. You can ask for a review.' },
  withdrawn: { label: 'Withdrawn', tone: 'muted', help: 'You withdrew this proposal.' }
};

/** S27 My route proposals — pending, approved, duplicate-linked, declined or withdrawn states with reasons. */
export default function Proposals() {
  const pal = usePalette();
  const units = useUnits();
  const { userId } = useSession();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['route_proposals', userId],
    queryFn: async () => {
      const { data, error } = await supabase().from('route_proposals').select('id, name, status, length_m, closed, decision_reason, canonical_course_id, created_at, decided_at').eq('creator_id', userId!).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Proposal[];
    }
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => rpc('withdraw_route_proposal', { p_proposal: id }),
    onSuccess: () => {
      track('route_proposed', { outcome: 'withdrawn' });
      void qc.invalidateQueries({ queryKey: ['route_proposals'] });
    },
    onError: (e) => Alert.alert('Not withdrawn', friendlyError(e))
  });
  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: 'My route proposals' }} />
      {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data?.length ? (
        list.data.map((pr) => {
          const s = STATUS[pr.status];
          return (
            <Card key={pr.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Icon name="route" color={pal.greenText} size={22} />
                <Txt variant="heading" style={{ flex: 1 }}>{pr.name}</Txt>
                <Badge label={s.label} tone={s.tone} />
              </View>
              <Txt variant="caption">{pr.length_m ? `${fmtDistance(pr.length_m, units)} · ` : ''}submitted {fmtDate(pr.created_at)}{pr.decided_at ? ` · decided ${fmtDate(pr.decided_at)}` : ''}</Txt>
              <Txt color="textMuted">{s.help}</Txt>
              {pr.decision_reason ? <Txt>Reason: {pr.decision_reason}</Txt> : null}
              {pr.canonical_course_id && (pr.status === 'approved' || pr.status === 'duplicate_linked') ? <Button variant="secondary" icon="route" label="Open route" onPress={() => router.push({ pathname: '/routes/[id]', params: { id: pr.canonical_course_id! } })} /> : null}
              {pr.status === 'processing' || pr.status === 'pending_review' ? <Button variant="ghost" label="Withdraw" onPress={() => withdraw.mutate(pr.id)} /> : null}
              {pr.status === 'declined' ? <Button variant="ghost" label="Request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'route_proposal', id: pr.id } })} /> : null}
            </Card>
          );
        })
      ) : <EmptyState icon="route" title="No proposals yet" body="Open a run in Activity history and choose “Propose as a speed route”." />}
    </Screen>
  );
}
