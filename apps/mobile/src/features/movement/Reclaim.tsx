import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MOVEMENT_REASON_TEXT } from '@loopfield/core';
import Svg, { Polygon } from 'react-native-svg';
import { friendlyError } from '@/lib/api';
import { fmtDate, fmtDistance } from '@/lib/format';
import { useUnits } from '@/state/session';
import { Banner, Button, confirm, EmptyState, ErrorState, LoadingState, PressableScale, Sheet, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Celebration } from '@/features/run/Celebration';
import { controllerColor, radius, spacing, useTheme } from '@/theme/tokens';
import { groupLost, useActivityMovement, useLostCells, useMovement, useReclaim, useReclaimQuote, type LostCell, type ReclaimResult } from './api';

const pts = (n: number) => `${n.toLocaleString()} ${Math.abs(n) === 1 ? 'point' : 'points'}`;

/** Movement points balance as a small pill (map, profile). */
export function PointsChip({ balance, onPress, loading }: { balance: number | null | undefined; onPress?: () => void; loading?: boolean }) {
  const t = useTheme();
  const p = t.palette;
  const label = loading || balance == null ? 'Movement points' : `${balance.toLocaleString()} movement points`;
  return (
    <PressableScale onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={onPress ? `${label}. Open points` : label}
      style={[styles.chip, { backgroundColor: p.surface }, t.elevation.floating]}>
      <View style={[styles.chipIcon, { backgroundColor: t.blocks.green.bg }]}>
        <Icon name="bolt" color="#121318" size={16} strokeWidth={2.2} />
      </View>
      <Txt variant="bodyStrong" tabular numberOfLines={1}>{loading || balance == null ? '–' : balance.toLocaleString()}</Txt>
      <Txt variant="caption" numberOfLines={1}>pts</Txt>
    </PressableScale>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  const { palette: p } = useTheme();
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <Txt variant={strong ? 'bodyStrong' : 'body'} color={strong ? 'text' : 'textMuted'}>{label}</Txt>
      <Txt variant={strong ? 'headline' : 'bodyStrong'} tabular style={tone ? { color: tone === 'good' ? p.greenText : p.danger } : undefined}>{value}</Txt>
    </View>
  );
}

/** The receipt shown before anything is spent: count, unit cost, total, balance and what remains. */
export function ReclaimReceipt({ cells, costPerCell, total, balance, remaining }: { cells: number; costPerCell: number; total: number; balance: number; remaining: number }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.receipt, { backgroundColor: p.surfaceAlt }]}>
      <Line label="Selected" value={`${cells} ${cells === 1 ? 'cell' : 'cells'}`} />
      <Line label="Cost per cell" value={pts(costPerCell)} />
      <View style={[styles.rule, { backgroundColor: p.border }]} />
      <Line label="Total" value={pts(total)} strong />
      <Line label="Your balance" value={pts(balance)} />
      <Line label="After reclaiming" value={pts(remaining)} tone={remaining < 0 ? 'bad' : 'good'} />
    </View>
  );
}

/** Confirm, spend and report. Shared by the map selection and the list flow. */
export function useReclaimFlow(competitionId: string | undefined, seasonId: string | undefined) {
  const reclaim = useReclaim(competitionId, seasonId);
  const [done, setDone] = useState<ReclaimResult | null>(null);
  const start = (cells: string[], total: number, balance: number) =>
    confirm(
      `Reclaim ${cells.length} ${cells.length === 1 ? 'cell' : 'cells'}?`,
      `This spends ${pts(total)} of your ${balance.toLocaleString()}. Any runner's later loop can take the ground again.`,
      'Reclaim',
      () => reclaim.mutate(cells, { onSuccess: (r) => setDone(r) }),
      false
    );
  return { start, busy: reclaim.isPending, error: reclaim.error, done, reset: () => { setDone(null); reclaim.reset(); } };
}

/** Success: the ground is back. */
export function ReclaimDone({ result, onDone }: { result: ReclaimResult; onDone: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm }} accessibilityLiveRegion="polite">
      <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center' }}>
        <Celebration />
        <Svg width={72} height={78} viewBox="0 0 26 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Polygon points="13,2 24,8 24,20 13,26 2,20 2,8" fill={t.territory.mineFill} stroke={t.territory.mineLine} strokeWidth={1.6} />
        </Svg>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" color="#FFFFFF" size={30} strokeWidth={3} />
          </View>
        </View>
      </View>
      <Txt variant="title" align="center">{`${result.reclaimed} ${result.reclaimed === 1 ? 'cell is' : 'cells are'} yours again`}</Txt>
      <Txt color="textMuted" align="center">
        {`Spent ${pts(result.spent)} · ${result.balance.toLocaleString()} left.${result.skipped ? ` ${result.skipped} ${result.skipped === 1 ? 'cell' : 'cells'} had already changed hands and ${result.skipped === 1 ? 'was' : 'were'} not charged.` : ''}`}
      </Txt>
      <Button label="Done" size="lg" onPress={onDone} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Round checkbox used by the list rows and by "select all". */
function Check({ on }: { on: boolean }) {
  const { palette: p } = useTheme();
  return (
    <View style={[styles.check, { borderColor: on ? p.primaryFill : p.borderStrong, backgroundColor: on ? p.primaryFill : 'transparent' }]}>
      {on ? <Icon name="check" color="#FFFFFF" size={16} strokeWidth={3} /> : null}
    </View>
  );
}

const BLOCKED: Record<string, string> = {
  taken_with_points: 'Taken back with points: only a run can win it back',
  season_closed: 'The season is closed',
  not_participating: 'Turn on territory in Privacy settings'
};

/**
 * Choosing lost cells without a map (browser, Expo Go, or by preference): grouped by who took them
 * and when, with the same receipt and confirmation as the map.
 */
export function ReclaimSheet({ visible, onClose, competitionId, seasonId }: { visible: boolean; onClose: () => void; competitionId?: string; seasonId?: string }) {
  const t = useTheme();
  const p = t.palette;
  const lost = useLostCells(competitionId, seasonId, 'all', visible);
  const movement = useMovement(visible);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupLost(lost.data ?? []), [lost.data]);
  const quote = useReclaimQuote(picked, lost.data, movement.data?.balance);
  const flow = useReclaimFlow(competitionId, seasonId);
  const reclaimable = (lost.data ?? []).filter((c) => c.reclaimable);
  const toggle = (cells: LostCell[]) => {
    const next = new Set(picked);
    const all = cells.every((c) => next.has(c.cell));
    for (const c of cells) {
      if (all) next.delete(c.cell);
      else next.add(c.cell);
    }
    setPicked(next);
  };
  const close = () => {
    setPicked(new Set());
    flow.reset();
    onClose();
  };
  const shortBy = quote.total - quote.balance;
  const allOn = reclaimable.length > 0 && reclaimable.every((c) => picked.has(c.cell));

  return (
    <Sheet visible={visible} title="Reclaim lost ground" onClose={close}>
      {flow.done ? (
        <ReclaimDone result={flow.done} onDone={close} />
      ) : lost.isLoading || movement.isLoading ? (
        <LoadingState />
      ) : lost.error ? (
        <ErrorState error={lost.error} onRetry={() => void lost.refetch()} />
      ) : !groups.length ? (
        <EmptyState icon="hexagon" title="Nothing to reclaim" body="When another runner's loop takes ground you held this season, it appears here and on your map." />
      ) : (
        <View style={{ gap: spacing.md }}>
          <Txt color="textMuted">Choose ground you held earlier this season. Each cell returns to you straight away.</Txt>
          {reclaimable.length > 1 ? (
            <PressableScale onPress={() => toggle(reclaimable)} accessibilityRole="checkbox" accessibilityState={{ checked: allOn }}
              accessibilityLabel={`Select all ${reclaimable.length} reclaimable cells`} style={styles.selectAll}>
              <Txt variant="label" style={{ flex: 1 }}>{allOn ? `All ${reclaimable.length} reclaimable cells selected` : `Select all ${reclaimable.length} reclaimable cells`}</Txt>
              <Check on={allOn} />
            </PressableScale>
          ) : null}
          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: spacing.sm }}>
            {groups.map((g) => {
              const on = g.reclaimable.length > 0 && g.reclaimable.every((c) => picked.has(c.cell));
              const blocked = g.reclaimable.length === 0;
              const reason = blocked ? BLOCKED[g.cells[0]!.blocked_reason ?? ''] ?? 'Not reclaimable' : null;
              return (
                <PressableScale key={g.key} onPress={() => toggle(g.reclaimable)} disabled={blocked} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: blocked }}
                  accessibilityLabel={`Taken by ${g.name} on ${fmtDate(g.lostOn)}, ${g.cells.length} cells${reason ? `. ${reason}` : `, ${g.reclaimable.length} reclaimable`}`}
                  style={[styles.group, { backgroundColor: on ? p.primarySoft : p.surfaceAlt, borderColor: on ? p.primary : 'transparent', opacity: blocked ? 0.7 : 1 }]}>
                  <Svg width={30} height={32} viewBox="0 0 26 28" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Polygon points="13,2 24,8 24,20 13,26 2,20 2,8" fill={controllerColor(g.controllerKey, t.territory.rivalHues)} fillOpacity={0.5}
                      stroke={t.territory.mineLine} strokeWidth={2} strokeDasharray="3,2" />
                  </Svg>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{`Taken by ${g.name}`}</Txt>
                    <Txt variant="caption" numberOfLines={2}>{reason ?? `${fmtDate(g.lostOn)} · ${g.cells.length} ${g.cells.length === 1 ? 'cell' : 'cells'}${g.reclaimable.length < g.cells.length ? ` (${g.reclaimable.length} reclaimable)` : ''}`}</Txt>
                  </View>
                  {blocked ? <Icon name="lock" color={p.textSubtle} size={20} /> : <Check on={on} />}
                </PressableScale>
              );
            })}
          </ScrollView>
          <ReclaimReceipt cells={quote.cells.length} costPerCell={quote.costPerCell} total={quote.total} balance={quote.balance} remaining={quote.remaining} />
          {quote.cells.length && shortBy > 0 ? <Banner tone="warning" text={`You need ${pts(shortBy)} more: about ${(shortBy * 100).toLocaleString()} m of running.`} /> : null}
          {flow.error ? <Banner tone="danger" text={friendlyError(flow.error)} /> : null}
          <Button
            label={quote.cells.length ? `Reclaim ${quote.cells.length} ${quote.cells.length === 1 ? 'cell' : 'cells'} for ${pts(quote.total)}` : 'Choose ground to reclaim'}
            size="lg"
            arrow
            loading={flow.busy}
            disabled={!quote.affordable || flow.busy}
            onPress={() => flow.start(quote.cells, quote.total, quote.balance)}
          />
        </View>
      )}
    </Sheet>
  );
}

/** What one run earned, and in plain words why some or all of it did not count. */
export function RunPointsCard({ activityId }: { activityId: string | undefined }) {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const m = useActivityMovement(activityId);
  const d = m.data;
  if (!activityId || m.isLoading) return null;
  const why = d?.reasons.length ? d.reasons.map((r) => MOVEMENT_REASON_TEXT[r as keyof typeof MOVEMENT_REASON_TEXT] ?? null).filter(Boolean).join(' ') : '';
  const line = !d || !d.processed
    ? 'Points appear once the server has verified this run.'
    : d.removed
      ? 'This run no longer earns points: it was removed or its result was ruled invalid.'
      : `${fmtDistance(d.verified_distance_m, units, 1)} verified${d.capped ? ' · daily limit reached' : ''}.${why ? ` ${why}` : ''}`;
  return (
    <PressableScale onPress={() => router.push('/points')} accessibilityRole="button" accessibilityLabel={`Movement points: ${d?.processed ? `${d.points} earned` : 'not yet verified'}. ${line} Open points`}
      style={[styles.runPoints, { backgroundColor: p.greenSoft }]}>
      <View style={[styles.chipIcon, { backgroundColor: t.blocks.green.bg }]}>
        <Icon name="bolt" color="#121318" size={16} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" style={{ color: p.greenText }}>{d?.processed ? `${d.points > 0 ? '+' : ''}${d.points} movement points` : 'Movement points'}</Txt>
        <Txt variant="caption" numberOfLines={3}>{line}</Txt>
      </View>
      <Icon name="chevron-right" color={p.greenText} size={18} />
    </PressableScale>
  );
}


const styles = StyleSheet.create({
  chip: { minHeight: 48, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: spacing.md },
  chipIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  receipt: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, minHeight: 64 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
  runPoints: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, minHeight: 60 }
});
