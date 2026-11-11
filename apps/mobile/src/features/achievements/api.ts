import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { BadgeTier, ChallengeCategory } from '@loopfield/core';

export type { BadgeTier, ChallengeCategory };

export interface Challenge {
  id: string;
  category: ChallengeCategory;
  tier: BadgeTier;
  title: string;
  description: string;
  unit: string;
  target: number;
  progress: number;
  completed_at: string | null;
  sort: number;
}

export function useMyChallenges() {
  return useQuery({
    queryKey: ['my_challenges'],
    queryFn: async () => (await rpc<Challenge[]>('my_challenges')).map((c) => ({ ...c, target: Number(c.target), progress: Number(c.progress) }))
  });
}

export interface EarnedBadge {
  id: string;
  tier: BadgeTier;
  category: ChallengeCategory;
  title: string;
  completed_on: string;
}

export interface AchievementProfile {
  visible: boolean;
  score: number | null;
  badges: number | null;
  categories: number | null;
  global_rank: number | null;
  ranked_runners: number | null;
  earned: EarnedBadge[] | null;
}

/** Score, global rank and badges of a runner (mine when `userId` is omitted); null fields when hidden. */
export function useAchievementProfile(userId?: string | null) {
  return useQuery({
    queryKey: ['achievement_profile', userId ?? 'me'],
    queryFn: async () => (await rpc<AchievementProfile[]>('achievement_profile', { p_user: userId ?? null }))[0] ?? null
  });
}

export type RankingScope = 'everyone' | 'country' | 'region' | 'friends' | 'club';

export interface RankingRow {
  rank: number;
  user_id: string | null;
  handle: string | null;
  display_name: string;
  avatar_path: string | null;
  score: number;
  badges: number;
  categories: number;
  top_tier: BadgeTier | null;
  is_me: boolean;
  hidden: boolean;
  total: number;
}

export function useAchievementLeaderboard(scope: RankingScope, clubId: string | null) {
  return useQuery({
    queryKey: ['achievement_leaderboard', scope, scope === 'club' ? clubId : null],
    enabled: scope !== 'club' || Boolean(clubId),
    queryFn: () => rpc<RankingRow[]>('achievement_leaderboard', { p_scope: scope, p_club: scope === 'club' ? clubId : null, p_limit: 100 })
  });
}

export interface RankingRules {
  tierPoints: Record<BadgeTier, number>;
  categoryBonus: number;
}

/** The published ranking formula (public config), so the explanation always matches the server. */
export function useRankingRules() {
  return useQuery({
    queryKey: ['ranking_rules'],
    staleTime: 3_600_000,
    queryFn: async (): Promise<RankingRules> => {
      const { data, error } = await supabase().from('app_config').select('key, value').in('key', ['achievement_tier_points', 'achievement_category_bonus']);
      if (error) throw error;
      const map = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
      return {
        tierPoints: (map.get('achievement_tier_points') as Record<BadgeTier, number>) ?? { bronze: 10, silver: 25, gold: 60, platinum: 150 },
        categoryBonus: Number(map.get('achievement_category_bonus') ?? 25)
      };
    }
  });
}

/** Re-evaluate my achievements now (pull to refresh); the server also does this every minute. */
export function useRefreshAchievements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<number>('refresh_my_achievements'),
    onSettled: () => {
      for (const k of ['my_challenges', 'achievement_profile', 'achievement_leaderboard']) void qc.invalidateQueries({ queryKey: [k] });
    }
  });
}

export const CATEGORY_LABEL: Record<ChallengeCategory, string> = {
  distance: 'Distance',
  consistency: 'Consistency',
  territory: 'Territory',
  exploration: 'Exploration',
  community: 'Community',
  competitive: 'Competitive'
};

export const TIER_LABEL: Record<BadgeTier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

/** Progress text in the challenge's own unit ("37.2 of 50 km"). */
export function progressText(c: Pick<Challenge, 'progress' | 'target' | 'unit'>): string {
  const fmt = (n: number) => (c.unit === 'km' ? (n >= 100 ? Math.floor(n).toLocaleString() : n.toFixed(1)) : Math.floor(n).toLocaleString());
  return `${fmt(Math.min(c.progress, c.target))} of ${fmt(c.target)} ${c.unit}`;
}
