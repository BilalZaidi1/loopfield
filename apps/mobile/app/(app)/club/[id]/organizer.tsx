import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Avatar, Banner, Button, Card, confirm, EmptyState, ListGroup, LoadingState, Row, Screen, Section, Segmented, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/state/session';
import { BrandingEditor } from '@/features/clubs/BrandingEditor';
import { useClub, useClubAdmin, type ClubDetail } from '@/features/clubs/api';
import { useFeed } from '@/features/social/PostCard';

interface Pending {
  user_id: string;
  handle: string;
  display_name: string;
}

/**
 * S33 Manage a community or group (owner and admins): join requests, branding with a preview before
 * saving, name and description, who can see and join it, announcements and moderation; for the owner,
 * handing ownership to a member (who must accept) and deleting it.
 */
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
  if (!c || (c.my_role !== 'owner' && c.my_role !== 'organizer')) return <Screen><EmptyState title="Admins only" /></Screen>;
  const posts = feed.data?.pages.flat() ?? [];
  const group = c.kind === 'group';
  const owner = c.my_role === 'owner';

  return (
    <Screen>
      <Stack.Screen options={{ title: `Manage ${group ? 'group' : 'community'}` }} />
      <BrandingEditor key={`b-${c.id}`} club={c} />
      {!group ? (
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
      ) : null}
      <ClubSettingsForm key={c.id} club={c} saving={run.isPending} onSave={(v) => run.mutate(() => rpc('update_club', { p_club: id, ...v }))} />
      {owner && !group ? <VisibilityForm key={`v-${c.id}`} club={c} /> : null}
      {!group ? (
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
                  Alert.alert('Remove this post?', 'The author is told an admin removed it and can ask for a review.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => run.mutate(() => rpc('club_remove_post', { p_club: id, p_post: post.id, p_reason: 'Removed by an admin for breaking the community rules' })) }
                  ])
                }
              />
            </View>
          </Card>
        ))}
      </Section>
      ) : null}
      {run.isSuccess ? <Banner tone="success" text="Saved." /> : null}
      {owner ? <OwnershipSection club={c} /> : null}
      {owner ? <DeleteSection club={c} /> : null}
    </Screen>
  );
}

/** Community visibility (owner): anyone, members only, and how people join. */
function VisibilityForm({ club }: { club: ClubDetail }) {
  const admin = useClubAdmin(club);
  const [visibility, setVisibility] = useState<'public' | 'private'>(club.visibility);
  const [join, setJoin] = useState<'open' | 'request' | 'invite_only'>(club.join_policy);
  const changed = visibility !== club.visibility || join !== club.join_policy;
  return (
    <Section title="Who can see and join" icon="eye">
      <Segmented label="Who can see it" value={visibility} onChange={(v) => { setVisibility(v); if (v === 'private' && join === 'open') setJoin('request'); }} options={[{ value: 'public', label: 'Anyone' }, { value: 'private', label: 'Members only' }]} />
      <Segmented label="How people join" value={join} onChange={setJoin} options={[...(visibility === 'public' ? [{ value: 'open' as const, label: 'Open' }] : []), { value: 'request', label: 'Request' }, { value: 'invite_only', label: 'Invite only' }]} />
      {admin.visibility.error ? <Banner tone="danger" text={friendlyError(admin.visibility.error)} /> : null}
      {changed ? <Button label="Save" loading={admin.visibility.isPending} onPress={() => admin.visibility.mutate({ visibility, joinPolicy: join })} /> : null}
    </Section>
  );
}

/** Hand ownership to an active member: they accept or decline; until then nothing changes. */
function OwnershipSection({ club }: { club: ClubDetail }) {
  const admin = useClubAdmin(club);
  const members = useQuery({ queryKey: ['club_members', club.id, 'active'], queryFn: () => rpc<Pending[]>('club_members', { p_club: club.id, p_state: 'active', p_limit: 200 }) });
  const { userId } = useSession();
  const offer = club.ownership_offer;
  const others = (members.data ?? []).filter((m) => m.user_id !== userId);
  return (
    <Section title="Ownership" icon="crown">
      {offer && !offer.to_me ? (
        <Card tone="soft">
          <Txt>{`Waiting for ${offer.to?.display_name ?? 'the member'} to accept ownership (until ${fmtDate(offer.expires_at)}).`}</Txt>
          <Button label="Withdraw the offer" variant="ghost" loading={admin.cancelOffer.isPending} onPress={() => admin.cancelOffer.mutate()} />
        </Card>
      ) : others.length ? (
        <>
          <Txt color="textMuted">Choose who takes over. They are asked first; once they accept you stay on as an admin.</Txt>
          <ListGroup>
            {others.slice(0, 30).map((m) => (
              <Row key={m.user_id} leading={<Avatar name={m.display_name} size={36} />} title={m.display_name} subtitle={`@${m.handle}`}
                onPress={() => confirm(`Offer ownership to ${m.display_name}?`, 'They become the owner when they accept. You stay as an admin.', 'Offer', () => admin.offer.mutate(m.user_id), false)} />
            ))}
          </ListGroup>
        </>
      ) : <Txt color="textMuted">There is nobody else to hand ownership to yet.</Txt>}
      {admin.offer.error ? <Banner tone="danger" text={friendlyError(admin.offer.error)} /> : null}
      <Txt variant="caption">{"To leave, hand ownership over first. If the owner's account is deleted or removed, the longest-serving admin takes over automatically (or the longest-serving member)."}</Txt>
    </Section>
  );
}

/** Delete, after typing the name, with what happens to everything spelled out first. */
function DeleteSection({ club }: { club: ClubDetail }) {
  const admin = useClubAdmin(club);
  const [name, setName] = useState('');
  const what = club.kind === 'group' ? 'group' : 'community';
  return (
    <Section title={`Delete ${what}`} icon="trash">
      <Txt color="textMuted">{`Deleting removes every member, takes its posts out of all feeds, ends its members' race, cancels running challenges${club.kind === 'group' ? ', deletes the group chat' : ''} and deletes its logo and cover. Members are told. Runs, land on the all-time map and everyone's own posts elsewhere are not affected. This cannot be undone.`}</Txt>
      <TextField label={`Type "${club.name}" to confirm`} value={name} onChangeText={setName} autoCapitalize="none" />
      {admin.remove.error ? <Banner tone="danger" text={friendlyError(admin.remove.error)} /> : null}
      <Button label={`Delete ${what}`} variant="danger" loading={admin.remove.isPending} disabled={name.trim().toLowerCase() !== club.name.trim().toLowerCase()}
        onPress={() => admin.remove.mutate(name, { onSuccess: () => router.replace('/clubs') })} />
    </Section>
  );
}

function ClubSettingsForm({ club, saving, onSave }: { club: ClubDetail; saving: boolean; onSave: (v: { p_name: string; p_description: string; p_rules: string | null; p_posting_policy: string }) => void }) {
  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? '');
  const [rules, setRules] = useState(club.rules ?? '');
  const [posting, setPosting] = useState<'members' | 'organizers'>(club.posting_policy);
  const group = club.kind === 'group';
  return (
    <Section title="Name and details" icon="edit">
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} />
      {!group ? <TextField label="Rules" value={rules} onChangeText={setRules} multiline maxLength={2000} /> : null}
      {!group ? <Segmented label="Who can post" value={posting} onChange={setPosting} options={[{ value: 'members', label: 'All members' }, { value: 'organizers', label: 'Admins only' }]} /> : null}
      <Button label="Save" onPress={() => onSave({ p_name: name.trim(), p_description: description, p_rules: group ? null : rules, p_posting_policy: posting })} loading={saving} disabled={name.trim().length < 3} />
    </Section>
  );
}
