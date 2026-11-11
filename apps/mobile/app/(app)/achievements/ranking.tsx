import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { ArrowLink, Avatar, Banner, Card, Chip, EmptyState, ErrorState, ListGroup, LoadingState, Row, Screen, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BadgeMedal, byTier, CATEGORY_ICON, RankingExplainer } from '@/features/achievements/Badges';
import { useAchievementLeaderboard, useAchievementProfile, useRankingRules, type RankingRow, type RankingScope } from '@/features/achievements/api';
import { useMyClubs } from '@/features/clubs/api';
import { useSignedUrl } from '@/features/social/media';
import { useLayout } from '@/theme/layout';
import { spacing, usePalette } from '@/theme/tokens';

const SCOPES: { value: Exclude<RankingScope, 'club'>; label: string; icon: 'globe' | 'pin' | 'compass' | 'heart' }[] = [
  { value: 'everyone', label: 'Everyone', icon: 'globe' },
  { value: 'country', label: 'Country', icon: 'compass' },
  { value: 'region', label: 'Region', icon: 'pin' },
  { value: 'friends', label: 'Friends', icon: 'heart' }
];

function RankRow({ r }: { r: RankingRow }) {
  const p = usePalette();
  const avatar = useSignedUrl('avatars', r.avatar_path);
  return (
    <Row
      rank={r.rank}
      highlight={r.is_me}
      leading={
        <View style={{ width: 44, height: 44 }}>
          {r.hidden ? (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="eye-off" color={p.textSubtle} size={18} />
            </View>
          ) : <Avatar name={r.display_name} uri={avatar.data} size={40} />}
          {/* Their highest badge tier, pinned to the avatar. */}
          {r.top_tier ? <View style={{ position: 'absolute', right: -2, bottom: -2 }}><BadgeMedal tier={r.top_tier} size={22} /></View> : null}
        </View>
      }
      title={r.is_me ? `${r.display_name} (you)` : r.display_name}
      subtitle={`${r.badges} ${r.badges === 1 ? 'badge' : 'badges'} · ${r.categories} ${r.categories === 1 ? 'category' : 'categories'}`}
      right={<Txt variant="headline" tabular>{r.score.toLocaleString()}</Txt>}
      accessibilityLabel={`${r.rank}. ${r.is_me ? 'You' : r.display_name}, score ${r.score}, ${r.badges} badges in ${r.categories} of 6 categories${r.top_tier ? `, highest ${r.top_tier}` : ''}`}
      onPress={r.user_id && !r.is_me ? () => router.push({ pathname: '/profile/[id]', params: { id: r.user_id! } }) : undefined}
    />
  );
}

/** Global ranking by challenge badges (never movement points), for everyone or a narrower circle. */
export default function Ranking() {
  const p = usePalette();
  const { gutter } = useLayout();
  const [scope, setScope] = useState<RankingScope>('everyone');
  const [club, setClub] = useState<string | null>(null);
  const [pickClub, setPickClub] = useState(false);
  const [explain, setExplain] = useState(false);
  const clubs = useMyClubs();
  const myClubs = useMemo(() => (clubs.data ?? []).filter((c) => c.state === 'active'), [clubs.data]);
  const board = useAchievementLeaderboard(scope, club);
  const me = useAchievementProfile();
  const rules = useRankingRules();
  const rows = board.data ?? [];
  const mine = rows.find((r) => r.is_me);
  const clubName = myClubs.find((c) => c.id === club)?.name;
  const errText = board.error ? friendlyError(board.error) : null;

  return (
    <Screen onRefresh={() => void board.refetch()} refreshing={board.isRefetching}>
      <Stack.Screen options={{ title: 'Global ranking' }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel="Compare with"
        style={{ marginHorizontal: -gutter, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm }}>
        {SCOPES.map((s) => <Chip key={s.value} label={s.label} icon={s.icon} selected={scope === s.value} onPress={() => setScope(s.value)} />)}
        {myClubs.length ? <Chip label={scope === 'club' && clubName ? clubName : 'Club'} icon="clubs" selected={scope === 'club'} onPress={() => setPickClub(true)} /> : null}
      </ScrollView>

      <Card tone="violet" accessibilityLabel={mine ? `Your rank: ${mine.rank} of ${mine.total}` : 'You are not ranked here yet'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label">{scope === 'everyone' ? 'Your global rank' : scope === 'club' ? `Your rank in ${clubName ?? 'the club'}` : `Your rank among ${SCOPES.find((s) => s.value === scope)?.label.toLowerCase()}`}</Txt>
            <Txt variant="display" tabular>{mine ? `#${mine.rank}` : '–'}</Txt>
            <Txt variant="caption">{mine ? `of ${mine.total.toLocaleString()} ${mine.total === 1 ? 'runner' : 'runners'} · score ${mine.score}` : 'Complete a challenge to appear here'}</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {byTier(me.data?.earned ?? []).slice(0, 3).map((b) => <BadgeMedal key={b.id} tier={b.tier} category={b.category} size={40} />)}
          </View>
        </View>
        <ArrowLink label="How ranking works" onPress={() => setExplain(true)} />
      </Card>

      {board.isLoading ? <LoadingState /> : errText && (board.error as { message?: string })?.message === 'set_city' ? (
        <Banner tone="info" text={errText} action={{ label: 'Edit profile', onPress: () => router.push('/settings/profile') }} />
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length ? (
        <ListGroup>{rows.map((r) => <RankRow key={`${r.rank}-${r.user_id ?? r.display_name}-${r.is_me}`} r={r} />)}</ListGroup>
      ) : (
        <EmptyState
          icon={scope === 'friends' ? 'heart' : 'trophy'}
          title={scope === 'friends' ? 'No friends ranked yet' : 'Nobody is ranked here yet'}
          body={scope === 'friends' ? 'Friends are runners you follow who follow you back. They appear here once they earn a badge.' : 'Rankings fill up as runners complete challenges.'}
        />
      )}
      <Txt variant="caption">Ranked by challenge badges and how many categories they cover. Runners with private profiles appear as “Private runner”; full private mode removes a runner from rankings.</Txt>

      <Sheet visible={pickClub} title="Compare within a club" onClose={() => setPickClub(false)}>
        <ListGroup>
          {myClubs.map((c) => (
            <Row key={c.id} icon={CATEGORY_ICON.community} title={c.name} subtitle={`${c.member_count} members`}
              right={club === c.id && scope === 'club' ? <Icon name="check" color={p.primary} size={22} /> : undefined}
              onPress={() => { setClub(c.id); setScope('club'); setPickClub(false); }} />
          ))}
        </ListGroup>
      </Sheet>
      <Sheet visible={explain} title="How ranking works" onClose={() => setExplain(false)}>
        {rules.data ? <RankingExplainer rules={rules.data} badges={me.data?.earned ?? []} /> : <LoadingState />}
      </Sheet>
    </Screen>
  );
}
