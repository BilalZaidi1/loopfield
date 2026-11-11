import { FlatList, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, confirm, EmptyState, ErrorState, LoadingState, PressableScale, Screen, Section, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { ClubMonogram, clubTone } from '@/features/clubs/ClubBits';
import { useLayout } from '@/theme/layout';
import { PostCard, useFeed, type PostJson } from '@/features/social/PostCard';
import { useClub, useMembershipActions, type ClubDetail } from '@/features/clubs/api';
import { useCompetition } from '@/state/competition';
import { EventCard } from '@/features/events/EventCard';
import { useClubEvents } from '@/features/events/api';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** S29 Invitation or join request — identity, visibility, rules and Accept / Request / Join / Decline. */
function JoinPanel({ club }: { club: ClubDetail }) {
  const { join, respond } = useMembershipActions(club.id, club.kind, club.visibility);
  return (
    <Card accessibilityLabel="Membership">
      <Txt variant="headline">{club.my_state === 'invited' ? 'You are invited' : club.my_state === 'requested' ? 'Request sent' : 'Join this group'}</Txt>
      <Txt color="textMuted">{club.visibility === 'private' ? 'Private group: posts and members are visible to members only.' : 'Public group: anyone signed in can see it; posts can be members-only.'}</Txt>
      {club.rules ? (
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label">Group rules</Txt>
          <Txt variant="caption">{club.rules}</Txt>
        </View>
      ) : null}
      {club.my_state === 'invited' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Accept" arrow onPress={() => respond.mutate(true)} loading={respond.isPending} style={{ flex: 1 }} />
          <Button label="Decline" variant="ghost" onPress={() => respond.mutate(false)} />
        </View>
      ) : club.my_state === 'requested' ? (
        <Badge icon="clock" label="An organizer will review your request" tone="muted" />
      ) : club.join_policy === 'invite_only' ? (
        <Badge icon="lock" label="Joining is by invitation only" tone="muted" />
      ) : (
        <Button label={club.join_policy === 'open' ? 'Join' : 'Request to join'} size="lg" arrow onPress={() => join.mutate()} loading={join.isPending} />
      )}
    </Card>
  );
}

function ActionTile({ icon, label, onPress, count }: { icon: IconName; label: string; onPress: () => void; count?: number | null }) {
  const p = usePalette();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} waiting` : label} style={[styles.tile, { backgroundColor: p.surface }]}>
      <View style={[styles.tileIcon, { backgroundColor: p.primarySoft }]}>
        <Icon name={icon} color={p.primary} size={22} />
      </View>
      <Txt variant="label" numberOfLines={2} align="center">{label}</Txt>
      {count ? <View style={[styles.count, { backgroundColor: p.orange }]}><Txt variant="micro" style={{ color: '#121318' }}>{String(count)}</Txt></View> : null}
    </PressableScale>
  );
}

/** The club's challenges (members only): running and upcoming ones, and a way for organisers to add one. */
function ClubChallenges({ clubId, organizer }: { clubId: string; organizer: boolean }) {
  const events = useClubEvents(clubId);
  const current = (events.data ?? []).filter((e) => e.phase === 'live' || e.phase === 'upcoming' || e.phase === 'finishing');
  if (!organizer && !current.length) return null;
  return (
    <Section title="Challenges" icon="flag">
      {current.map((e) => <EventCard key={e.id} event={e} />)}
      {!current.length ? <Txt color="textMuted">No challenge running. Set one for your members: a distance goal or a land race.</Txt> : null}
      {organizer ? <Button label="Create a challenge" variant="secondary" icon="plus" onPress={() => router.push({ pathname: '/events/new', params: { club: clubId } })} /> : null}
    </Section>
  );
}

/** S30 Club or community home — group feed, pinned announcements, members, territory season and route links. */
export default function ClubHome() {
  const p = usePalette();
  const { gutter, contentMax } = useLayout();
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

  if (club.isLoading) return <Screen><Stack.Screen options={{ title: 'Club' }} /><LoadingState variant="cards" /></Screen>;
  if (club.error) return <Screen><Stack.Screen options={{ title: 'Club' }} /><ErrorState error={club.error} onRetry={() => void club.refetch()} /></Screen>;
  if (!c) return <Screen><Stack.Screen options={{ title: 'Club' }} /><EmptyState icon="clubs" title="This group is not available" body="It may be private, removed, or you may have been removed from it." /></Screen>;
  const organizer = c.my_role === 'owner' || c.my_role === 'organizer';
  const tone = clubTone(c.id);

  const header = (
    <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
      <Stack.Screen options={{ title: c.kind === 'club' ? 'Club' : 'Community' }} />
      <Card tone={tone}>
        <ClubMonogram name={c.name} tone={tone} size={64} inverted />
        <Txt variant="display" style={{ fontSize: 34, lineHeight: 38 }}>{c.name}</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Badge icon={c.kind === 'club' ? 'clubs' : 'globe'} label={c.kind === 'club' ? 'Club' : 'Community'} />
          <Badge icon={c.visibility === 'private' ? 'lock' : 'eye'} label={c.visibility === 'private' ? 'Private' : 'Public'} />
          {c.city_label ? <Badge icon="pin" label={c.city_label} /> : null}
          <Badge icon="user" label={`${c.member_count} members`} />
        </View>
        {c.description ? <Txt>{c.description}</Txt> : null}
        {c.organizers.length ? <Txt variant="caption">{`Organizers: ${c.organizers.map((o) => o.display_name).join(', ')}`}</Txt> : null}
      </Card>
      {c.status !== 'active' ? <Banner tone="warning" text="This group is suspended." /> : null}
      {!member ? <JoinPanel club={c} /> : null}
      {member ? (
        <View style={styles.tiles}>
          <ActionTile icon="clubs" label="Members" onPress={() => router.push({ pathname: '/club/[id]/members', params: { id: c.id } })} />
          <ActionTile icon="medal" label="Rankings" onPress={() => router.push({ pathname: '/club/[id]/rankings', params: { id: c.id } })} />
          {c.posting_policy === 'members' || organizer ? <ActionTile icon="edit" label="Post" onPress={() => router.push({ pathname: '/compose', params: { club: c.id } })} /> : null}
          {organizer ? <ActionTile icon="settings" label="Organizer tools" count={c.pending_requests} onPress={() => router.push({ pathname: '/club/[id]/organizer', params: { id: c.id } })} /> : null}
        </View>
      ) : null}
      {member && clubCompetition ? (
        <Card tone="orange">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="hexagon" color="#121318" size={22} />
            <Txt variant="heading" style={{ flex: 1 }}>Club territory season</Txt>
          </View>
          <Txt color="textMuted">{`Land and route titles in ${clubCompetition.name} are separate from the all-time map and the public race.`}</Txt>
          <Button label="Open club map" arrow onPress={() => { select(clubCompetition.id); router.push('/map'); }} />
        </Card>
      ) : null}
      {member ? <ClubChallenges clubId={c.id} organizer={organizer} /> : null}
      {member && pins.data?.length ? (
        <Section title="Announcements" icon="bell">
          {pins.data.slice(0, 3).map((post) => <PostCard key={post.id} post={post} />)}
        </Section>
      ) : null}
      {member ? <Txt variant="headline">Group feed</Txt> : null}
    </View>
  );

  const items = feed.data?.pages.flat() ?? [];
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.huge, gap: spacing.lg, width: '100%', maxWidth: contentMax, alignSelf: 'center' }}
      data={member ? items : []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={member ? (feed.isLoading ? <LoadingState /> : <EmptyState icon="chat" title="No posts yet" body="Be the first to post in this group." />) : undefined}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
      ListFooterComponent={
        member && c.my_role !== 'owner' ? (
          <Button variant="ghost" icon="logout" label="Leave group" onPress={() => confirm('Leave this group?', 'You can rejoin later if the group allows it.', 'Leave', () => leave.mutate())} />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, minHeight: 96, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.sm },
  tileIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: 8, right: 8, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }
});
