import { View } from 'react-native';
import { router } from 'expo-router';
import { formatDuration, REASON_TEXT, type ReasonCode } from '@loopfield/core';
import { fmtArea, fmtDate, splitValue } from '@/lib/format';
import { Badge, BigNumber, Button, Card, Skeleton, Txt } from '@/components/ui';
import type { ActivityJson } from './useActivity';
import { Icon } from '@/components/icons';
import { useUnits } from '@/state/session';
import { useNow } from '@/lib/useNow';
import { spacing, useTheme } from '@/theme/tokens';

export interface ClaimJson {
  id: string;
  status: 'processing' | 'eligible' | 'pending_review' | 'unranked' | 'invalid' | 'withheld_privacy' | 'withdrawn';
  reasons: string[];
  rule_version: string;
  publish_after: string | null;
  published_at: string | null;
  provisional_until: string | null;
  raw_area_m2: number | null;
  eligible_area_m2: number | null;
  eligible_cell_count: number | null;
  length_m: number | null;
  invalidation_reason: string | null;
  polygon: GeoJSON.Polygon | null;
}

/** What the run's loop did in one layer (activity_detail.layers): the all-time map, the season race, an event. */
export interface LayerResult {
  claim_id: string;
  competition_id: string;
  season_id: string | null;
  kind: 'public' | 'club' | 'permanent' | 'event';
  name: string;
  status: ClaimJson['status'];
  reasons: string[];
  cells: number;
  area_m2: number;
  published: boolean;
  /** Cells that changed hands to you (from nobody or from another runner). */
  gained_cells: number;
  /** Cells you already held there, refreshed by this loop. */
  kept_cells: number;
  /** Of the gained cells, how many were another runner's, and how many runners that was. */
  taken_cells: number;
  rivals: number;
}

export interface AttemptJson {
  id: string;
  status: 'processing' | 'eligible' | 'pending_review' | 'unranked' | 'invalid' | 'withdrawn';
  reasons: string[];
  rule_version: string;
  elapsed_ms: number | null;
  uncertainty_ms: number | null;
  coverage: number | null;
  publish_after: string | null;
  course_name: string;
  course_version_id: string;
  is_benchmark: boolean;
  is_published_champion: boolean;
  is_founding: boolean;
}

export const reasonText = (code: string) => REASON_TEXT[code as ReasonCode] ?? code.replace(/_/g, ' ');

function Reasons({ reasons }: { reasons: string[] }) {
  const { palette: p } = useTheme();
  if (!reasons.length) return null;
  return (
    <View style={{ gap: spacing.xs }} accessibilityRole="summary">
      {reasons.map((r) => (
        <View key={r} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <View style={{ marginTop: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: p.textSubtle }} />
          <Txt variant="caption" style={{ flex: 1 }}>{reasonText(r)}</Txt>
        </View>
      ))}
    </View>
  );
}

const STATUS_LABEL: Record<string, { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'title' }> = {
  processing: { label: 'Checking', tone: 'info' },
  eligible: { label: 'Eligible', tone: 'success' },
  pending_review: { label: 'Under review', tone: 'warning' },
  unranked: { label: 'Not counted', tone: 'muted' },
  invalid: { label: 'Not valid', tone: 'danger' },
  withheld_privacy: { label: 'Withheld for privacy', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' }
};

/** Land result: separate from route titles; area never transfers or protects titles (PRD §6). */
/**
 * A run the server marked for moving unlike a runner: what that means for this run, and how to ask for a
 * review when it was a GPS error. Nothing is shown for an ordinary run.
 */
export function IntegrityCard({ activity }: { activity: ActivityJson | null | undefined }) {
  const { palette: p } = useTheme();
  const flags = activity?.integrity_flags ?? [];
  if (!activity || !flags.length) return null;
  return (
    <Card tone="soft" accessibilityLabel="This run is marked for review">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="shield" color={p.warning} size={22} />
        <Txt variant="heading" style={{ flex: 1 }}>Marked for review</Txt>
      </View>
      {flags.map((f) => <Txt key={f} color="textMuted">{REASON_TEXT[f as ReasonCode] ?? f}</Txt>)}
      <Txt color="textMuted">Movement points were not counted for that part, and land from this run is held until a reviewer looks at it.</Txt>
      <Button variant="secondary" icon="flag" label="It was a GPS error: request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'activity', id: activity.id } })} />
    </Card>
  );
}

const LAYER_LABEL = (l: LayerResult) => (l.kind === 'permanent' ? 'All-time map' : l.kind === 'public' ? 'Season race' : l.name);

/** "+12 cells, 4 taken from 2 runners" / "12 cells you already held" for one layer. */
export function layerOutcome(l: LayerResult): string {
  if (l.status !== 'eligible') {
    if (l.reasons.includes('season_boundary')) return l.kind === 'event' ? 'Not counted: the run crossed the event\'s start or end' : 'Not counted: the run crossed the season\'s start or end';
    return STATUS_LABEL[l.status]?.label ?? l.status;
  }
  if (!l.gained_cells && l.kept_cells) return `${l.kept_cells} ${l.kept_cells === 1 ? 'cell' : 'cells'} you already held`;
  const gained = `+${l.gained_cells} ${l.gained_cells === 1 ? 'cell' : 'cells'}`;
  const taken = l.taken_cells ? `, ${l.taken_cells} taken from ${l.rivals} ${l.rivals === 1 ? 'runner' : 'runners'}` : '';
  const kept = l.kept_cells ? `, ${l.kept_cells} kept` : '';
  return gained + taken + kept;
}

/** The same loop in each layer it counted in (shown under the land result when there is more than one). */
function LayerLines({ layers }: { layers: LayerResult[] }) {
  return (
    <View style={{ gap: spacing.xs }} accessibilityRole="summary" accessibilityLabel={layers.map((l) => `${LAYER_LABEL(l)}: ${layerOutcome(l)}`).join('. ')}>
      {layers.map((l) => (
        <View key={l.claim_id} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline' }}>
          <Txt variant="label" numberOfLines={1} style={{ flexShrink: 0, maxWidth: '45%' }}>{LAYER_LABEL(l)}</Txt>
          <Txt variant="caption" style={{ flex: 1 }}>{layerOutcome(l)}</Txt>
        </View>
      ))}
    </View>
  );
}

export function LandCard({ claim, territoryRequested, layers = [] }: { claim: ClaimJson | null; territoryRequested: boolean; layers?: LayerResult[] }) {
  const { palette: p } = useTheme();
  const units = useUnits();
  const now = useNow();
  if (!territoryRequested) return null;
  if (!claim || claim.status === 'processing') {
    return (
      <Card accessibilityLabel="Land result">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="hexagon" color={p.primary} size={22} />
          <Txt variant="heading" style={{ flex: 1 }}>Land</Txt>
          <Badge label="Checking" tone="info" />
        </View>
        <Txt color="textMuted">{claim ? 'Checking the loop on the server…' : 'Waiting for the server to check this loop. Results here are authoritative; anything shown during the run was only a preview.'}</Txt>
        <Skeleton width="60%" height={14} />
      </Card>
    );
  }
  const s = STATUS_LABEL[claim.status] ?? { label: claim.status, tone: 'info' as const };
  const pendingPublication = claim.status === 'eligible' && claim.publish_after && Date.parse(claim.publish_after) > now;
  const partial = claim.status === 'eligible' && claim.raw_area_m2 && claim.eligible_area_m2 != null && claim.eligible_area_m2 < claim.raw_area_m2 * 0.98;
  const eligible = claim.status === 'eligible';
  const area = splitValue(fmtArea(claim.eligible_area_m2, units));
  return (
    <Card tone={eligible ? 'violet' : 'surface'} accessibilityLabel="Land result">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="hexagon" color={eligible ? '#FFFFFF' : p.primary} size={22} />
        <Txt variant="heading" style={{ flex: 1 }}>{eligible ? 'Land claimed' : 'Land'}</Txt>
        <Badge label={s.label} tone={s.tone} />
      </View>
      {eligible ? (
        <>
          <BigNumber value={area.value} unit={area.unit} size={64} />
          <Txt color="textMuted">{`${claim.eligible_cell_count ?? 0} cells. The newest eligible completed loop takes overlapping cells, so another runner can take them back.`}</Txt>
          {layers.length > 1 ? <LayerLines layers={layers} /> : null}
          {pendingPublication ? <Badge icon="clock" label={`On the public map after ${fmtDate(claim.publish_after, { dateStyle: 'medium', timeStyle: 'short' })}`} /> : null}
          {partial ? <Txt variant="caption">Only cells fully inside your loop after the edge uncertainty band, and outside unavailable areas, count, so part of the enclosed area was not claimed.</Txt> : null}
          <Button label="See it on the map" arrow onPress={() => router.push('/map')} />
        </>
      ) : null}
      <Reasons reasons={claim.reasons} />
      {claim.invalidation_reason ? <Txt variant="caption">Correction: {claim.invalidation_reason}</Txt> : null}
      <Txt variant="caption">Rules {claim.rule_version} (proposed thresholds pending field validation)</Txt>
      {claim.status === 'invalid' || claim.status === 'unranked' || claim.status === 'pending_review' ? (
        <Button variant="secondary" icon="flag" label="Request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'loop_claim', id: claim.id } })} />
      ) : null}
    </Card>
  );
}

/** Route title result: same versioned route only; speed never moves land (PRD §6). */
export function TitleCards({ attempts, context }: { attempts: AttemptJson[]; context: { attempt_id: string; benchmark_ms: number; champion_is_me: boolean }[] }) {
  const { palette: p } = useTheme();
  const now = useNow();
  if (!attempts.length) return null;
  return (
    <>
      {attempts.map((a) => {
        const s = STATUS_LABEL[a.status] ?? { label: a.status, tone: 'info' as const };
        const ctx = context.find((c) => c.attempt_id === a.id);
        const pendingPublication = a.publish_after && Date.parse(a.publish_after) > now;
        return (
          <Card key={a.id} tone={a.is_benchmark ? 'orange' : 'surface'} accessibilityLabel={`Route title result for ${a.course_name}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name={a.is_benchmark ? 'crown' : 'stopwatch'} color={a.is_benchmark ? '#121318' : p.orangeText} size={22} />
              <Txt variant="heading" style={{ flex: 1 }} numberOfLines={2}>{a.course_name}</Txt>
              <Badge label={a.is_benchmark ? 'Title holder' : s.label} tone={a.is_benchmark ? 'title' : s.tone} />
            </View>
            {a.elapsed_ms != null ? <Txt variant={a.is_benchmark ? 'hero' : 'metric'} style={a.is_benchmark ? { fontSize: 60, lineHeight: 62 } : undefined}>{formatDuration(a.elapsed_ms)}</Txt> : null}
            {a.uncertainty_ms != null ? <Txt variant="caption">Timing uncertainty ±{(a.uncertainty_ms / 1000).toFixed(1)} s</Txt> : null}
            {a.is_benchmark ? <Txt variant="bodyStrong">You hold this route title{pendingPublication ? ' (provisional until publication)' : ''}.</Txt> : null}
            {!a.is_benchmark && a.status === 'eligible' && ctx ? (
              <Txt color="textMuted">Current record {formatDuration(ctx.benchmark_ms)}. A new title needs a clear margin over the record, not a near tie.</Txt>
            ) : null}
            {a.is_founding ? <Badge icon="sparkle" label="Founding run on a newly approved route" /> : null}
            <Reasons reasons={a.reasons} />
            <Txt variant="caption">Rules {a.rule_version} (proposed)</Txt>
            {a.status === 'invalid' || a.status === 'unranked' || a.status === 'pending_review' ? (
              <Button variant="secondary" icon="flag" label="Request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'speed_attempt', id: a.id } })} />
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
