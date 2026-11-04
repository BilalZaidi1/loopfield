import { destination, haversineMeters, type LatLng } from '../src/geo/geo.ts';
import type { LocationSample, RecordingEvent } from '../src/recording/types.ts';

/** Karachi-area origin used purely as a neutral synthetic fixture location. */
export const ORIGIN: LatLng = { lat: 24.8607, lng: 67.0011 };
export const T0 = Date.UTC(2026, 10, 2, 6, 0, 0);

export interface TraceOptions {
  speedMps?: number;
  intervalS?: number;
  accuracyM?: number;
  startT?: number;
  mocked?: boolean;
  /** Seconds at which to drop fixes (simulated gap): [fromS, toS). */
  gap?: [number, number];
}

/** Sample an arbitrary path at a constant speed, one fix every intervalS seconds. */
export function samplePath(path: readonly LatLng[], opts: TraceOptions = {}, seqStart = 0): LocationSample[] {
  const speed = opts.speedMps ?? 3;
  const interval = opts.intervalS ?? 1;
  const acc = opts.accuracyM ?? 5;
  const startT = opts.startT ?? T0;
  const out: LocationSample[] = [];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineMeters(path[i - 1]!, path[i]!);
    segLens.push(d);
    total += d;
  }
  const duration = total / speed;
  let seq = seqStart;
  for (let tS = 0; tS <= duration + 1e-9; tS += interval) {
    if (opts.gap && tS >= opts.gap[0] && tS < opts.gap[1]) continue;
    let dist = Math.min(total, tS * speed);
    let i = 0;
    while (i < segLens.length && dist > segLens[i]!) {
      dist -= segLens[i]!;
      i++;
    }
    const a = path[Math.min(i, path.length - 1)]!;
    const b = path[Math.min(i + 1, path.length - 1)]!;
    const segLen = segLens[i] ?? 0;
    const f = segLen > 0 ? dist / segLen : 0;
    out.push({
      seq: seq++,
      t: Math.round(startT + tS * 1000),
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      acc,
      mocked: opts.mocked ?? false
    });
  }
  // Ensure the final point of the path is present (exact closure for loops).
  const last = path[path.length - 1]!;
  const lastT = Math.round(startT + duration * 1000);
  if (out.length && out[out.length - 1]!.t < lastT && !(opts.gap && duration >= opts.gap[0] && duration < opts.gap[1])) {
    out.push({ seq: seq++, t: lastT, lat: last.lat, lng: last.lng, acc, mocked: opts.mocked ?? false });
  }
  return out;
}

export function circlePath(center: LatLng, radiusM: number, points = 120, clockwise = true, startBearing = 0): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i <= points; i++) {
    const b = startBearing + (clockwise ? 1 : -1) * (360 * i) / points;
    out.push(destination(center, radiusM, b));
  }
  return out;
}

export function rectanglePath(sw: LatLng, widthM: number, heightM: number): LatLng[] {
  const se = destination(sw, widthM, 90);
  const ne = destination(se, heightM, 0);
  const nw = destination(sw, heightM, 0);
  return [sw, nw, ne, se, sw];
}

export function outAndBackPath(start: LatLng, lengthM: number, bearing = 45): LatLng[] {
  const end = destination(start, lengthM, bearing);
  return [start, end, start];
}

export function figureEightPath(center: LatLng, radiusM: number): LatLng[] {
  const top = destination(center, radiusM, 0);
  const bottom = destination(center, radiusM, 180);
  const upper = circlePath(top, radiusM, 60, true, 180);
  const lower = circlePath(bottom, radiusM, 60, false, 0);
  return [...upper, ...lower];
}

export function loopEvents(samples: readonly LocationSample[], extra: RecordingEvent[] = []): RecordingEvent[] {
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return [
    { kind: 'start', t: first.t - 1000, afterSeq: -1 },
    { kind: 'capture_start', t: first.t - 500, afterSeq: -1 },
    ...extra,
    { kind: 'capture_end', t: last.t + 500, afterSeq: last.seq },
    { kind: 'finish', t: last.t + 1000, afterSeq: last.seq }
  ];
}

export function speedEvents(samples: readonly LocationSample[]): RecordingEvent[] {
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return [
    { kind: 'start', t: first.t - 1000, afterSeq: -1 },
    { kind: 'speed_start', t: first.t - 500, afterSeq: -1 },
    { kind: 'finish', t: last.t + 1000, afterSeq: last.seq }
  ];
}
