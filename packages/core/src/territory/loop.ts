import {
  centroidOf,
  compactness,
  haversineMeters,
  isSimpleRing,
  makeProjector,
  pathLengthMeters,
  ringAreaSquareMeters,
  ringPerimeterMeters,
  type LatLng
} from '../geo/geo.ts';
import { decide, type Decision, type ReasonCode } from '../rules/decisions.ts';
import { TERRITORY_RULES } from '../rules/config.ts';
import { canonicalSamples, findGaps, isUsable, pausedIntervals } from '../recording/summary.ts';
import type { LocationSample, RecordingEvent } from '../recording/types.ts';

export interface LoopInterval {
  startT: number;
  endT: number;
  startSeq: number;
  endSeq: number;
}

export interface LoopEvaluation {
  decision: Decision;
  reasons: ReasonCode[];
  interval: LoopInterval | null;
  /** Closed ring (first point not repeated) built from usable fixes, for PostGIS evaluation. */
  ring: LatLng[];
  lengthM: number;
  closureGapM: number | null;
  areaEstimateM2: number;
  compactness: number;
  /** Verified completion time = time of the last usable fix in the interval. */
  completedAt: number | null;
  startedAt: number | null;
  usableShare: number;
  ruleVersion: string;
}

type Rules = typeof TERRITORY_RULES;

/** Locate the explicit capture interval (PRD §6 Capture interval). Only the first complete pair counts. */
export function findCaptureInterval(events: readonly RecordingEvent[], samples: readonly LocationSample[]): LoopInterval | null {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const start = sorted.find((e) => e.kind === 'capture_start');
  if (!start) return null;
  const end = sorted.find((e) => e.kind === 'capture_end' && e.t >= start.t);
  if (!end) return null;
  const inside = samples.filter((s) => s.t >= start.t && s.t <= end.t);
  if (inside.length === 0) return { startT: start.t, endT: end.t, startSeq: start.afterSeq + 1, endSeq: end.afterSeq };
  return { startT: start.t, endT: end.t, startSeq: inside[0]!.seq, endSeq: inside[inside.length - 1]!.seq };
}

/** Longest stretch over which the implied speed exceeded a threshold (seconds). */
function longestFastStretchSeconds(samples: readonly LocationSample[], thresholdMps: number): number {
  let best = 0;
  let current = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const v = haversineMeters(a, b) / dt;
    if (v > thresholdMps) {
      current += dt;
      best = Math.max(best, current);
    } else current = 0;
  }
  return best;
}

/** Drop consecutive duplicates closer than minSpacing so ring construction is stable. */
function thinRing(points: readonly LatLng[], minSpacingM: number): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || haversineMeters(last, p) >= minSpacingM) out.push(p);
  }
  return out;
}

/**
 * Pre-validation of a territory loop from first-party evidence. This is deterministic and runs
 * server-side in the worker; the client uses it only for a provisional preview. PostGIS then
 * re-checks validity, computes area on the geography, removes the uncertainty band, and selects
 * fully-contained cells after exclusions and privacy masks.
 */
export function evaluateLoop(
  rawSamples: readonly LocationSample[],
  events: readonly RecordingEvent[],
  rules: Rules = TERRITORY_RULES
): LoopEvaluation {
  const reasons = new Set<ReasonCode>();
  const samples = canonicalSamples(rawSamples);
  const interval = findCaptureInterval(events, samples);
  const empty: LoopEvaluation = {
    decision: 'unranked',
    reasons: ['interval_missing'],
    interval,
    ring: [],
    lengthM: 0,
    closureGapM: null,
    areaEstimateM2: 0,
    compactness: 0,
    completedAt: null,
    startedAt: null,
    usableShare: 0,
    ruleVersion: rules.version
  };
  if (!interval) return empty;

  const inside = samples.filter((s) => s.t >= interval.startT && s.t <= interval.endT);
  if (inside.some((s) => s.mocked)) reasons.add('mock_location');

  const pauses = pausedIntervals(events, interval.endT).filter((p) => p.endT > interval.startT && p.startT < interval.endT);
  if (pauses.length > 0) reasons.add('paused_interval');
  if (events.some((e) => (e.kind === 'interrupted' || e.kind === 'permission_lost') && e.t >= interval.startT && e.t <= interval.endT)) {
    reasons.add('recording_gap');
  }

  const usable = inside.filter((s) => isUsable(s, rules.maxUsableAccuracyMeters.value));
  const usableShare = inside.length === 0 ? 0 : usable.length / inside.length;
  if (usable.length < rules.minSamples.value) {
    reasons.add('insufficient_samples');
    return { ...empty, reasons: [...reasons], decision: decide([...reasons]), usableShare };
  }
  if (usableShare < rules.minUsableFixShare.value) reasons.add('low_accuracy');

  // Gaps measured against the explicit interval boundaries as well as between fixes.
  const gaps = findGaps(usable, rules.maxSampleGapSeconds.value);
  const leadGap = (usable[0]!.t - interval.startT) / 1000;
  const tailGap = (interval.endT - usable[usable.length - 1]!.t) / 1000;
  if (gaps.length > 0 || leadGap > rules.maxSampleGapSeconds.value || tailGap > rules.maxSampleGapSeconds.value) {
    reasons.add('recording_gap');
  }

  // GPS jumps: implied speed far above running between consecutive good fixes.
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1]!;
    const b = usable[i]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) {
      reasons.add('clock_inconsistent');
      continue;
    }
    const tolerance = (a.acc ?? 0) + (b.acc ?? 0);
    if ((haversineMeters(a, b) - tolerance) / dt > rules.maxJumpSpeedMetersPerSecond.value) {
      reasons.add('gps_jump');
      break;
    }
  }
  if (longestFastStretchSeconds(usable, rules.suspiciousSustainedSpeedMetersPerSecond.value) >= rules.suspiciousSustainedSeconds.value) {
    reasons.add('suspicious_speed');
  }

  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  const closureGapM = haversineMeters(first, last);
  if (closureGapM > rules.closureMaxGapMeters.value) reasons.add('open_loop');
  if ((first.acc ?? Infinity) > rules.closureEndpointMaxAccuracyMeters.value || (last.acc ?? Infinity) > rules.closureEndpointMaxAccuracyMeters.value) {
    reasons.add('unreliable_endpoints');
  }

  const lengthM = pathLengthMeters(usable) + closureGapM;
  if (lengthM < rules.minLoopLengthMeters.value) reasons.add('too_short');
  if (lengthM > rules.maxLoopLengthMeters.value) reasons.add('too_long');

  let ring = thinRing(usable, 3);
  // Do not repeat the first point; drop the last if it coincides with the first.
  if (ring.length > 1 && haversineMeters(ring[0]!, ring[ring.length - 1]!) < 3) ring = ring.slice(0, -1);
  if (ring.length > rules.maxRingVertices.value) reasons.add('too_long');

  const areaEstimateM2 = ringAreaSquareMeters(ring);
  const perimeter = ringPerimeterMeters(ring);
  const compact = compactness(areaEstimateM2, perimeter);
  if (areaEstimateM2 > rules.maxCandidateAreaSquareMeters.value) reasons.add('area_too_large');

  const proj = makeProjector(centroidOf(ring));
  if (ring.length < 4 || !isSimpleRing(ring.map(proj.toXY))) reasons.add('self_crossing');
  if (compact < rules.minCompactness.value) reasons.add('degenerate_geometry');

  const reasonList = [...reasons];
  return {
    decision: decide(reasonList),
    reasons: reasonList,
    interval,
    ring,
    lengthM: Math.round(lengthM),
    closureGapM: Math.round(closureGapM * 10) / 10,
    areaEstimateM2: Math.round(areaEstimateM2),
    compactness: Math.round(compact * 1000) / 1000,
    completedAt: last.t,
    startedAt: first.t,
    usableShare: Math.round(usableShare * 1000) / 1000,
    ruleVersion: rules.version
  };
}

/** Closure indicator for the live recording screen — provisional until server validation. */
export function closureHint(
  firstFix: LocationSample | null,
  current: LocationSample | null,
  travelledM: number,
  rules: Rules = TERRITORY_RULES
): 'not_started' | 'open' | 'possible_closure' {
  if (!firstFix || !current) return 'not_started';
  if (travelledM < rules.minLoopLengthMeters.value) return 'open';
  return haversineMeters(firstFix, current) <= rules.closureMaxGapMeters.value ? 'possible_closure' : 'open';
}
