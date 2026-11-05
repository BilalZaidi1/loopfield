import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Badge, Banner, Button, EmptyState, ErrorState, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { useClub } from '@/features/clubs/api';
import { useSession } from '@/state/session';
import { spacing } from '@/theme/tokens';

interface Member {
  user_id: string;
  handle: string;
  display_name: string;
  role: 'owner' | 'organizer' | 'member';
  state: string;
  since: string;
}

/** S31 Members and roles — member list, organizer identity and authorized membership controls. */
export default function Members() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const qc = useQueryClient();
  const club = useClub(id);
  const members = useQuery({ queryKey: ['club_members', id, 'active'], queryFn: () => rpc<Member[]>('club_members', { p_club: id, p_state: 'active', p_limit: 200 }) });
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const role = club.data?.my_role;
  const organizer = role === 'owner' || role === 'organizer';

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['club_members', id] });
      void qc.invalidateQueries({ queryKey: ['club', id] });
    },
    onError: (e) => Alert.alert('Not changed', friendlyError(e))
  });

  const inviteByHandle = async () => {
    try {
      const found = await rpc<{ user_id: string; handle: string }[]>('search_profiles', { p_query: handle.replace(/^@/, ''), p_limit: 5 });
      const match = found.find((f) => f.handle.toLowerCase() === handle.replace(/^@/, '').toLowerCase());
      if (!match) return setNotice('No runner with that handle can be invited.');
      await rpc('invite_to_club', { p_club: id, p_user: match.user_id });
      setNotice(`Invitation sent to @${match.handle}. They choose whether to join.`);
      setHandle('');
    } catch (e) {
      setNotice(friendlyError(e));
    }
  };
  const inviteByEmail = async () => {
    try {
      await rpc('invite_to_club_by_email', { p_club: id, p_email: email.trim() });
      setNotice('If that address can receive invitations, an email with a join link is on its way.');
      setEmail('');
    } catch (e) {
      setNotice(friendlyError(e));
    }
  };

  const manage = (m: Member) => {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [{ text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: m.user_id } }) }];
    if (role === 'owner' && m.role !== 'owner') {
      buttons.push({ text: m.role === 'organizer' ? 'Make member' : 'Make organizer', onPress: () => act.mutate(() => rpc('set_club_role', { p_club: id, p_user: m.user_id, p_role: m.role === 'organizer' ? 'member' : 'organizer' })) });
    }
    if (organizer && m.role === 'member' && m.user_id !== userId) {
      buttons.push({ text: 'Remove from group', style: 'destructive', onPress: () => act.mutate(async () => { await rpc('remove_club_member', { p_club: id, p_user: m.user_id }); track('club_action', { action: 'member_removed', club_kind: club.data!.kind, visibility: club.data!.visibility }); }) });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.display_name, `@${m.handle} · ${m.role}`, buttons);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Members' }} />
      {members.isLoading ? <LoadingState /> : members.error ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> : members.data?.length ? (
        <Section title={`${members.data.length} members`}>
          {members.data.map((m) => (
            <Row key={m.user_id} title={m.display_name} subtitle={`@${m.handle}`} right={m.role !== 'member' ? <Badge label={m.role === 'owner' ? 'Owner' : 'Organizer'} tone="info" /> : undefined} onPress={() => manage(m)} />
          ))}
        </Section>
      ) : (
        <EmptyState title="No members to show" body="Only members can see the member list." />
      )}
      {organizer ? (
        <Section title="Invite">
          <TextField label="Invite by handle" value={handle} onChangeText={setHandle} autoCapitalize="none" placeholder="@handle" />
          <Button variant="secondary" label="Send invitation" onPress={inviteByHandle} disabled={handle.trim().length < 3} />
          <TextField label="Invite by email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Button variant="secondary" label="Email an invitation" onPress={inviteByEmail} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} />
          <Txt variant="caption">Invited people decide whether to join. Email invitations expire.</Txt>
        </Section>
      ) : null}
      {notice ? <View style={{ marginTop: spacing.md }}><Banner text={notice} /></View> : null}
    </Screen>
  );
}
