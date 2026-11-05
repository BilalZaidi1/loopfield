import { Alert, FlatList, View } from 'react-native';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Avatar, Badge, Button, EmptyState, ErrorState, LoadingState, Screen, StatTile, Txt } from '@/components/ui';
import { startConversation } from '@/chat/client';
import { useSignedUrl } from '@/features/social/media';
import { PostCard, useFeed } from '@/features/social/PostCard';
import { useProfileCard, useRelationshipActions } from '@/features/social/profile';
import { spacing, usePalette } from '@/theme/tokens';

/** S34 Other runner profile — consented bio, achievements and posts, follow state, message, report/block. */
export default function OtherProfile() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useProfileCard(id);
  const c = card.data;
  const avatar = useSignedUrl('avatars', c?.avatar_path);
  const posts = useFeed('profile_posts', { p_profile: id }, Boolean(c?.can_view_content));
  const eligibility = useQuery({ queryKey: ['messaging_eligibility', id], enabled: Boolean(c && !c.is_me), queryFn: () => rpc<{ allowed: boolean; reason: string }>('messaging_eligibility', { p_target: id }) });
  const actions = useRelationshipActions(id!);

  if (card.isLoading) return <LoadingState />;
  if (card.error) return <ErrorState error={card.error} onRetry={() => void card.refetch()} />;
  if (!c) return <Screen><Stack.Screen options={{ title: 'Profile' }} /><EmptyState title="This profile is not available" body="It may be private to you, blocked or removed." /></Screen>;
  if (c.is_me) return <Redirect href="/me" />;

  const message = async () => {
    try {
      const r = await startConversation(c.id);
      router.push({ pathname: '/inbox/[channel]', params: { channel: r.channelId, name: c.display_name } });
    } catch (e) {
      Alert.alert('Cannot message', friendlyError(e));
    }
  };
  const more = () =>
    Alert.alert(c.display_name, undefined, [
      { text: c.muted ? 'Unmute' : 'Mute', onPress: () => actions.mute.mutate(!c.muted) },
      c.blocked
        ? { text: 'Unblock', onPress: () => actions.unblock.mutate() }
        : { text: 'Block', style: 'destructive', onPress: () => Alert.alert('Block this runner?', 'You will not see each other’s posts or profiles, and messaging stops.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: () => actions.block.mutate() }]) },
      { text: 'Report profile', onPress: () => router.push({ pathname: '/report', params: { type: 'profile', id: c.id } }) },
      { text: 'Cancel', style: 'cancel' }
    ]);

  const header = (
    <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
      <Stack.Screen options={{ title: `@${c.handle}` }} />
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Avatar name={c.display_name} uri={avatar.data} size={64} />
        <View style={{ flex: 1 }}>
          <Txt variant="title">{c.display_name}</Txt>
          <Txt variant="caption">@{c.handle}{c.city_label ? ` · ${c.city_label}` : ''}</Txt>
          {c.follows_me ? <Badge label="Follows you" tone="muted" /> : null}
        </View>
      </View>
      {c.bio ? <Txt>{c.bio}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Followers" value={String(c.followers)} />
        <StatTile label="Following" value={String(c.following)} />
        {c.titles != null ? <StatTile label="Route titles" value={String(c.titles)} /> : null}
      </View>
      {c.blocked ? <Txt color="textMuted">You blocked this runner.</Txt> : (
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {c.follow_state === 'none' ? <Button label={c.visibility === 'private' ? 'Request to follow' : 'Follow'} onPress={() => actions.follow.mutate()} loading={actions.follow.isPending} /> : <Button variant="secondary" label={c.follow_state === 'pending' ? 'Cancel request' : 'Unfollow'} onPress={() => actions.unfollow.mutate()} />}
          {eligibility.data?.allowed ? <Button variant="secondary" label="Message" onPress={() => void message()} /> : null}
          <Button variant="ghost" label="More" onPress={more} />
        </View>
      )}
      {!eligibility.data?.allowed && eligibility.data ? <Txt variant="caption">{eligibility.data.reason === 'not_allowed' ? 'This runner accepts messages only from people they allow.' : 'Messaging is unavailable with this runner.'}</Txt> : null}
      {!c.can_view_content ? <Txt color="textMuted">This profile is private. Follow requests must be approved before posts appear.</Txt> : <Txt variant="heading">Posts</Txt>}
    </View>
  );
  const items = posts.data?.pages.flat() ?? [];
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={c.can_view_content ? items : []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={c.can_view_content ? (posts.isLoading ? <LoadingState /> : <Txt color="textMuted">No posts you can see yet.</Txt>) : undefined}
      onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && void posts.fetchNextPage()}
    />
  );
}
