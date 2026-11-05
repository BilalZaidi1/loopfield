import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { callFunction, friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, Screen, Section, TextField, Txt } from '@/components/ui';
import { clearHealthData, PLATFORM_LABEL } from '@/health/sync';
import { useSession } from '@/state/session';

interface ExportRow {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

/** S49 Account and data controls — export, account/activity deletion, health cache clearing, confirmations and progress. */
export default function AccountData() {
  const { userId, signOut } = useSession();
  const [confirmText, setConfirmText] = useState('');
  const exports = useQuery({
    queryKey: ['data_exports', userId],
    refetchInterval: (q) => ((q.state.data as ExportRow[] | undefined)?.some((e) => e.status === 'queued' || e.status === 'running') ? 5000 : false),
    queryFn: async () => {
      const { data, error } = await supabase().from('data_exports').select('id, status, created_at, completed_at, expires_at').order('created_at', { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as ExportRow[];
    }
  });
  const deletion = useQuery({
    queryKey: ['deletion_requests', userId],
    queryFn: async () => (await supabase().from('deletion_requests').select('id, status, requested_at, completed_at').order('requested_at', { ascending: false }).limit(1)).data?.[0] as { id: string; status: string; requested_at: string } | undefined
  });
  const requestExport = useMutation({
    mutationFn: () => rpc<string>('request_data_export'),
    onSuccess: () => {
      track('data_export_requested', {});
      void exports.refetch();
    },
    onError: (e) => Alert.alert('Export not started', friendlyError(e))
  });
  const download = async (id: string) => {
    try {
      const r = await callFunction<{ url: string }>('account/export-url', { exportId: id });
      await Linking.openURL(r.url);
    } catch (e) {
      Alert.alert('Download unavailable', friendlyError(e));
    }
  };
  const deleteAccount = useMutation({
    mutationFn: () => rpc<string>('request_account_deletion', { p_confirmation: confirmText.trim() }),
    onSuccess: async () => {
      track('account_deletion_requested', {});
      Alert.alert('Account deletion started', 'Your account is being deleted. You will be signed out now; this cannot be undone.');
      await signOut();
    },
    onError: (e) => Alert.alert('Not deleted', friendlyError(e))
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account and data' }} />
      <Section title="Export your data">
        <Txt color="textMuted">A machine-readable copy of your profile, settings, activities, posts, comments, club memberships, results and consents. Imported health data is not included because it never leaves this phone.</Txt>
        <Button variant="secondary" label="Request export" onPress={() => requestExport.mutate()} loading={requestExport.isPending} disabled={exports.data?.some((e) => e.status === 'queued' || e.status === 'running')} />
        {exports.data?.map((e) => (
          <Card key={e.id}>
            <Badge label={e.status === 'ready' ? 'Ready' : e.status === 'failed' ? 'Failed' : e.status === 'expired' ? 'Expired' : 'Preparing…'} tone={e.status === 'ready' ? 'success' : e.status === 'failed' ? 'danger' : 'info'} />
            <Txt variant="caption">Requested {fmtDate(e.created_at, { dateStyle: 'medium', timeStyle: 'short' })}{e.expires_at && e.status === 'ready' ? ` · link available until ${fmtDate(e.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</Txt>
            {e.status === 'ready' ? <Button label="Download" onPress={() => void download(e.id)} /> : null}
          </Card>
        ))}
      </Section>
      <Section title="Health data on this phone">
        <Button variant="secondary" label={`Clear imported ${PLATFORM_LABEL} data`} onPress={() => Alert.alert('Clear imported health data?', 'Deletes every cached reading and summary on this phone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => void clearHealthData() }])} />
      </Section>
      <Section title="Delete activities">
        <Txt color="textMuted">Delete individual runs from their detail page. Any land or titles they earned are withdrawn and recalculated.</Txt>
      </Section>
      <Section title="Delete account">
        {deletion.data && deletion.data.status !== 'completed' ? <Banner tone="warning" text={`Deletion in progress since ${fmtDate(deletion.data.requested_at)}.`} /> : null}
        <Txt color="textMuted">Deletes your profile, runs, posts, comments, messages, memberships and results, withdraws your land and titles (recalculating them for others), and removes stored files. Some records may be kept where the law requires, as described in the Privacy Notice.</Txt>
        <TextField label='Type "DELETE" to confirm' value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
        <Button variant="danger" label="Delete my account" onPress={() => Alert.alert('Delete your account permanently?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteAccount.mutate() }])} disabled={confirmText.trim() !== 'DELETE'} loading={deleteAccount.isPending} />
      </Section>
    </Screen>
  );
}
