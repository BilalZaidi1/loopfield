import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea, splitValue } from '@/lib/format';
import { Avatar, BigNumber, Button, Card, EmptyState, IconButton, ListGroup, LoadingState, Row, Screen, Section, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { ClubLogo } from '@/features/clubs/ClubBits';
import { BadgeStrip } from '@/features/achievements/Badges';
import { useAchievementProfile, useMyChallenges } from '@/features/achievements/api';
import { useMovement } from '@/features/movement/api';
import { useLayout } from '@/theme/layout';
import { kindLabel, roleLabel, useMyClubs } from '@/features/clubs/api';
import { useSignedUrl } from '@/features/social/media';
import { PostCard, useFeed } from '@/features/social/PostCard';
import { useProfileCard } from '@/features/social/profile';
import { useCompetition } from '@/state/competition';
import { useMyTerritorySummary } from '@/features/territory/useTerritoryStats';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S35 My profile — identity, followers/following, own posts, land and titles, clubs, season history and settings. */
export default function MyProfile() {
  const p = usePalette();
  const { gutter, contentMax } = useLayout();
  const units = useUnits();
  const { userId, profile, roles } = useSession();
  const { competition, season, home, homeSeason } = useCompetition();
  const card = useProfileCard(userId ?? undefined);
  const avatar = useSignedUrl('avatars', profile?.avatar_path);
  // Held now (the all-time map, or the club race you record for) and this season's race, side by side.
  const land = useMyTerritorySummary('home');
  const raceLand = useMyTerritorySummary('race');
  const separateRace = Boolean(home && competition && home.id !== competition.id);
  const titles = useQuery({ queryKey: ['my_titles'], queryFn: () => rpc<{ course_id: string; course_name: string; benchmark_ms: number; competition_id: string }[]>('my_titles') });
  const clubs = useMyClubs();
  const posts = useFeed('profile_posts', { p_profile: userId }, Boolean(userId));
  const achievements = useAchievementProfile();
  const challenges = useMyChallenges();
  const movement = useMovement();
  if (!profile) return <Screen><LoadingState variant="cards" /></Screen>;
  const activeClubs = (clubs.data ?? []).filter((c) => c.state === 'active');
  const area = land.data ? splitValue(fmtArea(land.data.published_area_m2, units)) : null;
  const raceArea = raceLand.data ? fmtArea(raceLand.data.published_area_m2, units) : null;

  const header = (
    <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
      <Stack.Screen options={{ title: 'My profile', headerRight: () => <IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} /> }} />
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Pressable onPress={() => router.push('/settings/profile')} accessibilityRole="button" accessibilityLabel="Edit profile">
          <Avatar name={profile.display_name} uri={avatar.data} size={104} ring />
          <View style={[styles.editBadge, { backgroundColor: p.primaryFill, borderColor: p.bg }]}>
            <Icon name="edit" color="#FFFFFF" size={16} />
          </View>
        </Pressable>
        <Txt variant="title" align="center">{profile.display_name}</Txt>
        <Txt variant="caption" align="center">{`@${profile.handle}${profile.city_label ? ` · ${profile.city_label}` : ''} · ${profile.visibility === 'private' ? 'Private profile' : 'Public profile'}`}</Txt>
        {profile.bio ? <Txt align="center" style={{ maxWidth: 520 }}>{profile.bio}</Txt> : null}
      </View>
      <Card padded={false} style={{ flexDirection: 'row', paddingVertical: spacing.lg }}>
        <Pressable style={styles.count} onPress={() => router.push({ pathname: '/connections', params: { tab: 'followers' } })} accessibilityRole="button" accessibilityLabel={`${card.data?.followers ?? 0} followers`}>
          <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(card.data?.followers ?? '—')}</Txt>
          <Txt variant="caption">Followers</Txt>
        </Pressable>
        <View style={{ width: 1, backgroundColor: p.border }} />
        <Pressable style={styles.count} onPress={() => router.push({ pathname: '/connections', params: { tab: 'following' } })} accessibilityRole="button" accessibilityLabel={`${card.data?.following ?? 0} following`}>
          <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(card.data?.following ?? '—')}</Txt>
          <Txt variant="caption">Following</Txt>
        </Pressable>
        <View style={{ width: 1, backgroundColor: p.border }} />
        <Pressable style={styles.count} onPress={() => router.push('/clubs')} accessibilityRole="button" accessibilityLabel={`${activeClubs.length} clubs`}>
          <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(activeClubs.length)}</Txt>
          <Txt variant="caption">Clubs</Txt>
        </Pressable>
      </Card>
      <Section title="Achievements" icon="medal" onSeeAll={() => router.push('/achievements')} seeAllLabel="Challenges">
        <Card tone="ink" onPress={() => router.push('/achievements/ranking')}
          accessibilityLabel={achievements.data?.global_rank ? `Global rank ${achievements.data.global_rank} of ${achievements.data.ranked_runners}, score ${achievements.data.score}. Open the ranking` : 'Not ranked yet. Open the ranking'}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">Global rank</Txt>
              <Txt variant="display" tabular>{achievements.data?.global_rank ? `#${achievements.data.global_rank}` : '–'}</Txt>
              <Txt variant="caption">{achievements.data?.global_rank ? `of ${achievements.data.ranked_runners?.toLocaleString()} runners · score ${achievements.data.score}` : 'Earn a badge to be ranked'}</Txt>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Txt variant="metric" tabular style={{ fontSize: 26, lineHeight: 30 }}>{`${achievements.data?.badges ?? 0}/${challenges.data?.length ?? 24}`}</Txt>
              <Txt variant="caption">challenges done</Txt>
            </View>
          </View>
          <BadgeStrip badges={achievements.data?.earned ?? []} onPress={() => router.push('/achievements')} empty="No badges yet. Every verified run counts toward the distance challenges." />
        </Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <StatTile icon="bolt" bg={p.greenSoft} fg={p.greenText} value={(movement.data?.balance ?? 0).toLocaleString()} label="Movement points" caption="To spend"
            onPress={() => router.push('/points')} accessibilityLabel={`${movement.data?.balance ?? 0} movement points. Open points`} />
          <StatTile icon="hexagon" bg={p.primarySoft} fg={p.primary} value={area ? area.value : '0'} label={area ? `${area.unit} of land` : 'Land'} caption="Held now"
            onPress={() => router.push('/map')} accessibilityLabel={area ? `Land held now: ${area.value} ${area.unit}` : 'No land held yet'} />
          <StatTile icon="crown" bg={p.orangeSoft} fg={p.orangeText} value={String(titles.data?.length ?? 0)} label={titles.data?.length === 1 ? 'Route title' : 'Route titles'} caption={season ? `Season ${season.number}` : 'This season'}
            onPress={() => router.push('/seasons')} accessibilityLabel={`${titles.data?.length ?? 0} route titles held`} />
        </View>
      </Section>
      <Card tone="violet" accessibilityLabel="Your land">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="hexagon" color="#FFFFFF" size={22} />
          <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1}>{home ? (home.kind === 'permanent' ? 'Land held now' : `Land · ${home.name}`) : 'Land'}</Txt>
        </View>
        {land.data && area ? (
          <>
            <BigNumber value={area.value} unit={area.unit} size={60} />
            <Txt color="textMuted">{`${land.data.published_cells} published cells${land.data.provisional_cells ? ` · ${land.data.provisional_cells} provisional` : ''}`}</Txt>
          </>
        ) : <Txt>{homeSeason ? 'No land yet. Close an eligible loop to claim some.' : 'No active season.'}</Txt>}
        {separateRace && season ? (
          <Txt color="textMuted">{`Season ${season.number} race: ${raceArea ?? '0'} so far. The race starts fresh every season; land held now stays until someone takes it.`}</Txt>
        ) : null}
        <Button label="Open the map" arrow onPress={() => router.push('/map')} />
      </Card>
      <Section title="Route titles" icon="crown">
        {titles.data?.length ? (
          <ListGroup>
            {titles.data.map((t) => <Row key={`${t.course_id}-${t.competition_id}`} icon="crown" title={t.course_name} value={formatDuration(t.benchmark_ms)} onPress={() => router.push({ pathname: '/routes/[id]', params: { id: t.course_id } })} />)}
          </ListGroup>
        ) : <Txt color="textMuted">You hold no route titles right now.</Txt>}
      </Section>
      <Section title="Clubs and communities" icon="clubs">
        {activeClubs.length ? (
          <ListGroup>
            {activeClubs.map((c) => <Row key={c.id} leading={<ClubLogo club={c} size={40} />} title={c.name} subtitle={`${kindLabel(c.kind)} · ${c.role !== 'member' ? roleLabel(c.role) : `${c.member_count} members`}`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />)}
          </ListGroup>
        ) : <Txt color="textMuted">None yet.</Txt>}
      </Section>
      <ListGroup>
        <Row icon="clubs" title="Connections" subtitle="Followers, following and requests" onPress={() => router.push('/connections')} />
        <Row icon="edit" title="Edit profile" onPress={() => router.push('/settings/profile')} />
        <Row icon="calendar" title="Season history" onPress={() => router.push('/seasons')} />
        <Row icon="settings" title="Settings" subtitle="Privacy, notifications, theme and account" onPress={() => router.push('/settings')} />
        {roles.length ? <Row icon="shield" title="Operator tools" onPress={() => router.push('/ops')} /> : null}
      </ListGroup>
      <Txt variant="headline">Your posts</Txt>
    </View>
  );
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.huge, gap: spacing.lg, width: '100%', maxWidth: contentMax, alignSelf: 'center' }}
      data={posts.data?.pages.flat() ?? []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={posts.isLoading ? <LoadingState /> : <EmptyState icon="edit" title="You have not posted yet" action={{ label: 'Write a post', onPress: () => router.push('/compose') }} />}
      onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && void posts.fetchNextPage()}
    />
  );
}

/** One of the three equal profile tiles: icon, number, what it counts, and its scope. */
function StatTile({ icon, bg, fg, value, label, caption, onPress, accessibilityLabel }: { icon: IconName; bg: string; fg: string; value: string; label: string; caption: string; onPress: () => void; accessibilityLabel: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: spacing.xs }} onPress={onPress} accessibilityLabel={accessibilityLabel}>
      <View style={[styles.tileIcon, { backgroundColor: bg }]}>
        <Icon name={icon} color={fg} size={24} />
      </View>
      <Txt variant="metric" tabular align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 26, lineHeight: 30, alignSelf: 'stretch' }}>{value}</Txt>
      <Txt variant="label" align="center" numberOfLines={2}>{label}</Txt>
      <Txt variant="caption" align="center" numberOfLines={2}>{caption}</Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  count: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  editBadge: { position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' }
});
