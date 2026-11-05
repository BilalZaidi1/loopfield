import { FlatList, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@loopfield/core';
import { rpc } from '@/lib/api';
import { fmtArea } from '@/lib/format';
import { Avatar, Badge, Button, Card, LoadingState, Row, Section, StatTile, Txt } from '@/components/ui';
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
  if (!profile) return <LoadingState />;

  const header = (
    <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
      <Stack.Screen options={{ title: 'My profile', headerRight: () => <Button variant="ghost" label="Settings" onPress={() => router.push('/settings')} /> }} />
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Avatar name={profile.display_name} uri={avatar.data} size={64} />
        <View style={{ flex: 1 }}>
          <Txt variant="title">{profile.display_name}</Txt>
          <Txt variant="caption">@{profile.handle}{profile.city_label ? ` · ${profile.city_label}` : ''} · {profile.visibility === 'private' ? 'Private profile' : 'Public profile'}</Txt>
        </View>
      </View>
      {profile.bio ? <Txt>{profile.bio}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Followers" value={String(card.data?.followers ?? '—')} />
        <StatTile label="Following" value={String(card.data?.following ?? '—')} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Button variant="secondary" label="Connections" onPress={() => router.push('/connections')} />
        <Button variant="secondary" label="Edit profile" onPress={() => router.push('/settings/profile')} />
        <Button variant="secondary" label="Season history" onPress={() => router.push('/seasons')} />
        {roles.length ? <Button variant="secondary" label="Operator tools" onPress={() => router.push('/ops')} /> : null}
      </View>
      <Card accessibilityLabel="Your land">
        <Txt variant="heading">Land{competition ? ` · ${competition.name}` : ''}</Txt>
        {land.data ? (
          <>
            <Txt variant="title">{fmtArea(land.data.published_area_m2, units)}</Txt>
            <Txt variant="caption">{land.data.published_cells} published cells{land.data.provisional_cells ? ` · ${land.data.provisional_cells} provisional` : ''}</Txt>
          </>
        ) : <Txt color="textMuted">{season ? 'No land this season yet.' : 'No active season.'}</Txt>}
      </Card>
      <Section title="Route titles">
        {titles.data?.length ? titles.data.map((t) => <Row key={`${t.course_id}-${t.competition_id}`} title={t.course_name} right={<Badge tone="title" label={formatDuration(t.benchmark_ms)} />} onPress={() => router.push({ pathname: '/routes/[id]', params: { id: t.course_id } })} />) : <Txt color="textMuted">You hold no route titles right now.</Txt>}
      </Section>
      <Section title="Clubs and communities">
        {clubs.data?.filter((c) => c.state === 'active').length ? clubs.data.filter((c) => c.state === 'active').map((c) => <Row key={c.id} title={c.name} subtitle={c.role !== 'member' ? c.role : undefined} onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.id } })} />) : <Txt color="textMuted">None yet.</Txt>}
      </Section>
      <Txt variant="heading">Your posts</Txt>
    </View>
  );
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={posts.data?.pages.flat() ?? []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={posts.isLoading ? <LoadingState /> : <Txt color="textMuted">You have not posted yet.</Txt>}
      onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && void posts.fetchNextPage()}
    />
  );
}
