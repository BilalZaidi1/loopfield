import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtArea, fmtDistance, fmtDuration, splitValue } from '@/lib/format';
import { ArrowLink, Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingState, OfflineBanner, ProgressBar, Row, Section, Segmented, Skeleton, Txt } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { Icon } from '@/components/icons';
import { TopBar } from '@/components/TopBar';
import { PostCard, useFeed, type PostJson } from '@/features/social/PostCard';
import { thisWeekByDay, useActivities } from '@/features/results/useActivities';
import { daysLeft, useLeaderboard, useMyTerritorySummary } from '@/features/territory/useTerritoryStats';
import { getGoals } from '@/health/cache';
import { useCompetition } from '@/state/competition';
import { useNow } from '@/lib/useNow';
import { useSession, useUnits } from '@/state/session';
import { useLayout } from '@/theme/layout';
import { spacing, usePalette } from '@/theme/tokens';

function greeting(name: string | undefined): string {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first && first !== 'New' ? `${part}, ${first}` : part;
}

/**
 * S06 Home — your week, your ground and the people you run with first, then the Following / Discover
 * feed with the composer. Every number comes from your own records or the published competition data.
 */
export default function Home() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { gutter, contentMax, isTablet } = useLayout();
  const { profile, userId } = useSession();
  const [feed, setFeed] = useState<'following' | 'discover'>('following');
  const district = profile?.district_id ?? null;
  const q = useFeed(feed === 'following' ? 'feed_following' : 'feed_discover', feed === 'following' ? {} : { p_district: district }, feed === 'following' || Boolean(district));
  const items: PostJson[] = q.data?.pages.flat() ?? [];
  const acts = useActivities(90);
  const following = useQuery({
    queryKey: ['connections', userId, 'following'],
    enabled: Boolean(userId),
    queryFn: () => rpc<{ user_id: string; handle: string; display_name: string; state: string }[]>('connections', { p_profile: userId, p_kind: 'following', p_limit: 100 })
  });

  const refresh = () => {
    void q.refetch();
    void acts.refetch();
    void following.refetch();
  };

  const header = (
    <View style={{ gap: spacing.xl, paddingTop: insets.top + spacing.xs }}>
      <TopBar title="Home" subtitle={greeting(profile?.display_name)} />
      <OfflineBanner />
      <View style={isTablet ? { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch' } : { gap: spacing.lg }}>
        <View style={{ flex: isTablet ? 1 : undefined, gap: spacing.lg }}>
          <WeekCard acts={acts} />
          <Button label="Start a run" variant="ink" size="lg" arrow icon="record" onPress={() => router.push('/record')} />
        </View>
        <View style={{ flex: isTablet ? 1 : undefined, gap: spacing.lg }}>
          <GroundCard />
        </View>
      </View>
      <TopRunners />
      {following.data?.length ? <FollowingRow people={following.data} /> : null}
      <Section title="Feed" icon="chat" action={<Button label="Write" icon="edit" size="sm" variant="secondary" onPress={() => router.push('/compose')} />}>
        <Segmented
          label="Feed"
          value={feed}
          onChange={(v) => {
            setFeed(v);
            track('feed_viewed', { feed: v, page: 1 });
          }}
          options={[{ value: 'following', label: 'Following' }, { value: 'discover', label: 'Discover' }]}
        />
      </Section>
    </View>
  );

  let empty: ReactNode = null;
  if (feed === 'discover' && !district) {
    empty = <EmptyState icon="pin" title="Choose your city" body="Discover shows public posts from runners in your city or district." action={{ label: 'Set city', onPress: () => router.push('/settings/profile') }} />;
  } else if (q.isLoading) empty = <LoadingState label="Loading posts…" />;
  else if (q.error) empty = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else
    empty =
      feed === 'following' ? (
        <EmptyState icon="clubs" title="Nothing from people you follow yet" body="Follow runners or join a club to see their posts here." action={{ label: 'Discover runners', onPress: () => router.push('/discover') }} />
      ) : (
        <EmptyState icon="globe" title="No public posts in your area yet" body="Posts appear here when runners nearby share publicly." />
      );

  return (
    <FlatList
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: spacing.huge, gap: spacing.lg, width: '100%', maxWidth: contentMax, alignSelf: 'center' }}
      data={feed === 'discover' && !district ? [] : items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<View style={{ marginTop: spacing.sm }}>{empty}</View>}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) {
          void q.fetchNextPage();
          track('feed_viewed', { feed, page: (q.data?.pages.length ?? 1) + 1 });
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} tintColor={p.primary} colors={[p.primaryFill]} />}
      ListFooterComponent={q.isFetchingNextPage ? <LoadingState variant="spinner" label="Loading more…" /> : undefined}
    />
  );
}

/** This week's distance, runs and goal, with daily bars against the same days last week. */
function WeekCard({ acts }: { acts: ReturnType<typeof useActivities> }) {
  const units = useUnits();
  const goals = getGoals();
  const now = useNow(60_000);
  const week = useMemo(() => thisWeekByDay(acts.data ?? [], now), [acts.data, now]);
  const totals = useMemo(() => {
    let runs = 0, moving = 0;
    const start = week[0]!.date.getTime();
    for (const r of acts.data ?? []) {
      const t = Date.parse(r.started_at);
      if (t >= start && t <= now) {
        runs++;
        moving += r.moving_ms ?? r.elapsed_ms ?? 0;
      }
    }
    return { runs, moving, distance: week.reduce((s, d) => s + d.distanceM, 0), last: week.reduce((s, d) => s + d.lastWeekM, 0) };
  }, [acts.data, week, now]);
  const factor = units === 'metric' ? 1000 : 1609.344;
  const unit = units === 'metric' ? 'km' : 'mi';
  const dist = splitValue(fmtDistance(totals.distance, units, 1));
  const delta = (totals.distance - totals.last) / factor;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  return (
    <Card tone="violet" onPress={() => router.push('/progress')} accessibilityLabel="This week. Open progress">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="record" color="#FFFFFF" size={22} />
        <Txt variant="heading" style={{ flex: 1 }}>This week</Txt>
        <Icon name="arrow-right" color="#FFFFFF" size={22} />
      </View>
      {acts.isLoading ? (
        <View style={{ gap: spacing.md }} accessibilityRole="progressbar" accessibilityLabel="Loading your week">
          <Skeleton width="55%" height={64} round={12} style={{ opacity: 0.35 }} />
          <Skeleton height={90} round={12} style={{ opacity: 0.25 }} />
        </View>
      ) : acts.error ? (
        <View style={{ gap: spacing.sm }}>
          <Txt>Your runs could not be loaded.</Txt>
          <Button label="Try again" variant="secondary" size="sm" onPress={() => void acts.refetch()} />
        </View>
      ) : (
        <>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
              <Txt variant="hero" numberOfLines={1}>{dist.value}</Txt>
              <Txt variant="headline" color="textMuted" style={{ marginBottom: 10 }}>{dist.unit}</Txt>
            </View>
            <Txt color="textMuted">
              {totals.runs === 0 ? 'No runs yet this week' : `${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'} · ${fmtDuration(totals.moving)}`}
              {totals.last > 0 || totals.distance > 0 ? `   ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} ${unit} vs last week` : ''}
            </Txt>
          </View>
          {goals.weeklyRuns ? (
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="label">Weekly goal</Txt>
                <Txt variant="label" tabular>{`${Math.min(totals.runs, goals.weeklyRuns)} / ${goals.weeklyRuns} runs`}</Txt>
              </View>
              <ProgressBar value={totals.runs / goals.weeklyRuns} label={`Weekly goal: ${totals.runs} of ${goals.weeklyRuns} runs`} />
            </View>
          ) : null}
          <BarChart
            title={`Distance per day this week (${unit}), next to last week`}
            unit={unit}
            height={84}
            data={week.map((d) => ({ label: weekday.format(d.date), value: d.distanceM / factor }))}
            compare={week.map((d) => d.lastWeekM / factor)}
            format={(v) => v.toFixed(1)}
          />
        </>
      )}
    </Card>
  );
}

/** Your published land, rank and season clock in the selected competition. */
function GroundCard() {
  const units = useUnits();
  const { settings } = useSession();
  const { competition, season, loading } = useCompetition();
  const summary = useMyTerritorySummary();
  const board = useLeaderboard(null, 100);
  const me = board.data?.find((r) => r.is_me);
  const left = daysLeft(season?.ends_at);
  const participating = Boolean(settings?.territory_competition_enabled);
  if (!competition) {
    if (loading) return <Skeleton height={190} round={28} />;
    return (
      <Card>
        <Txt variant="heading">No competition near you yet</Txt>
        <Txt color="textMuted">You can still record private runs and track your progress. The map shows competitions as they open.</Txt>
      </Card>
    );
  }
  const s = summary.data;
  return (
    <Card tone="orange" onPress={() => router.push('/map')} accessibilityLabel={`${competition.name}. Open the map`} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="hexagon" color="#121318" size={22} />
        <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1}>{competition.name}</Txt>
        {season ? <Badge label={left === 0 ? `Season ${season.number} · last day` : `Season ${season.number} · ${left} days left`} /> : null}
      </View>
      {!season ? (
        <Txt>No active season right now. Land opens again when the next season starts.</Txt>
      ) : !participating ? (
        <>
          <Txt variant="headline">Your runs are private</Txt>
          <Txt color="textMuted">Turn on territory to let eligible loops claim land on the shared map.</Txt>
          <Button label="Take part" arrow onPress={() => router.push('/settings/privacy')} />
        </>
      ) : summary.isLoading ? (
        <Skeleton width="60%" height={48} round={12} style={{ opacity: 0.3 }} />
      ) : (
        <>
          <View>
            <Txt variant="label" color="textMuted">Your ground</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs }}>
              <Txt variant="hero" style={{ fontSize: 56, lineHeight: 60 }} numberOfLines={1}>{splitValue(fmtArea(s?.published_area_m2 ?? 0, units)).value}</Txt>
              <Txt variant="headline" color="textMuted" style={{ marginBottom: 8 }}>{splitValue(fmtArea(s?.published_area_m2 ?? 0, units)).unit}</Txt>
            </View>
            <Txt color="textMuted">
              {`${s?.published_cells ?? 0} cells`}
              {me ? ` · #${me.rank} in the competition` : ' · not ranked yet'}
            </Txt>
          </View>
          {s?.provisional_cells ? <Badge icon="clock" label={`${s.provisional_cells} more cells publishing soon`} /> : null}
          <Button label="Open the map" arrow onPress={() => router.push('/map')} />
        </>
      )}
    </Card>
  );
}

/** Top of the season's land ranking, plus your own row when you are further down. */
function TopRunners() {
  const units = useUnits();
  const { season } = useCompetition();
  const board = useLeaderboard(null, 100);
  if (!season || !board.data?.length) return null;
  const top = board.data.slice(0, 3);
  const me = board.data.find((r) => r.is_me);
  const rows = me && me.rank > 3 ? [...top, me] : top;
  return (
    <Section title="Season leaders" icon="medal" onSeeAll={() => router.push('/leaderboard')} seeAllLabel="Open the full leaderboard">
      <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
        {rows.map((r) => (
          <Row
            key={r.user_id}
            rank={r.rank}
            title={r.is_me ? 'You' : r.display_name}
            value={fmtArea(r.area_m2, units)}
            highlight={r.is_me}
            leading={<Avatar name={r.display_name} size={34} />}
            onPress={r.is_me ? undefined : () => router.push({ pathname: '/profile/[id]', params: { id: r.user_id } })}
          />
        ))}
      </Card>
    </Section>
  );
}

function FollowingRow({ people }: { people: { user_id: string; handle: string; display_name: string }[] }) {
  const p = usePalette();
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt variant="headline" style={{ flex: 1 }}>Following</Txt>
        <ArrowLink label="Find runners" onPress={() => router.push('/discover')} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg, paddingRight: spacing.lg }}>
        {people.slice(0, 20).map((u) => (
          <Pressable key={u.user_id} onPress={() => router.push({ pathname: '/profile/[id]', params: { id: u.user_id } })} accessibilityRole="button" accessibilityLabel={`Open ${u.display_name}'s profile`} style={({ pressed }) => ({ alignItems: 'center', gap: spacing.xs, width: 68, opacity: pressed ? 0.7 : 1 })}>
            <Avatar name={u.display_name} size={54} ring={p.primary} />
            <Txt variant="caption" color="text" numberOfLines={1} align="center">{u.display_name.split(/\s+/)[0]}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
