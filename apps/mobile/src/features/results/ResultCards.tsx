import { View } from 'react-native';
import { router } from 'expo-router';
import { formatDuration, REASON_TEXT, type ReasonCode } from '@loopfield/core';
import { fmtArea, fmtDate } from '@/lib/format';
import { Badge, Button, Card, Txt } from '@/components/ui';
import { useUnits } from '@/state/session';
import { useNow } from '@/lib/useNow';
import { spacing } from '@/theme/tokens';

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
  if (!reasons.length) return null;
  return (
    <View style={{ gap: spacing.xs }} accessibilityRole="summary">
      {reasons.map((r) => (
        <Txt key={r} variant="caption">• {reasonText(r)}</Txt>
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
export function LandCard({ claim, territoryRequested }: { claim: ClaimJson | null; territoryRequested: boolean }) {
  const units = useUnits();
  const now = useNow();
  if (!territoryRequested) return null;
  if (!claim) {
    return (
      <Card accessibilityLabel="Land result">
        <Txt variant="heading">Land</Txt>
        <Txt color="textMuted">Waiting for the server to check this loop. Results here are authoritative; anything shown during the run was only a preview.</Txt>
      </Card>
    );
  }
  const s = STATUS_LABEL[claim.status] ?? { label: claim.status, tone: 'info' as const };
  const pendingPublication = claim.status === 'eligible' && claim.publish_after && Date.parse(claim.publish_after) > now;
  const partial = claim.status === 'eligible' && claim.raw_area_m2 && claim.eligible_area_m2 != null && claim.eligible_area_m2 < claim.raw_area_m2 * 0.98;
  return (
    <Card accessibilityLabel="Land result">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="heading">Land</Txt>
        <Badge label={s.label} tone={s.tone} />
      </View>
      {claim.status === 'eligible' ? (
        <>
          <Txt variant="title">{fmtArea(claim.eligible_area_m2, units)}</Txt>
          <Txt color="textMuted">{claim.eligible_cell_count ?? 0} cells. The newest eligible completed loop takes overlapping cells, so another runner can take them back.</Txt>
          {pendingPublication ? <Txt variant="caption">Provisional. Appears on the public map after {fmtDate(claim.publish_after, { dateStyle: 'medium', timeStyle: 'short' })}.</Txt> : null}
          {partial ? <Txt variant="caption">Only cells fully inside your loop after the edge uncertainty band, and outside unavailable areas, count — so part of the enclosed area was not claimed.</Txt> : null}
        </>
      ) : null}
      {claim.status === 'processing' ? <Txt color="textMuted">Checking the loop on the server…</Txt> : null}
      <Reasons reasons={claim.reasons} />
      {claim.invalidation_reason ? <Txt variant="caption">Correction: {claim.invalidation_reason}</Txt> : null}
      <Txt variant="caption">Rules {claim.rule_version} (proposed thresholds pending field validation)</Txt>
      {claim.status === 'invalid' || claim.status === 'unranked' || claim.status === 'pending_review' ? (
        <Button variant="secondary" label="Request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'loop_claim', id: claim.id } })} />
      ) : null}
    </Card>
  );
}

/** Route title result: same versioned route only; speed never moves land (PRD §6). */
export function TitleCards({ attempts, context }: { attempts: AttemptJson[]; context: { attempt_id: string; benchmark_ms: number; champion_is_me: boolean }[] }) {
  const now = useNow();
  if (!attempts.length) return null;
  return (
    <>
      {attempts.map((a) => {
        const s = STATUS_LABEL[a.status] ?? { label: a.status, tone: 'info' as const };
        const ctx = context.find((c) => c.attempt_id === a.id);
        const pendingPublication = a.publish_after && Date.parse(a.publish_after) > now;
        return (
          <Card key={a.id} accessibilityLabel={`Route title result for ${a.course_name}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt variant="heading" style={{ flex: 1 }}>{a.course_name}</Txt>
              <Badge label={a.is_benchmark ? 'Champion' : s.label} tone={a.is_benchmark ? 'title' : s.tone} />
            </View>
            {a.elapsed_ms != null ? <Txt variant="title">{formatDuration(a.elapsed_ms)}</Txt> : null}
            {a.uncertainty_ms != null ? <Txt variant="caption">Timing uncertainty ±{(a.uncertainty_ms / 1000).toFixed(1)} s</Txt> : null}
            {a.is_benchmark ? <Txt color="textMuted">You hold this route title{pendingPublication ? ' (provisional until publication)' : ''}.</Txt> : null}
            {!a.is_benchmark && a.status === 'eligible' && ctx ? (
              <Txt color="textMuted">Current record {formatDuration(ctx.benchmark_ms)}. A new title needs a clear margin over the record, not a near tie.</Txt>
            ) : null}
            {a.is_founding ? <Txt variant="caption">Founding run on a newly approved route.</Txt> : null}
            <Reasons reasons={a.reasons} />
            <Txt variant="caption">Rules {a.rule_version} (proposed)</Txt>
            {a.status === 'invalid' || a.status === 'unranked' || a.status === 'pending_review' ? (
              <Button variant="secondary" label="Request a review" onPress={() => router.push({ pathname: '/appeals', params: { type: 'speed_attempt', id: a.id } })} />
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
