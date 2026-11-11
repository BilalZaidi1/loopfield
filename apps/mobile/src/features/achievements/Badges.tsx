import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { achievementScore } from '@loopfield/core';
import { Card, ProgressBar, PressableScale, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { CATEGORY_LABEL, progressText, TIER_LABEL, type BadgeTier, type Challenge, type ChallengeCategory, type EarnedBadge, type RankingRules } from './api';

/** Tier metals: two-stop fills read as material, with ink or white marks for contrast. */
const METAL: Record<BadgeTier, { from: string; to: string; edge: string; mark: string }> = {
  bronze: { from: '#F2B47A', to: '#A8622E', edge: '#7A4420', mark: '#FFFFFF' },
  silver: { from: '#F4F6FA', to: '#9AA4B6', edge: '#6E7889', mark: '#121318' },
  gold: { from: '#FFE58A', to: '#E09A18', edge: '#9A6408', mark: '#121318' },
  platinum: { from: '#C9F3F4', to: '#6E8BF0', edge: '#3D4FB8', mark: '#FFFFFF' }
};

export const CATEGORY_ICON: Record<ChallengeCategory, IconName> = {
  distance: 'route',
  consistency: 'calendar',
  territory: 'hexagon',
  exploration: 'compass',
  community: 'clubs',
  competitive: 'trophy'
};

const HEX = (s: number, inset = 0) => {
  const c = s / 2;
  const r = c - inset;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
};

/**
 * A badge: a hexagonal medal in its tier's metal with the category mark; grey and locked until earned.
 * Without a category it shows the tier alone (rankings, the scoring key).
 */
export function BadgeMedal({ tier, category, size = 64, earned = true }: { tier: BadgeTier; category?: ChallengeCategory; size?: number; earned?: boolean }) {
  const { palette: p, scheme } = useTheme();
  const m = METAL[tier];
  const id = `b-${tier}-${earned ? 1 : 0}-${scheme}`;
  const greyFrom = scheme === 'dark' ? '#3A3D47' : '#E3E6EE';
  const greyTo = scheme === 'dark' ? '#2A2C33' : '#C9CDD8';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={earned ? m.from : greyFrom} />
            <Stop offset="1" stopColor={earned ? m.to : greyTo} />
          </LinearGradient>
        </Defs>
        <Polygon points={HEX(size, 1.5)} fill={`url(#${id})`} stroke={earned ? m.edge : p.borderStrong} strokeWidth={2} strokeLinejoin="round" />
        <Polygon points={HEX(size, size * 0.17)} fill="none" stroke={earned ? m.mark : p.textSubtle} strokeOpacity={0.35} strokeWidth={1.5} strokeLinejoin="round" />
      </Svg>
      {/* Own layer above the absolutely placed medal: on the web a bare SVG would paint underneath it. */}
      {!earned || category ? (
        <View style={{ zIndex: 1 }}>
          <Icon name={earned && category ? CATEGORY_ICON[category] : 'lock'} color={earned ? m.mark : p.textSubtle} size={Math.round(size * 0.36)} strokeWidth={2.2} />
        </View>
      ) : null}
    </View>
  );
}

/** One challenge: objective, progress toward completion and the badge it awards. */
export function ChallengeCard({ c }: { c: Challenge }) {
  const { palette: p } = useTheme();
  const done = Boolean(c.completed_at);
  const share = Math.max(0, Math.min(1, c.progress / c.target));
  return (
    <View style={[styles.challenge, { backgroundColor: p.surface, borderColor: done ? p.primary : p.border }]}
      accessible accessibilityLabel={`${c.title}, ${TIER_LABEL[c.tier]} ${CATEGORY_LABEL[c.category]} badge. ${c.description} ${done ? 'Completed.' : progressText(c)}`}>
      <BadgeMedal tier={c.tier} category={c.category} size={56} earned={done} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{c.title}</Txt>
          <Txt variant="micro" color="textMuted">{TIER_LABEL[c.tier]}</Txt>
        </View>
        <Txt variant="caption" numberOfLines={2}>{c.description}</Txt>
        {done ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="check" color={p.greenText} size={16} strokeWidth={2.6} />
            <Txt variant="label" style={{ color: p.greenText }}>Badge earned</Txt>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <ProgressBar value={share} label={`${c.title} progress`} />
            <Txt variant="micro" color="textMuted" tabular>{progressText(c)}</Txt>
          </View>
        )}
      </View>
    </View>
  );
}

const TIER_ORDER: BadgeTier[] = ['platinum', 'gold', 'silver', 'bronze'];

/** Highest tiers first, then the most recent. */
export function byTier<T extends { tier: BadgeTier; completed_on?: string }>(badges: readonly T[]): T[] {
  return [...badges].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.completed_on ?? '').localeCompare(a.completed_on ?? ''));
}

/** How many medals of `size` fit in `width`, keeping room for a "+N" count when some are left over. */
export function medalsThatFit(width: number, count: number, size: number, gap: number = spacing.sm, more = 36): number {
  if (width <= 0) return 0;
  const fit = Math.max(1, Math.floor((width + gap) / (size + gap)));
  // n medals plus the count need n × (size + gap) + `more`.
  return count <= fit ? count : Math.max(1, Math.floor((width - more) / (size + gap)));
}

/** A row of earned badges (profiles), as many as fit the width; `onPress` opens the full collection. */
export function BadgeStrip({ badges, onPress, empty, size = 44 }: { badges: EarnedBadge[]; onPress?: () => void; empty: string; size?: number }) {
  const [width, setWidth] = useState(0);
  const sorted = byTier(badges);
  const shown = sorted.slice(0, medalsThatFit(width, sorted.length, size));
  return (
    <PressableScale onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={badges.length ? `${badges.length} badges: ${sorted.map((b) => `${TIER_LABEL[b.tier]} ${b.title}`).join(', ')}` : empty}>
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: badges.length ? size : undefined }}>
        {badges.length ? shown.map((b) => <BadgeMedal key={b.id} tier={b.tier} category={b.category} size={size} />) : <Txt color="textMuted" style={{ flex: 1 }}>{empty}</Txt>}
        {width && badges.length > shown.length ? <Txt variant="label" color="textMuted" tabular>{`+${badges.length - shown.length}`}</Txt> : null}
      </View>
    </PressableScale>
  );
}

/** How the global ranking is calculated, with my own breakdown (numbers from the server's published config). */
export function RankingExplainer({ rules, badges }: { rules: RankingRules; badges: EarnedBadge[] }) {
  const { palette: p } = useTheme();
  const mine = achievementScore(badges, rules.tierPoints, rules.categoryBonus);
  const tiers: BadgeTier[] = ['bronze', 'silver', 'gold', 'platinum'];
  return (
    <View style={{ gap: spacing.md }}>
      <Txt color="textMuted">Your rank comes only from challenge badges. Movement points never count, so spending them never costs you a place.</Txt>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {tiers.map((t) => (
          <View key={t} style={{ flex: 1, alignItems: 'center', gap: 4 }} accessible accessibilityLabel={`${TIER_LABEL[t]} badge adds ${rules.tierPoints[t]} to your score`}>
            <BadgeMedal tier={t} size={44} />
            <Txt variant="label" tabular>{`${rules.tierPoints[t]}`}</Txt>
            <Txt variant="micro" color="textMuted">{TIER_LABEL[t]}</Txt>
          </View>
        ))}
      </View>
      <Txt color="textMuted">{`Plus ${rules.categoryBonus} for each of the six categories where you hold at least one badge, so breadth counts as well as difficulty. Equal scores share a rank.`}</Txt>
      <Card tone="soft">
        <Txt variant="label">Your score</Txt>
        <View style={styles.sum}><Txt color="textMuted">{`${badges.length} ${badges.length === 1 ? 'badge' : 'badges'}`}</Txt><Txt variant="bodyStrong" tabular>{mine.tierTotal}</Txt></View>
        <View style={styles.sum}><Txt color="textMuted">{`${mine.categories} ${mine.categories === 1 ? 'category' : 'categories'} × ${rules.categoryBonus}`}</Txt><Txt variant="bodyStrong" tabular>{mine.bonus}</Txt></View>
        <View style={[styles.sum, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border, paddingTop: spacing.sm }]}><Txt variant="bodyStrong">Total</Txt><Txt variant="headline" tabular>{mine.score}</Txt></View>
      </Card>
      <Txt variant="caption">Badges come from verified runs and still-valid results. If a result is ruled invalid, the badge it supported is removed. The values are proposed for the pilot and may change.</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  challenge: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5 },
  sum: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }
});
