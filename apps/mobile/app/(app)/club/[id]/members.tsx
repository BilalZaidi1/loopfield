import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Section, TextField, Txt } from '@/components/ui';
import { roleLabel, useClub, useClubAdmin } from '@/features/clubs/api';
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

/**
 * S31 Members and roles. The owner makes members admins (communities), removes admins and members and can
 * offer ownership; admins invite people and remove members. Groups keep it simple: the owner and the people
 * they add, up to the group size limit.
 */
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
  const group = club.data?.kind === 'group';
  const admin = useClubAdmin(club.data);
  const cap = useQuery({
    queryKey: ['app_config', 'group_max_members'],
    enabled: group,
    staleTime: 60 * 60_000,
    queryFn: async () => Number((await supabase().from('app_config').select('value').eq('key', 'group_max_members').maybeSingle()).data?.value ?? 0) || null
  });
  const onError = (e: unknown) => Alert.alert('Not changed', friendlyError(e));

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
    const owner = role === 'owner';
    if (owner && m.role !== 'owner' && !group) {
      buttons.push(m.role === 'organizer'
        ? { text: 'Remove as admin', onPress: () => admin.setRole.mutate({ userId: m.user_id, role: 'member' }, { onError }) }
        : { text: 'Make admin', onPress: () => admin.setRole.mutate({ userId: m.user_id, role: 'organizer' }, { onError }) });
    }
    if (owner && m.user_id !== userId) {
      buttons.push({ text: 'Offer ownership', onPress: () => Alert.alert(`Offer ownership to ${m.display_name}?`, 'They become the owner when they accept, and you stay on as an admin. You can withdraw the offer until then.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Offer', onPress: () => admin.offer.mutate(m.user_id, { onError, onSuccess: () => setNotice(`Ownership offered to ${m.display_name}. Nothing changes until they accept.`) }) }
      ]) });
    }
    if (organizer && m.user_id !== userId && (m.role === 'member' || (owner && m.role === 'organizer'))) {
      buttons.push({ text: group ? 'Remove from group' : 'Remove from community', style: 'destructive', onPress: () => act.mutate(async () => { await rpc('remove_club_member', { p_club: id, p_user: m.user_id }); track('club_action', { action: 'member_removed', club_kind: club.data!.kind, visibility: club.data!.visibility }); }) });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.display_name, `@${m.handle} · ${roleLabel(m.role)}`, buttons);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Members' }} />
      {members.isLoading ? <LoadingState /> : members.error ? <ErrorState error={members.error} onRetry={() => void members.refetch()} /> : members.data?.length ? (
        <Section title={group && cap.data ? `${members.data.length} of ${cap.data} people` : `${members.data.length} members`} icon="clubs">
          <ListGroup>
            {members.data.map((m) => (
              <Row key={m.user_id} leading={<Avatar name={m.display_name} size={40} />} title={m.display_name} subtitle={`@${m.handle}`} right={m.role !== 'member' ? <Badge label={roleLabel(m.role)} tone="violet" /> : undefined} onPress={() => manage(m)} />
            ))}
          </ListGroup>
          {organizer ? <Txt variant="caption">{group ? 'Tap someone to remove them or hand the group over to them.' : role === 'owner' ? 'Tap someone to make them an admin, remove them or offer them ownership.' : 'Tap a member to remove them. Only the owner changes admins.'}</Txt> : null}
        </Section>
      ) : (
        <EmptyState icon="clubs" title="No members to show" body="Only members can see the member list." />
      )}
      {organizer ? (
        <Section title={group ? 'Add people' : 'Invite runners'} icon="plus">
          <Card>
            <TextField label="Invite by handle" value={handle} onChangeText={setHandle} autoCapitalize="none" placeholder="@handle" />
            <Button variant="secondary" icon="send" label="Send invitation" onPress={inviteByHandle} disabled={handle.trim().length < 3} />
          </Card>
          <Card>
            <TextField label="Invite by email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Button variant="secondary" icon="mail" label="Email an invitation" onPress={inviteByEmail} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} />
          </Card>
          <Txt variant="caption">{group ? 'Invited people decide whether to join; then they see the group, its posts and its chat. Email invitations expire.' : 'Invited people decide whether to join. Email invitations expire.'}</Txt>
        </Section>
      ) : null}
      {notice ? <View style={{ marginTop: spacing.md }}><Banner text={notice} /></View> : null}
    </Screen>
  );
}
