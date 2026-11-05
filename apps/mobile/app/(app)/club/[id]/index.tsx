import { FlatList, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Txt , confirm } from '@/components/ui';
import { PostCard, useFeed, type PostJson } from '@/features/social/PostCard';
import { useClub, useMembershipActions, type ClubDetail } from '@/features/clubs/api';
import { useCompetition } from '@/state/competition';
import { spacing, usePalette } from '@/theme/tokens';

/** S29 Invitation or join request — identity, visibility, rules and Accept / Request / Join / Decline. */
function JoinPanel({ club }: { club: ClubDetail }) {
  const { join, respond } = useMembershipActions(club.id, club.kind, club.visibility);
  return (
    <Card accessibilityLabel="Membership">
      <Txt variant="heading">{club.my_state === 'invited' ? 'You are invited' : club.my_state === 'requested' ? 'Request sent' : 'Join this group'}</Txt>
      <Txt color="textMuted">{club.visibility === 'private' ? 'Private group: posts and members are visible to members only.' : 'Public group: anyone signed in can see it; posts can be members-only.'}</Txt>
      {club.rules ? <Txt variant="caption">Rules: {club.rules}</Txt> : null}
      {club.my_state === 'invited' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Accept" onPress={() => respond.mutate(true)} loading={respond.isPending} style={{ flex: 1 }} />
          <Button label="Decline" variant="secondary" onPress={() => respond.mutate(false)} style={{ flex: 1 }} />
        </View>
      ) : club.my_state === 'requested' ? (
        <Txt>An organizer will review your request.</Txt>
      ) : club.join_policy === 'invite_only' ? (
        <Txt>Joining is by invitation only.</Txt>
      ) : (
        <Button label={club.join_policy === 'open' ? 'Join' : 'Request to join'} onPress={() => join.mutate()} loading={join.isPending} />
      )}
    </Card>
  );
}

/** S30 Club or community home — group feed, pinned announcements, members, territory season and route links. */
export default function ClubHome() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const club = useClub(id);
  const c = club.data;
  const member = c?.my_state === 'active';
  const feed = useFeed('club_feed', { p_club: id }, Boolean(member));
  const pins = useQuery({
    queryKey: ['club_pins', id],
    enabled: Boolean(member),
    queryFn: async () => {
      const { data, error } = await supabase().from('club_pins').select('post_id').eq('club_id', id!).limit(3);
      if (error) throw error;
      const posts = await Promise.all((data ?? []).map((r) => rpc<PostJson | null>('post_detail', { p_post: r.post_id })));
      return posts.filter((x): x is PostJson => Boolean(x));
    }
  });
  const { competitions, select } = useCompetition();
  const clubCompetition = competitions.find((x) => x.club_id === id);
  const { leave } = useMembershipActions(id!, c?.kind ?? 'club', c?.visibility ?? 'public');

  if (club.isLoading) return <LoadingState />;
  if (club.error) return <ErrorState error={club.error} onRetry={() => void club.refetch()} />;
  if (!c) return <Screen><EmptyState title="This group is not available" body="It may be private, removed, or you may have been removed from it." /></Screen>;
  const organizer = c.my_role === 'owner' || c.my_role === 'organizer';

  const header = (
    <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
      <Stack.Screen options={{ title: c.name }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Badge label={c.kind === 'club' ? 'Club' : 'Community'} />
        <Badge label={c.visibility === 'private' ? 'Private' : 'Public'} tone="muted" />
        {c.city_label ? <Badge label={c.city_label} tone="muted" /> : null}
        <Badge label={`${c.member_count} members`} tone="muted" />
      </View>
      {c.status !== 'active' ? <Banner tone="warning" text="This group is suspended." /> : null}
      {c.description ? <Txt>{c.description}</Txt> : null}
      {c.organizers.length ? <Txt variant="caption">Organizers: {c.organizers.map((o) => o.display_name).join(', ')}</Txt> : null}
      {!member ? <JoinPanel club={c} /> : null}
      {member ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button variant="secondary" label="Members" onPress={() => router.push({ pathname: '/club/[id]/members', params: { id: c.id } })} />
          <Button variant="secondary" label="Rankings" onPress={() => router.push({ pathname: '/club/[id]/rankings', params: { id: c.id } })} />
          {c.posting_policy === 'members' || organizer ? <Button variant="secondary" label="Post" onPress={() => router.push({ pathname: '/compose', params: { club: c.id } })} /> : null}
          {organizer ? <Button variant="secondary" label={`Organizer tools${c.pending_requests ? ` (${c.pending_requests})` : ''}`} onPress={() => router.push({ pathname: '/club/[id]/organizer', params: { id: c.id } })} /> : null}
        </View>
      ) : null}
      {member && clubCompetition ? (
        <Card>
          <Txt variant="heading">Club territory season</Txt>
          <Txt color="textMuted">Land and route titles in {clubCompetition.name} are separate from the public map.</Txt>
          <Button variant="secondary" label="Open club map" onPress={() => { select(clubCompetition.id); router.push('/map'); }} />
        </Card>
      ) : null}
      {member && pins.data?.length ? (
        <View style={{ gap: spacing.sm }}>
          <Txt variant="heading">Announcements</Txt>
          {pins.data.slice(0, 3).map((post) => <PostCard key={post.id} post={post} />)}
        </View>
      ) : null}
      {member ? <Txt variant="heading">Group feed</Txt> : null}
    </View>
  );

  const items = feed.data?.pages.flat() ?? [];
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={member ? items : []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={member ? (feed.isLoading ? <LoadingState /> : <EmptyState title="No posts yet" body="Be the first to post in this group." />) : undefined}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
      ListFooterComponent={
        member && c.my_role !== 'owner' ? (
          <Button variant="ghost" label="Leave group" onPress={() => confirm('Leave this group?', 'You can rejoin later if the group allows it.', 'Leave', () => leave.mutate())} />
        ) : undefined
      }
    />
  );
}
