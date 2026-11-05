import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError, rpc } from '@/lib/api';
import { Avatar, Badge, Banner, Button, Card, EmptyState, ErrorState, IconButton, LoadingState, Screen, Txt } from '@/components/ui';
import { useLayout } from '@/theme/layout';
import { startConversation } from '@/chat/client';
import { useSignedUrl } from '@/features/social/media';
import { PostCard, useFeed } from '@/features/social/PostCard';
import { useProfileCard, useRelationshipActions } from '@/features/social/profile';
import { spacing, usePalette } from '@/theme/tokens';

/** S34 Other runner profile — consented bio, achievements and posts, follow state, message, report/block. */
export default function OtherProfile() {
  const p = usePalette();
  const { gutter, contentMax } = useLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useProfileCard(id);
  const c = card.data;
  const avatar = useSignedUrl('avatars', c?.avatar_path);
  const posts = useFeed('profile_posts', { p_profile: id }, Boolean(c?.can_view_content));
  const eligibility = useQuery({ queryKey: ['messaging_eligibility', id], enabled: Boolean(c && !c.is_me), queryFn: () => rpc<{ allowed: boolean; reason: string }>('messaging_eligibility', { p_target: id }) });
  const actions = useRelationshipActions(id!);

  if (card.isLoading) return <Screen><Stack.Screen options={{ title: 'Profile' }} /><LoadingState variant="cards" /></Screen>;
  if (card.error) return <Screen><Stack.Screen options={{ title: 'Profile' }} /><ErrorState error={card.error} onRetry={() => void card.refetch()} /></Screen>;
  if (!c) return <Screen><Stack.Screen options={{ title: 'Profile' }} /><EmptyState icon="user" title="This profile is not available" body="It may be private to you, blocked or removed." /></Screen>;
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
    <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
      <Stack.Screen options={{ title: `@${c.handle}`, headerRight: () => <IconButton icon="more" label="More options" onPress={more} /> }} />
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Avatar name={c.display_name} uri={avatar.data} size={96} ring />
        <Txt variant="title" align="center">{c.display_name}</Txt>
        <Txt variant="caption" align="center">{`@${c.handle}${c.city_label ? ` · ${c.city_label}` : ''}`}</Txt>
        {c.follows_me ? <Badge label="Follows you" tone="violet" icon="check" /> : null}
        {c.bio ? <Txt align="center" style={{ maxWidth: 520 }}>{c.bio}</Txt> : null}
      </View>
      <Card padded={false} style={{ flexDirection: 'row', paddingVertical: spacing.lg }}>
        <Pressable style={styles.count} onPress={() => router.push({ pathname: '/connections', params: { profile: c.id, tab: 'followers' } })} accessibilityRole="button" accessibilityLabel={`${c.followers} followers`}>
          <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(c.followers)}</Txt>
          <Txt variant="caption">Followers</Txt>
        </Pressable>
        <View style={{ width: 1, backgroundColor: p.border }} />
        <Pressable style={styles.count} onPress={() => router.push({ pathname: '/connections', params: { profile: c.id, tab: 'following' } })} accessibilityRole="button" accessibilityLabel={`${c.following} following`}>
          <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(c.following)}</Txt>
          <Txt variant="caption">Following</Txt>
        </Pressable>
        {c.titles != null ? (
          <>
            <View style={{ width: 1, backgroundColor: p.border }} />
            <View style={styles.count} accessible accessibilityLabel={`${c.titles} route titles`}>
              <Txt variant="metric" style={{ fontSize: 26, lineHeight: 30 }}>{String(c.titles)}</Txt>
              <Txt variant="caption">Route titles</Txt>
            </View>
          </>
        ) : null}
      </Card>
      {c.blocked ? <Banner tone="warning" text="You blocked this runner." action={{ label: 'Unblock', onPress: () => actions.unblock.mutate() }} /> : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {c.follow_state === 'none' ? (
            <Button label={c.visibility === 'private' ? 'Request to follow' : 'Follow'} icon="plus" onPress={() => actions.follow.mutate()} loading={actions.follow.isPending} style={{ flex: 1 }} />
          ) : (
            <Button variant="secondary" label={c.follow_state === 'pending' ? 'Cancel request' : 'Following'} icon={c.follow_state === 'pending' ? 'clock' : 'check'} onPress={() => actions.unfollow.mutate()} style={{ flex: 1 }} accessibilityLabel={c.follow_state === 'pending' ? 'Cancel follow request' : 'Unfollow'} />
          )}
          {eligibility.data?.allowed ? <Button variant="secondary" icon="chat" label="Message" onPress={() => void message()} style={{ flex: 1 }} /> : null}
        </View>
      )}
      {!eligibility.data?.allowed && eligibility.data ? <Txt variant="caption" align="center">{eligibility.data.reason === 'not_allowed' ? 'This runner accepts messages only from people they allow.' : 'Messaging is unavailable with this runner.'}</Txt> : null}
      {!c.can_view_content ? <Banner text="This profile is private. Follow requests must be approved before posts appear." /> : <Txt variant="headline">Posts</Txt>}
    </View>
  );
  const items = posts.data?.pages.flat() ?? [];
  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.huge, gap: spacing.lg, width: '100%', maxWidth: contentMax, alignSelf: 'center' }}
      data={c.can_view_content ? items : []}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={c.can_view_content ? (posts.isLoading ? <LoadingState /> : <EmptyState icon="chat" title="No posts you can see yet" />) : undefined}
      onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && void posts.fetchNextPage()}
    />
  );
}

const styles = StyleSheet.create({
  count: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' }
});
