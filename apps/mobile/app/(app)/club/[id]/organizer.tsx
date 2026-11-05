import { useState } from 'react';
import { Alert } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Banner, Button, EmptyState, LoadingState, Row, Screen, Section, Segmented, TextField, Txt } from '@/components/ui';
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
      <Section title={`Join requests (${requests.data?.length ?? 0})`}>
        {requests.data?.length ? requests.data.map((r) => (
          <Row key={r.user_id} title={r.display_name} subtitle={`@${r.handle}`} right={<>
            <Button label="Approve" onPress={() => run.mutate(() => rpc('decide_join_request', { p_club: id, p_user: r.user_id, p_approve: true }))} />
            <Button label="Decline" variant="ghost" onPress={() => run.mutate(() => rpc('decide_join_request', { p_club: id, p_user: r.user_id, p_approve: false }))} />
          </>} />
        )) : <Txt color="textMuted">No pending requests.</Txt>}
      </Section>
      <ClubSettingsForm key={c.id} club={c} saving={run.isPending} onSave={(v) => run.mutate(() => rpc('update_club', { p_club: id, ...v }))} />
      <Section title="Announcements and moderation">
        <Txt variant="caption">Pin announcements so members see them first. Removing a post from the group records your reason; the author can ask for a review.</Txt>
        {posts.length === 0 ? <Txt color="textMuted">No posts yet.</Txt> : null}
        {posts.slice(0, 20).map((post) => (
          <Row
            key={`${post.id}-actions`}
            title={post.body?.slice(0, 40) || 'Post'}
            subtitle={`by @${post.author.handle}`}
            right={<>
              <Button variant="ghost" label="Pin" onPress={() => run.mutate(() => rpc('pin_club_post', { p_club: id, p_post: post.id, p_pinned: true }))} />
              <Button variant="ghost" label="Unpin" onPress={() => run.mutate(() => rpc('pin_club_post', { p_club: id, p_post: post.id, p_pinned: false }))} />
              <Button
                variant="ghost"
                label="Remove"
                onPress={() =>
                  Alert.alert('Remove from group?', 'The author is told the post was removed by an organizer.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => run.mutate(() => rpc('club_remove_post', { p_club: id, p_post: post.id, p_reason: 'Removed by an organizer for breaking group rules' })) }
                  ])
                }
              />
            </>}
          />
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
    <Section title="Group settings">
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
