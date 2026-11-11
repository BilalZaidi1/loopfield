import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { fmtDate } from '@/lib/format';
import { ArrowLink, BigNumber, Button, Card, ChipGroup, EmptyState, ErrorState, LoadingState, PressableScale, ProgressBar, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { BadgeMedal, CATEGORY_ICON, ChallengeCard, RankingExplainer } from '@/features/achievements/Badges';
import type { IconName } from '@/components/icons';
import { CATEGORY_LABEL, progressText, TIER_LABEL, useAchievementProfile, useMyChallenges, useRankingRules, useRefreshAchievements, type Challenge, type ChallengeCategory } from '@/features/achievements/api';
import { useLayout } from '@/theme/layout';
import { radius, spacing, usePalette } from '@/theme/tokens';

type Filter = 'all' | ChallengeCategory;
const FILTERS: { value: Filter; label: string; icon?: IconName }[] = [
  { value: 'all', label: 'All' },
  ...(['distance', 'consistency', 'territory', 'exploration', 'community', 'competitive'] as const).map((c) => ({ value: c as Filter, label: CATEGORY_LABEL[c], icon: CATEGORY_ICON[c] }))
];

/** Challenges and badges: what to aim for next, progress on every challenge, and the badge collection. */
export default function Achievements() {
  const p = usePalette();
  const { isTablet } = useLayout();
  const challenges = useMyChallenges();
  const profile = useAchievementProfile();
  const rules = useRankingRules();
  const refresh = useRefreshAchievements();
  const [tab, setTab] = useState<'progress' | 'badges'>('progress');
  const [filter, setFilter] = useState<Filter>('all');
  const [explain, setExplain] = useState(false);
  const [open, setOpen] = useState<Challenge | null>(null);

  const all = useMemo(() => challenges.data ?? [], [challenges.data]);
  const shown = useMemo(() => all.filter((c) => filter === 'all' || c.category === filter), [all, filter]);
  const ongoing = useMemo(
    () => shown.filter((c) => !c.completed_at).sort((a, b) => b.progress / b.target - a.progress / a.target || a.sort - b.sort),
    [shown]
  );
  const done = shown.filter((c) => c.completed_at);
  const earned = all.filter((c) => c.completed_at).length;
  const pr = profile.data;

  return (
    <Screen onRefresh={() => refresh.mutate()} refreshing={refresh.isPending}>
      <Stack.Screen options={{ title: 'Challenges and badges' }} />
      <Card tone="violet" accessibilityLabel={pr?.global_rank ? `Global rank ${pr.global_rank} of ${pr.ranked_runners}. Score ${pr.score}.` : 'Not ranked yet'}>
        <Txt variant="heading">Global ranking</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md }}>
          <BigNumber value={String(pr?.score ?? 0)} unit="score" />
          <View style={{ alignItems: 'flex-end', paddingBottom: spacing.sm }}>
            <Txt variant="title" tabular>{pr?.global_rank ? `#${pr.global_rank}` : '–'}</Txt>
            <Txt variant="caption">{pr?.global_rank ? `of ${pr.ranked_runners?.toLocaleString()} runners` : 'Earn a badge to be ranked'}</Txt>
          </View>
        </View>
        <View style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="label">{`${earned} of ${all.length || 24} badges`}</Txt>
            <Txt variant="label">{`${pr?.categories ?? 0} of 6 categories`}</Txt>
          </View>
          <ProgressBar value={all.length ? earned / all.length : 0} label={`${earned} of ${all.length} badges earned`} />
        </View>
        <Button label="See the rankings" arrow onPress={() => router.push('/achievements/ranking')} />
        <ArrowLink label="How ranking works" onPress={() => setExplain(true)} />
      </Card>

      <Segmented label="Show" value={tab} onChange={setTab} options={[{ value: 'progress', label: 'Challenges' }, { value: 'badges', label: 'Badges' }]} />
      <ChipGroup label="Category" showLabel={false} scroll value={filter} onChange={setFilter} options={FILTERS} />

      {challenges.isLoading ? <LoadingState variant="cards" /> : challenges.error ? <ErrorState error={challenges.error} onRetry={() => void challenges.refetch()} /> : tab === 'progress' ? (
        <View style={{ gap: spacing.md }}>
          {ongoing.length ? ongoing.map((c) => <PressableScale key={c.id} onPress={() => setOpen(c)} accessibilityRole="button" accessibilityLabel={`${c.title}. ${progressText(c)}. Open`}><ChallengeCard c={c} /></PressableScale>) : (
            <EmptyState icon="trophy" title="Every challenge here is complete" body="New challenges will appear as the pilot grows." />
          )}
          {done.length ? <Txt variant="headline" style={{ marginTop: spacing.sm }}>{`Completed (${done.length})`}</Txt> : null}
          {done.map((c) => <PressableScale key={c.id} onPress={() => setOpen(c)} accessibilityRole="button" accessibilityLabel={`${c.title}, completed. Open`}><ChallengeCard c={c} /></PressableScale>)}
        </View>
      ) : (
        <View style={[styles.grid, { gap: spacing.md }]}>
          {shown.map((c) => (
            <PressableScale key={c.id} onPress={() => setOpen(c)} accessibilityRole="button"
              accessibilityLabel={`${TIER_LABEL[c.tier]} ${c.title}: ${c.completed_at ? `earned ${fmtDate(c.completed_at)}` : `locked, ${progressText(c)}`}`}
              style={[styles.cell, { width: isTablet ? '23%' : '30%', backgroundColor: c.completed_at ? p.surface : p.surfaceAlt }]}>
              <BadgeMedal tier={c.tier} category={c.category} size={64} earned={Boolean(c.completed_at)} />
              <Txt variant="label" align="center" numberOfLines={2}>{c.title}</Txt>
              <Txt variant="micro" color="textMuted" align="center">{c.completed_at ? TIER_LABEL[c.tier] : `${Math.floor((c.progress / c.target) * 100)}%`}</Txt>
            </PressableScale>
          ))}
        </View>
      )}

      <Sheet visible={Boolean(open)} title={open?.title} onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: spacing.lg, alignItems: 'center' }}>
            <BadgeMedal tier={open.tier} category={open.category} size={112} earned={Boolean(open.completed_at)} />
            <Txt variant="label" color="textMuted">{`${TIER_LABEL[open.tier]} · ${CATEGORY_LABEL[open.category]}${rules.data ? ` · adds ${rules.data.tierPoints[open.tier]} to your score` : ''}`}</Txt>
            <Txt align="center">{open.description}</Txt>
            {open.completed_at ? (
              <Txt variant="bodyStrong" style={{ color: p.greenText }}>{`Earned ${fmtDate(open.completed_at)}`}</Txt>
            ) : (
              <View style={{ alignSelf: 'stretch', gap: spacing.xs }}>
                <ProgressBar value={open.progress / open.target} label={`${open.title} progress`} />
                <Txt variant="caption" align="center" tabular>{progressText(open)}</Txt>
              </View>
            )}
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={explain} title="How ranking works" onClose={() => setExplain(false)}>
        {rules.data ? <RankingExplainer rules={rules.data} badges={pr?.earned ?? []} /> : <LoadingState />}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.lg, minHeight: 150 }
});
