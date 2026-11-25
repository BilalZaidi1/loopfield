import { View } from 'react-native';
import type { HighlightKind } from '@loopfield/core';
import { Button, Card, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { useRunHighlights } from './highlights';
import { useActivityDetail, type LocalRun } from './useActivity';

const ICON: Record<HighlightKind, IconName> = {
  longest: 'route',
  fastest: 'stopwatch',
  faster_second_half: 'speed',
  land: 'hexagon',
  goal: 'target',
  streak: 'flame',
  effort: 'pulse',
  shoes: 'star'
};

/**
 * Highlights (R2): up to three lines about what was special in the run, at the top of the run summary and the
 * run's detail page. Written by fixed rules on this phone; the runner can hide them for a run.
 */
export function HighlightsCard({ activityId, local }: { activityId: string | null | undefined; local?: LocalRun | null }) {
  const p = usePalette();
  const uploaded = local ? local.uploadState === 'received' : true;
  const detail = useActivityDetail(activityId ?? undefined, Boolean(activityId) && uploaded);
  const s = local?.summary ?? null;
  const settled = Boolean(detail.data && detail.data.claim?.status !== 'processing');
  const h = useRunHighlights(activityId, {
    run: local?.startedAt && s ? { start: local.startedAt, distanceM: s.distanceM, durationMs: s.movingMs || s.elapsedMs, splits: s.splits } : null,
    layers: detail.data?.layers,
    landSettled: settled
  });
  if (!h || h.hidden || !h.lines.length) return null;
  return (
    <Card accessibilityLabel={`Highlights. ${h.lines.map((l) => l.text).join(' ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="sparkle" color={p.primary} size={20} />
        <Txt variant="heading" style={{ flex: 1 }}>Highlights</Txt>
        <Button size="sm" variant="ghost" label="Hide" onPress={h.hide} accessibilityLabel="Hide the highlights of this run" />
      </View>
      {h.lines.map((l) => (
        <View key={l.kind} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <Icon name={ICON[l.kind]} color={p.textMuted} size={18} />
          <Txt style={{ flex: 1 }}>{l.text}</Txt>
        </View>
      ))}
    </Card>
  );
}
