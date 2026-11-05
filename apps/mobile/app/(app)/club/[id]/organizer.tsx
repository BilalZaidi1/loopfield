import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Avatar, Banner, Button, Card, EmptyState, ListGroup, LoadingState, Row, Screen, Section, Segmented, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { useClub, type ClubDetail } from '@/features/clubs/api';
import { useFeed } from '@/features/social/PostCard';

interface Pending {
  user_id: string;
  handle: string;
  display_name: string;
}

/** S33 Organizer controls — posting permissions, membership requests, announcements and content moderation. */
export default function Organizer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const club = useClub(id);
  const c = club.data;
  const requests = useQuery({ queryKey: ['club_members', id, 'requested'], queryFn: () => rpc<Pending[]>('club_members', { p_club: id, p_state: 'requested', p_limit: 100 }) });
  const feed = useFeed('club_feed', { p_club: id });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['club', id] });
    void qc.invalidateQueries({ queryKey: ['club_members', id] });
    void qc.invalidateQueries({ queryKey: ['feed'] });
  };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh, onError: (e) => Alert.alert('Not changed', friendlyError(e)) });

  if (club.isLoading) return <LoadingState />;
  if (!c || (c.my_role !== 'owner' && c.my_role !== 'organizer')) return <Screen><EmptyState title="Organizers only" /></Screen>;
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Organizer tools' }} />
      <Section title={`Join requests (${requests.data?.length ?? 0})`} icon="user">
        {requests.data?.length ? (
          <ListGroup>
            {requests.data.map((r) => (
              <View key={r.user_id} style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
                <Row leading={<Avatar name={r.display_name} size={40} />} title={r.display_name} subtitle={`@${r.handle}`} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button label="Approve" size="sm" icon="check" onPress={() => run.mutate(() => rpc('decide_join_request', { p_club: id, p_user: r.user_id, p_approve: true }))} />
                  <Button label="Decline" size="sm" variant="ghost" onPress={() => run.mutate(() => rpc('decide_join_request', { p_club: id, p_user: r.user_id, p_approve: false }))} />
                </View>
              </View>
            ))}
          </ListGroup>
        ) : <Txt color="textMuted">No pending requests.</Txt>}
      </Section>
      <ClubSettingsForm key={c.id} club={c} saving={run.isPending} onSave={(v) => run.mutate(() => rpc('update_club', { p_club: id, ...v }))} />
      <Section title="Announcements and moderation" icon="bell">
        <Txt variant="caption">Pin announcements so members see them first. Removing a post from the group records your reason; the author can ask for a review.</Txt>
        {posts.length === 0 ? <Txt color="textMuted">No posts yet.</Txt> : null}
        {posts.slice(0, 20).map((post) => (
          <Card key={`${post.id}-actions`}>
            <Txt variant="bodyStrong" numberOfLines={2}>{post.body?.slice(0, 80) || 'Post'}</Txt>
            <Txt variant="caption">{`by @${post.author.handle}`}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Button variant="secondary" size="sm" label="Pin" onPress={() => run.mutate(() => rpc('pin_club_post', { p_club: id, p_post: post.id, p_pinned: true }))} />
              <Button variant="ghost" size="sm" label="Unpin" onPress={() => run.mutate(() => rpc('pin_club_post', { p_club: id, p_post: post.id, p_pinned: false }))} />
              <Button
                variant="danger"
                size="sm"
                label="Remove"
                onPress={() =>
                  Alert.alert('Remove from group?', 'The author is told the post was removed by an organizer.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => run.mutate(() => rpc('club_remove_post', { p_club: id, p_post: post.id, p_reason: 'Removed by an organizer for breaking group rules' })) }
                  ])
                }
              />
            </View>
          </Card>
        ))}
      </Section>
      {run.isSuccess ? <Banner tone="success" text="Saved." /> : null}
    </Screen>
  );
}

function ClubSettingsForm({ club, saving, onSave }: { club: ClubDetail; saving: boolean; onSave: (v: { p_description: string; p_rules: string; p_posting_policy: string; p_join_policy: string }) => void }) {
  const [description, setDescription] = useState(club.description ?? '');
  const [rules, setRules] = useState(club.rules ?? '');
  const [posting, setPosting] = useState<'members' | 'organizers'>(club.posting_policy);
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'request' | 'invite_only'>(club.join_policy);
  return (
    <Section title="Group settings" icon="settings">
      <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} />
      <TextField label="Rules" value={rules} onChangeText={setRules} multiline maxLength={2000} />
      <Segmented label="Who can post" value={posting} onChange={setPosting} options={[{ value: 'members', label: 'All members' }, { value: 'organizers', label: 'Organizers only' }]} />
      <Segmented
        label="How people join"
        value={joinPolicy}
        onChange={setJoinPolicy}
        options={[...(club.visibility === 'public' ? [{ value: 'open' as const, label: 'Open' }] : []), { value: 'request', label: 'Request' }, { value: 'invite_only', label: 'Invite only' }]}
      />
      <Button label="Save settings" onPress={() => onSave({ p_description: description, p_rules: rules, p_posting_policy: posting, p_join_policy: joinPolicy })} loading={saving} />
    </Section>
  );
}
