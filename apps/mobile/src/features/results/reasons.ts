import { REASON_TEXT, type ReasonCode, type SPEED_RULES, type TERRITORY_RULES } from '@loopfield/core';

type Territory = typeof TERRITORY_RULES;
type Speed = typeof SPEED_RULES;

/** Reasons a result did not count that the runner can do something about (support links appear on these). */
export const NOT_COUNTED_STATUSES = new Set(['unranked', 'invalid', 'pending_review']);

/**
 * A reason in plain language, with the numbers of the rules the result was judged by when they are known
 * (the season's rules from the back office, or the built-in ones). Without them the general text is used.
 */
export function explainReason(code: string, rules: { territory?: Territory | null; speed?: Speed | null }, distance: (m: number) => string): string {
  const t = rules.territory;
  const s = rules.speed;
  if (t) {
    switch (code) {
      case 'too_short':
        return `The loop is shorter than the ${distance(t.minLoopLengthMeters.value)} minimum.`;
      case 'too_long':
        return `The loop is longer than the ${distance(t.maxLoopLengthMeters.value)} maximum.`;
      case 'area_too_large':
        return `The enclosed area is larger than the ${+(t.maxCandidateAreaSquareMeters.value / 1_000_000).toFixed(2)} km² maximum.`;
      case 'open_loop':
        return `The finish was more than ${t.closureMaxGapMeters.value} m from where the loop capture started, so the loop did not close.`;
      case 'unreliable_endpoints':
        return `GPS at the start or finish was less accurate than ${t.closureEndpointMaxAccuracyMeters.value} m, so the loop's closure could not be confirmed.`;
      case 'recording_gap':
        return `GPS evidence has a gap longer than ${t.maxSampleGapSeconds.value} s inside the loop capture.`;
      case 'low_accuracy':
        return `Too many GPS fixes were less accurate than ${t.maxUsableAccuracyMeters.value} m to support a result.`;
      case 'insufficient_samples':
        return `There were fewer than ${t.minSamples.value} usable GPS fixes in the loop capture.`;
      case 'no_eligible_cells':
        return `After the ${t.boundaryUncertaintyBandMeters.value} m edge band and unavailable areas, no whole cell remained inside the loop.`;
    }
  }
  if (s) {
    switch (code) {
      case 'low_coverage':
        return `Less than ${Math.round(s.minCoverage.value * 100)}% of the route was covered within ${s.corridorMeters.value} m of the course.`;
      case 'timing_uncertainty':
        return `Timing uncertainty was above the ${s.maxAttemptUncertaintySeconds.value} s limit.`;
      case 'gate_fix_spacing':
        return `GPS fixes around a timing gate were more than ${s.gateMaxFixSpacingSeconds.value} s apart.`;
      case 'missed_checkpoint':
        return `A required checkpoint was missed: the route passes within ${s.checkpointRadiusMeters.value} m of each one.`;
    }
  }
  return REASON_TEXT[code as ReasonCode] ?? code.replace(/_/g, ' ');
}
