import { bearingDegrees, type LatLng } from '../geo/geo.ts';
import { alongMeters, pointAlongLine, sliceLine } from '../speed/stretch.ts';
import type { Split } from './summary.ts';

/**
 * 3D replay of the runner's own run, worked out entirely on the phone from the run's line and splits:
 * the camera follows the line in about 20 seconds whatever its length, the line is shaded by each
 * kilometre's pace (one hue, lighter = slower) and every kilometre (or mile) is marked.
 */
export const REPLAY_RULES = {
  durationMs: 20_000,
  stepMs: 500,
  /** The camera's heading looks this far behind and ahead (a share of the run, within the bounds) so turns stay smooth. */
  lookShare: 0.02,
  minLookM: 60,
  maxLookM: 400,
  /** Frames either side averaged into each heading. */
  headingSmoothing: 2,
  pitch: 60,
  /** Pace shades, from slowest (0) to fastest. */
  shades: 5,
  /** Splits shorter than this (the last few metres) have no meaningful pace. */
  minSplitM: 200
} as const;

export interface ReplayFrame {
  atMs: number;
  /** Along the run's line. */
  distanceM: number;
  center: LatLng;
  /** Compass heading of the camera, 0–360. */
  headingDeg: number;
}

export interface ReplayStretch {
  index: number;
  line: LatLng[];
  /** Null for a split with a pause or gap in it, or too short to say. */
  paceSecPerKm: number | null;
  /** 0 (slowest) to shades − 1 (fastest); null with no pace. */
  shade: number | null;
}

export interface ReplayMarker {
  /** 1 for the first kilometre (or mile), and so on. */
  label: number;
  point: LatLng;
  distanceM: number;
}

export interface ReplayPlan {
  durationMs: number;
  stepMs: number;
  lengthM: number;
  zoom: number;
  pitch: number;
  frames: ReplayFrame[];
  stretches: ReplayStretch[];
  markers: ReplayMarker[];
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Circular mean of headings (vector average), robust across north. */
function meanHeading(values: readonly number[]): number | null {
  let x = 0;
  let y = 0;
  for (const v of values) {
    x += Math.sin(rad(v));
    y += Math.cos(rad(v));
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  return norm((Math.atan2(x, y) * 180) / Math.PI);
}

/** Zoom that keeps the camera's speed over the ground watchable: closer for short runs, further out for long ones. */
export function replayZoom(lengthM: number): number {
  const z = 16.5 - 0.8 * Math.log2(Math.max(lengthM, 1000) / 1000);
  return Math.round(Math.min(16.5, Math.max(12.5, z)) * 10) / 10;
}

export function buildReplay(
  route: readonly LatLng[],
  splits: readonly Split[],
  opts: { durationMs?: number; stepMs?: number; markerEveryM?: number } = {}
): ReplayPlan | null {
  if (route.length < 2) return null;
  const along = alongMeters(route);
  const lengthM = along[along.length - 1]!;
  if (!(lengthM > 0)) return null;
  const durationMs = opts.durationMs ?? REPLAY_RULES.durationMs;
  const stepMs = opts.stepMs ?? REPLAY_RULES.stepMs;
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  const look = Math.min(REPLAY_RULES.maxLookM, Math.max(REPLAY_RULES.minLookM, lengthM * REPLAY_RULES.lookShare));

  const raw: { distanceM: number; center: LatLng; heading: number | null }[] = [];
  for (let k = 0; k <= steps; k++) {
    const d = (lengthM * k) / steps;
    const behind = pointAlongLine(route, Math.max(0, d - look), along);
    const ahead = pointAlongLine(route, Math.min(lengthM, d + look), along);
    const same = behind.lat === ahead.lat && behind.lng === ahead.lng;
    raw.push({ distanceM: d, center: pointAlongLine(route, d, along), heading: same ? null : bearingDegrees(behind, ahead) });
  }
  // Fill headings the line could not give (a standstill) from the nearest frame that has one.
  const known = raw.findIndex((f) => f.heading !== null);
  let last = known >= 0 ? raw[known]!.heading! : 0;
  for (const f of raw) {
    if (f.heading === null) f.heading = last;
    else last = f.heading;
  }
  const w = REPLAY_RULES.headingSmoothing;
  const frames: ReplayFrame[] = raw.map((f, k) => {
    const near = raw.slice(Math.max(0, k - w), Math.min(raw.length, k + w + 1)).map((n) => n.heading!);
    return { atMs: k * stepMs, distanceM: Math.round(f.distanceM * 10) / 10, center: f.center, headingDeg: Math.round((meanHeading(near) ?? f.heading!) * 10) / 10 };
  });

  // Splits are measured on the run's fixes; their share of the run places them on the (slightly shorter or longer) line.
  const splitTotal = splits.reduce((s, x) => s + x.distanceM, 0);
  const scale = splitTotal > 0 ? lengthM / splitTotal : 1;
  const paced = splits.map((s) => (s.containsGap || s.distanceM < REPLAY_RULES.minSplitM || s.elapsedMs <= 0 ? null : s.elapsedMs / s.distanceM));
  const valid = paced.filter((x): x is number => x !== null);
  const fastest = valid.length ? Math.min(...valid) : 0;
  const slowest = valid.length ? Math.max(...valid) : 0;
  const top = REPLAY_RULES.shades - 1;
  const stretches: ReplayStretch[] = [];
  let at = 0;
  splits.forEach((s, i) => {
    const from = at * scale;
    at += s.distanceM;
    const to = i === splits.length - 1 ? lengthM : at * scale;
    const line = sliceLine(route, from, to);
    if (line.length < 2) return;
    const pace = paced[i] ?? null;
    const shade = pace === null ? null : slowest === fastest ? Math.round(top / 2) : Math.round(((slowest - pace) / (slowest - fastest)) * top);
    stretches.push({ index: i, line, paceSecPerKm: pace === null ? null : Math.round(pace), shade });
  });
  if (!stretches.length) stretches.push({ index: 0, line: [...route], paceSecPerKm: null, shade: null });

  const every = opts.markerEveryM ?? 1000;
  const runM = splitTotal > 0 ? splitTotal : lengthM;
  const markers: ReplayMarker[] = [];
  // No marker right on top of the finish.
  for (let k = 1; k * every < runM - 50; k++) {
    const d = ((k * every) / runM) * lengthM;
    markers.push({ label: k, point: pointAlongLine(route, d, along), distanceM: Math.round(d) });
  }
  return { durationMs: steps * stepMs, stepMs, lengthM: Math.round(lengthM), zoom: replayZoom(lengthM), pitch: REPLAY_RULES.pitch, frames, stretches, markers };
}

/** Where the replay is at a moment (for dragging): position and heading between the two nearest frames. */
export function replayAt(plan: ReplayPlan, atMs: number): ReplayFrame {
  const frames = plan.frames;
  const t = Math.min(plan.durationMs, Math.max(0, atMs));
  const i = Math.min(frames.length - 2, Math.floor(t / plan.stepMs));
  if (i < 0) return frames[0]!;
  const a = frames[i]!;
  const b = frames[i + 1]!;
  const f = (t - a.atMs) / (b.atMs - a.atMs || 1);
  const turn = ((b.headingDeg - a.headingDeg + 540) % 360) - 180;
  return {
    atMs: t,
    distanceM: a.distanceM + (b.distanceM - a.distanceM) * f,
    center: { lat: a.center.lat + (b.center.lat - a.center.lat) * f, lng: a.center.lng + (b.center.lng - a.center.lng) * f },
    headingDeg: norm(a.headingDeg + turn * f)
  };
}
