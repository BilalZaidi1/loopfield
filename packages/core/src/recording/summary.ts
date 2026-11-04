import { haversineMeters } from '../geo/geo.ts';
import { TERRITORY_RULES } from '../rules/config.ts';
import type { LocationSample, RecordingEvent } from './types.ts';

export interface Gap {
  fromSeq: number;
  toSeq: number;
  startT: number;
  endT: number;
  seconds: number;
}

export interface Split {
  index: number;
  distanceM: number;
  elapsedMs: number;
  /** True when a recording gap fell inside this split (time is still elapsed time). */
  containsGap: boolean;
}

export interface ActivitySummary {
  distanceM: number;
  elapsedMs: number;
  movingMs: number;
  avgPaceSecPerKm: number | null;
  splits: Split[];
  gaps: Gap[];
  pausedMs: number;
  sampleCount: number;
  usableSampleCount: number;
  elevationGainM: number | null;
}

/** True when the fix can contribute geometry. */
export function isUsable(s: LocationSample, maxAccuracyM: number = TERRITORY_RULES.maxUsableAccuracyMeters.value): boolean {
  return s.acc !== null && s.acc !== undefined && s.acc <= maxAccuracyM && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

/** Sort and de-duplicate samples by sequence (idempotent re-upload safety). */
export function canonicalSamples(samples: readonly LocationSample[]): LocationSample[] {
  const bySeq = new Map<number, LocationSample>();
  for (const s of samples) if (!bySeq.has(s.seq)) bySeq.set(s.seq, s);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Intervals where consecutive samples are further apart in time than the threshold. */
export function findGaps(samples: readonly LocationSample[], maxGapSeconds: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const seconds = (b.t - a.t) / 1000;
    if (seconds > maxGapSeconds) gaps.push({ fromSeq: a.seq, toSeq: b.seq, startT: a.t, endT: b.t, seconds });
  }
  return gaps;
}

/** Paused intervals derived from explicit pause/resume events. */
export function pausedIntervals(events: readonly RecordingEvent[], endT: number): Array<{ startT: number; endT: number; afterSeq: number }> {
  const out: Array<{ startT: number; endT: number; afterSeq: number }> = [];
  let open: RecordingEvent | null = null;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.kind === 'pause' && !open) open = e;
    else if (e.kind === 'resume' && open) {
      out.push({ startT: open.t, endT: e.t, afterSeq: open.afterSeq });
      open = null;
    }
  }
  if (open) out.push({ startT: open.t, endT, afterSeq: open.afterSeq });
  return out;
}

function inAnyInterval(t: number, intervals: ReadonlyArray<{ startT: number; endT: number }>): boolean {
  return intervals.some((i) => t > i.startT && t <= i.endT);
}

/**
 * Canonical activity summary. The same function runs on device (live estimate) and on the server
 * (authoritative reconciliation) so list and detail views agree after reconciliation (FR08).
 * Distance is never accumulated across gaps or pauses (FR07: no straight-line reconstruction).
 */
export function summarizeActivity(
  rawSamples: readonly LocationSample[],
  events: readonly RecordingEvent[],
  opts: { splitMeters?: number; maxGapSeconds?: number; movingSpeedMps?: number } = {}
): ActivitySummary {
  const splitMeters = opts.splitMeters ?? 1000;
  const maxGap = opts.maxGapSeconds ?? TERRITORY_RULES.maxSampleGapSeconds.value;
  const movingSpeed = opts.movingSpeedMps ?? 0.5;
  const samples = canonicalSamples(rawSamples);
  const usable = samples.filter((s) => isUsable(s));
  const startEvent = events.find((e) => e.kind === 'start');
  const finishEvent = [...events].reverse().find((e) => e.kind === 'finish');
  const firstT = startEvent?.t ?? samples[0]?.t ?? 0;
  const lastT = finishEvent?.t ?? samples[samples.length - 1]?.t ?? firstT;
  const pauses = pausedIntervals(events, lastT);
  const pausedMs = pauses.reduce((acc, p) => acc + (p.endT - p.startT), 0);
  const gaps = findGaps(usable, maxGap);

  let distance = 0;
  let moving = 0;
  let elevationGain = 0;
  let haveElevation = false;
  const splits: Split[] = [];
  let splitStartT = firstT;
  let splitDistance = 0;
  let splitHasGap = false;

  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1]!;
    const b = usable[i]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    if (dt > maxGap || inAnyInterval(b.t, pauses)) {
      splitHasGap = true;
      continue;
    }
    const d = haversineMeters(a, b);
    distance += d;
    if (d / dt >= movingSpeed) moving += dt * 1000;
    if (a.alt != null && b.alt != null && (a.altAcc ?? 0) <= 10 && (b.altAcc ?? 0) <= 10) {
      haveElevation = true;
      const climb = b.alt - a.alt;
      if (climb > 0.5) elevationGain += climb;
    }
    splitDistance += d;
    while (splitDistance >= splitMeters) {
      const over = splitDistance - splitMeters;
      const frac = d > 0 ? (d - over) / d : 1;
      const tAtBoundary = a.t + frac * (b.t - a.t);
      splits.push({ index: splits.length, distanceM: splitMeters, elapsedMs: Math.round(tAtBoundary - splitStartT), containsGap: splitHasGap });
      splitStartT = tAtBoundary;
      splitDistance = over;
      splitHasGap = false;
    }
  }
  if (splitDistance > 1) {
    splits.push({ index: splits.length, distanceM: Math.round(splitDistance * 10) / 10, elapsedMs: Math.round(lastT - splitStartT), containsGap: splitHasGap });
  }
  const elapsedMs = Math.max(0, lastT - firstT);
  return {
    distanceM: Math.round(distance * 10) / 10,
    elapsedMs,
    movingMs: Math.round(moving),
    avgPaceSecPerKm: distance > 50 ? Math.round((elapsedMs - pausedMs) / 1000 / (distance / 1000)) : null,
    splits,
    gaps,
    pausedMs,
    sampleCount: samples.length,
    usableSampleCount: usable.length,
    elevationGainM: haveElevation ? Math.round(elevationGain) : null
  };
}

/** Canonical serialisation used for evidence digests (stable across platforms). */
export function serializeSamples(samples: readonly LocationSample[]): string {
  return canonicalSamples(samples)
    .map((s) =>
      [
        s.seq,
        s.t,
        s.mono ?? '',
        s.lat.toFixed(7),
        s.lng.toFixed(7),
        s.acc ?? '',
        s.alt != null ? s.alt.toFixed(1) : '',
        s.altAcc ?? '',
        s.spd != null ? s.spd.toFixed(2) : '',
        s.hdg != null ? s.hdg.toFixed(1) : '',
        s.mocked ? 1 : 0
      ].join(',')
    )
    .join('\n');
}

export function parseSerializedSamples(text: string): LocationSample[] {
  if (!text.trim()) return [];
  return text.split('\n').map((line) => {
    const [seq, t, mono, lat, lng, acc, alt, altAcc, spd, hdg, mocked] = line.split(',');
    const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
    return {
      seq: Number(seq),
      t: Number(t),
      mono: num(mono),
      lat: Number(lat),
      lng: Number(lng),
      acc: num(acc),
      alt: num(alt),
      altAcc: num(altAcc),
      spd: num(spd),
      hdg: num(hdg),
      mocked: mocked === '1'
    };
  });
}

/** SHA-256 hex digest using WebCrypto (available in Node 22, Deno and Hermes via expo-crypto shim). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
