import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea, splitValue } from '@/lib/format';
import { Avatar, Button, Card, EmptyState, IconButton, ListGroup, LoadingState, Medal, Row, Screen, Section, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ClubMonogram, clubTone } from '@/features/clubs/ClubBits';
import { useLayout } from '@/theme/layout';
import { useMyClubs } from '@/features/clubs/api';
import { useSignedUrl } from '@/features/social/media';
import { PostCard, useFeed } from '@/features/social/PostCard';
import { useProfileCard } from '@/features/social/profile';
import { useCompetition } from '@/state/competition';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S35 My profile — identity, followers/following, own posts, land and titles, clubs, season history and settings. */
export default function MyProfile() {
  const p = usePalette();
  const { gutter, contentMax } = useLayout();
  const units = useUnits();
  const { userId, profile, roles } = useSession();
  const { competition, season } = useCompetition();
  const card = useProfileCard(userId ?? undefined);
  const avatar = useSignedUrl('avatars', profile?.avatar_path);
  const land = useQuery({
    queryKey: ['my_territory_summary', competition?.id, season?.id],
    enabled: Boolean(competition && season),
    queryFn: async () => (await rpc<{ published_area_m2: number; published_cells: number; provisional_cells: number }[]>('my_territory_summary', { p_competition: competition!.id, p_season: season!.id }))[0] ?? null
  });
  const titles = useQuery({ queryKey: ['my_titles'], queryFn: () => rpc<{ course_id: string; course_name: string; benchmark_ms: number; competition_id: string }[]>('my_titles') });
  const clubs = useMyClubs();
  const posts = useFeed('profile_posts', { p_profile: userId }, Boolean(userId));
  if (!profile) return <Screen><LoadingState variant="cards" /></Screen>;
  const activeClubs = (clubs.data ?? []).filter((c) => c.state === 'active');
  const area = land.data ? splitValue(fmtArea(land.data.published_area_m2, units)) : null;

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
      <Section title="Achievements" icon="medal">
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Card style={{ flex: 1, alignItems: 'center' }} onPress={() => router.push('/map')} accessibilityLabel={area ? `Land this season: ${area.value} ${area.unit}` : 'No land this season yet'}>
            <Medal label={area ? area.value : '0'} tone="violet" size={72} earned={Boolean(land.data?.published_area_m2)} />
            <Txt variant="label" align="center">{area ? `${area.unit} of land` : 'Land'}</Txt>
            <Txt variant="caption" align="center">{season ? `Season ${season.number}` : 'No active season'}</Txt>
          </Card>
          <Card style={{ flex: 1, alignItems: 'center' }} onPress={() => router.push('/seasons')} accessibilityLabel={`${titles.data?.length ?? 0} route titles held`}>
            <Medal label={String(titles.data?.length ?? 0)} tone="orange" size={72} earned={Boolean(titles.data?.length)} />
            <Txt variant="label" align="center">Route titles</Txt>
            <Txt variant="caption" align="center">Held right now</Txt>
          </Card>
        </View>
      </Section>
      <Card tone="violet" accessibilityLabel="Your land">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="hexagon" color="#FFFFFF" size={22} />
          <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1}>{`Land${competition ? ` · ${competition.name}` : ''}`}</Txt>
        </View>
        {land.data && area ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
              <Txt variant="hero" style={{ fontSize: 60, lineHeight: 62 }}>{area.value}</Txt>
              <Txt variant="headline" color="textMuted" style={{ marginBottom: 8 }}>{area.unit}</Txt>
            </View>
            <Txt color="textMuted">{`${land.data.published_cells} published cells${land.data.provisional_cells ? ` · ${land.data.provisional_cells} provisional` : ''}`}</Txt>
          </>
        ) : <Txt>{season ? 'No land this season yet. Close an eligible loop to claim some.' : 'No active season.'}</Txt>}
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
            {activeClubs.map((c) => <Row key={c.id} leading={<ClubMonogram name={c.name} tone={clubTone(c.id)} size={40} />} title={c.name} subtitle={c.role !== 'member' ? (c.role === 'owner' ? 'Owner' : 'Organizer') : `${c.member_count} members`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />)}
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

const styles = StyleSheet.create({
  count: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  editBadge: { position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' }
});
