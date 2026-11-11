import { useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtArea, fmtDistance } from '@/lib/format';
import { openGroupChat } from '@/chat/client';
import { useUnits } from '@/state/session';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, confirm, EmptyState, ErrorState, LoadingState, PressableScale, Screen, Section, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { ClubCover, ClubLogo } from '@/features/clubs/ClubBits';
import { useLayout } from '@/theme/layout';
import { PostCard, useFeed, type PostJson } from '@/features/social/PostCard';
import { kindLabel, roleLabel, useClub, useClubAdmin, useClubStats, useMembershipActions, type ClubDetail } from '@/features/clubs/api';
import { useCompetition } from '@/state/competition';
import { EventCard } from '@/features/events/EventCard';
import { useClubEvents } from '@/features/events/api';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** S29 Invitation or join request — identity, visibility, rules and Accept / Request / Join / Decline. */
function JoinPanel({ club }: { club: ClubDetail }) {
  const { join, respond } = useMembershipActions(club.id, club.kind, club.visibility);
  return (
    <Card accessibilityLabel="Membership">
      <Txt variant="headline">{club.my_state === 'invited' ? 'You are invited' : club.my_state === 'requested' ? 'Request sent' : `Join this ${club.kind === 'group' ? 'group' : 'community'}`}</Txt>
      <Txt color="textMuted">{club.kind === 'group' ? 'Private group: only members see its posts, members and chat.' : club.visibility === 'private' ? 'Members-only community: posts and members are visible to members only.' : 'Public community: anyone signed in can see it; posts can be members-only.'}</Txt>
      {club.rules ? (
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label">Rules</Txt>
          <Txt variant="caption">{club.rules}</Txt>
        </View>
      ) : null}
      {club.my_state === 'invited' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Accept" arrow onPress={() => respond.mutate(true)} loading={respond.isPending} style={{ flex: 1 }} />
          <Button label="Decline" variant="ghost" onPress={() => respond.mutate(false)} />
        </View>
      ) : club.my_state === 'requested' ? (
        <Badge icon="clock" label="An admin will review your request" tone="muted" />
      ) : club.join_policy === 'invite_only' ? (
        <Badge icon="lock" label="Joining is by invitation only" tone="muted" />
      ) : (
        <Button label={club.join_policy === 'open' ? 'Join' : 'Request to join'} size="lg" arrow onPress={() => join.mutate()} loading={join.isPending} />
      )}
    </Card>
  );
}

/** The owner offered me ownership: accept (I become owner, they stay as an admin) or decline. */
function OwnershipOffer({ club }: { club: ClubDetail }) {
  const admin = useClubAdmin(club);
  return (
    <Card tone="violet" accessibilityLabel="Ownership offer">
      <Txt variant="headline">{`You are offered ownership of ${club.name}`}</Txt>
      <Txt>{`As owner you can manage admins, branding and settings, and delete the ${club.kind === 'group' ? 'group' : 'community'}. The current owner stays as an admin.`}</Txt>
      {admin.respondOffer.error ? <Banner tone="danger" text={friendlyError(admin.respondOffer.error)} /> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button label="Accept" arrow style={{ flex: 1 }} loading={admin.respondOffer.isPending} onPress={() => admin.respondOffer.mutate(true)} />
        <Button label="Decline" variant="ghost" onPress={() => admin.respondOffer.mutate(false)} />
      </View>
    </Card>
  );
}

/** This week in the community or group (members only): runs, distance and land its members hold now. */
function ClubStatsCard({ clubId }: { clubId: string }) {
  const units = useUnits();
  const stats = useClubStats(clubId);
  const s = stats.data;
  if (!s) return null;
  return (
    <Card>
      <Txt variant="heading">This week</Txt>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {[
          { label: 'Runs', value: String(s.runs_this_week) },
          { label: 'Distance', value: fmtDistance(s.distance_this_week_m, units, 0) },
          { label: 'Runners', value: `${s.runners_this_week}/${s.members}` }
        ].map((x) => (
          <View key={x.label} style={{ flex: 1, gap: 2 }}>
            <Txt variant="metric" tabular numberOfLines={1} style={{ fontSize: 26, lineHeight: 30 }}>{x.value}</Txt>
            <Txt variant="caption">{x.label}</Txt>
          </View>
        ))}
      </View>
      {s.land_held_m2 > 0 ? <Txt color="textMuted">{`Members hold ${fmtArea(s.land_held_m2, units)} on the all-time map right now.`}</Txt> : null}
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
  const { leave } = useMembershipActions(id!, c?.kind ?? 'community', c?.visibility ?? 'public');
  const { width } = useWindowDimensions();
  const [chatError, setChatError] = useState<string | null>(null);
  const openChat = async () => {
    setChatError(null);
    try {
      const r = await openGroupChat(id!);
      track('club_action', { action: 'chat_opened', club_kind: 'group', visibility: 'private' });
      router.push({ pathname: '/inbox/[channel]', params: { channel: r.channelId, kind: 'group', title: r.name } });
    } catch (e) {
      setChatError(friendlyError(e));
    }
  };

  if (club.isLoading) return <Screen><Stack.Screen options={{ title: 'Club' }} /><LoadingState variant="cards" /></Screen>;
  if (club.error) return <Screen><Stack.Screen options={{ title: 'Club' }} /><ErrorState error={club.error} onRetry={() => void club.refetch()} /></Screen>;
  if (!c) return <Screen><Stack.Screen options={{ title: 'Club' }} /><EmptyState icon="clubs" title="This group is not available" body="It may be private, removed, or you may have been removed from it." /></Screen>;
  const organizer = c.my_role === 'owner' || c.my_role === 'organizer';
  const group = c.kind === 'group';
  const coverWidth = Math.min(contentMax, width) - gutter * 2;

  const header = (
    <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
      <Stack.Screen options={{ title: kindLabel(c.kind) }} />
      <View>
        <ClubCover club={c} width={coverWidth} height={group ? 104 : 148} />
        <View style={{ marginTop: -36, marginLeft: spacing.lg, alignSelf: 'flex-start', borderRadius: 26, borderWidth: 4, borderColor: p.bg }}>
          <ClubLogo club={c} size={72} />
        </View>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Txt variant="display" style={{ fontSize: 32, lineHeight: 36 }}>{c.name}</Txt>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Badge tone="violet" icon={group ? 'chat' : 'clubs'} label={kindLabel(c.kind)} />
          <Badge tone="muted" icon={c.visibility === 'private' ? 'lock' : 'eye'} label={group ? 'Private' : c.visibility === 'private' ? 'Members only' : c.join_policy === 'invite_only' ? 'Public · invitation only' : 'Public'} />
          {c.city_label ? <Badge tone="muted" icon="pin" label={c.city_label} /> : null}
          <Badge tone="muted" icon="user" label={`${c.member_count} members`} />
        </View>
        {c.description ? <Txt>{c.description}</Txt> : null}
        {c.organizers.length ? <Txt variant="caption">{c.organizers.map((o) => `${o.display_name} (${roleLabel(o.role as 'owner' | 'organizer')})`).join(', ')}</Txt> : null}
      </View>
      {c.status !== 'active' ? <Banner tone="warning" text={`This ${group ? 'group' : 'community'} is suspended.`} /> : null}
      {c.ownership_offer?.to_me ? <OwnershipOffer club={c} /> : null}
      {!member ? <JoinPanel club={c} /> : null}
      {member ? (
        <View style={styles.tiles}>
          {group ? <ActionTile icon="chat" label="Chat" onPress={() => void openChat()} /> : null}
          <ActionTile icon="user" label="Members" onPress={() => router.push({ pathname: '/club/[id]/members', params: { id: c.id } })} />
          <ActionTile icon="medal" label="Rankings" onPress={() => router.push({ pathname: '/club/[id]/rankings', params: { id: c.id } })} />
          {!group && (c.posting_policy === 'members' || organizer) ? <ActionTile icon="edit" label="Post" onPress={() => router.push({ pathname: '/compose', params: { club: c.id } })} /> : null}
          {organizer ? <ActionTile icon="settings" label="Manage" count={c.pending_requests} onPress={() => router.push({ pathname: '/club/[id]/organizer', params: { id: c.id } })} /> : null}
        </View>
      ) : null}
      {chatError ? <Banner tone="danger" text={chatError} /> : null}
      {member ? <ClubStatsCard clubId={c.id} /> : null}
      {member && clubCompetition ? (
        <Card tone="orange">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="hexagon" color="#121318" size={22} />
            <Txt variant="heading" style={{ flex: 1 }}>{group ? 'Group race' : "Members' race"}</Txt>
          </View>
          <Txt color="textMuted">{`Land and route titles in ${clubCompetition.name} are separate from the all-time map and the public race.`}</Txt>
          <Button label="Open on the map" arrow onPress={() => { select(clubCompetition.id); router.push('/map'); }} />
        </Card>
      ) : null}
      {member ? <ClubChallenges clubId={c.id} organizer={organizer} /> : null}
      {member && pins.data?.length ? (
        <Section title="Announcements" icon="bell">
          {pins.data.slice(0, 3).map((post) => <PostCard key={post.id} post={post} />)}
        </Section>
      ) : null}
      {member ? <Txt variant="headline">{group ? 'Posts' : 'Community feed'}</Txt> : null}
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
      ListEmptyComponent={member ? (feed.isLoading ? <LoadingState /> : <EmptyState icon="chat" title="No posts yet" body={`Be the first to post in this ${group ? 'group' : 'community'}.`} />) : undefined}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
      ListFooterComponent={
        member ? (
          <Button variant="ghost" icon="logout" label={`Leave ${group ? 'group' : 'community'}`} onPress={() => c.my_role === 'owner' && c.member_count > 1
            ? confirm('Choose a new owner first',
                `You own this ${group ? 'group' : 'community'}. Offer ownership to a member in Manage; once they accept you become an admin and can leave. Everyone else stays.`,
                'Open Manage', () => router.push({ pathname: '/club/[id]/organizer', params: { id: c.id } }), false)
            : confirm(
                `Leave this ${group ? 'group' : 'community'}?`,
                c.my_role === 'owner' ? `You are the only member, so leaving closes the ${group ? 'group' : 'community'} for good.` : group ? 'Only a member can add you back.' : 'You can rejoin later if the community allows it.',
                'Leave', () => leave.mutate())} />
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
