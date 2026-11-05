import { useState, type ReactNode } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '@/lib/analytics';
import { Button, EmptyState, ErrorState, LoadingState, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { TopBar } from '@/components/TopBar';
import { PostCard, useFeed, type PostJson } from '@/features/social/PostCard';
import { useSession } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S06 Home feed — Following and Discover, authorized post cards, composer, inbox and notifications. */
export default function Home() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const [feed, setFeed] = useState<'following' | 'discover'>('following');
  const district = profile?.district_id ?? null;
  const q = useFeed(feed === 'following' ? 'feed_following' : 'feed_discover', feed === 'following' ? {} : { p_district: district }, feed === 'following' || Boolean(district));
  const items: PostJson[] = q.data?.pages.flat() ?? [];

  const header = (
    <View style={{ gap: spacing.sm, paddingTop: insets.top + spacing.sm }}>
      <TopBar title="Home" />
      <OfflineBanner />
      <Segmented
        label="Feed"
        value={feed}
        onChange={(v) => {
          setFeed(v);
          track('feed_viewed', { feed: v, page: 1 });
        }}
        options={[{ value: 'following', label: 'Following' }, { value: 'discover', label: 'Discover' }]}
      />
      <Button label="Write a post" variant="secondary" onPress={() => router.push('/compose')} />
    </View>
  );

  let empty: ReactNode = null;
  if (feed === 'discover' && !district) {
    empty = <EmptyState title="Choose your city" body="Discover shows public posts from runners in your city or district." action={{ label: 'Set city', onPress: () => router.push('/settings/profile') }} />;
  } else if (q.isLoading) empty = <LoadingState label="Loading posts…" />;
  else if (q.error) empty = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else
    empty =
      feed === 'following' ? (
        <EmptyState title="Nothing from people you follow yet" body="Follow runners or join a club to see their posts here." action={{ label: 'Discover runners', onPress: () => router.push('/discover') }} />
      ) : (
        <EmptyState title="No public posts in your area yet" body="Posts appear here when runners nearby share publicly." />
      );

  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={feed === 'discover' && !district ? [] : items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<View style={{ marginTop: spacing.xl }}>{empty}</View>}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) {
          void q.fetchNextPage();
          track('feed_viewed', { feed, page: (q.data?.pages.length ?? 1) + 1 });
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      ListFooterComponent={q.isFetchingNextPage ? <Txt variant="caption">Loading more…</Txt> : undefined}
    />
  );
}
