import type { Vec2 } from '@/lib/hex';
import { beats, clubLoop, clubOffsets, HERO_GAP_AT, heroLoop, loopA, rivalLoop, route, track, type Track } from '@/story/world';
import { palette, territory } from '@/theme/brand';

/**
 * Runners on the field: who runs which path, when, and in what colour. The camera reads the same timings, so the
 * chase shots follow the dot exactly.
 */
export interface ActorSpec {
  id: string;
  track: Track;
  /** Height of the line above the ground. */
  y: number;
  clock: 'intro' | 'story';
  run: readonly [number, number];
  close?: readonly [number, number];
  /** Share of the path covered while running; the rest is the closing gap. */
  openFraction: number;
  gradient?: readonly [string, string];
  solid?: string;
  closing?: string;
  dot: string;
  width: number;
  /** Story range in which the trail exists at all. */
  visible: readonly [number, number];
  /** Story range in which the dot shows. */
  dotVisible: readonly [number, number];
  restOpacity: number;
  loop: boolean;
}

/** Shift a closed path sideways, so club mates run side by side. */
function offsetPath(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;
    const tx = next[0] - prev[0];
    const tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz) || 1;
    return [p[0] - (tz / len) * d, p[1] + (tx / len) * d] as Vec2;
  });
}

const closeLoop = (pts: Vec2[]): Vec2[] => [...pts, pts[0]!];

const fade = beats.privacy.fade[1];

export const actors: ActorSpec[] = [
  {
    id: 'hero',
    track: track(heroLoop),
    y: 0.62,
    clock: 'intro',
    run: [0, beats.hero.closeAt],
    close: [beats.hero.closeAt, beats.hero.claimAt],
    openFraction: HERO_GAP_AT,
    gradient: [territory.pathStart, territory.path],
    closing: territory.closing,
    dot: palette.orange,
    width: 4.5,
    visible: [0, fade],
    dotVisible: [0, 1.12],
    restOpacity: 0.75,
    loop: true
  },
  {
    id: 'loopA',
    track: track(closeLoop(loopA)),
    y: 0.62,
    clock: 'story',
    run: beats.how.run,
    close: beats.how.close,
    openFraction: 0.92,
    gradient: [territory.pathStart, territory.path],
    closing: territory.closing,
    dot: palette.orange,
    width: 4.5,
    visible: [1.1, fade],
    dotVisible: [1.16, 1.78],
    restOpacity: 0.6,
    loop: true
  },
  {
    id: 'rival',
    track: track(closeLoop(rivalLoop)),
    y: 0.66,
    clock: 'story',
    run: beats.rivals.run,
    close: beats.rivals.close,
    openFraction: 0.92,
    solid: territory.rivalHues[0],
    dot: territory.rivalHues[0],
    width: 4,
    visible: [3.06, fade],
    dotVisible: [3.08, 3.62],
    restOpacity: 0.5,
    loop: true
  },
  {
    id: 'route',
    track: track(route),
    y: 0.12,
    clock: 'story',
    run: beats.titles.run,
    openFraction: 1,
    solid: territory.route,
    dot: palette.orange,
    width: 5,
    visible: [4.02, fade],
    dotVisible: [4.14, 4.86],
    restOpacity: 0.9,
    loop: false
  },
  ...clubOffsets.map(
    (d, i): ActorSpec => ({
      id: `club-${i}`,
      track: track(closeLoop(offsetPath(clubLoop, d))),
      y: 0.6 + i * 0.01,
      clock: 'story',
      run: [beats.clubs.run[0] + i * 0.006, beats.clubs.run[1]],
      close: beats.clubs.close,
      openFraction: 0.92,
      solid: i === 2 ? territory.path : palette.blueText,
      dot: i === 2 ? palette.orange : palette.blueText,
      width: i === 2 ? 4 : 3,
      visible: [5.06, fade],
      dotVisible: [5.1, 5.72],
      restOpacity: 0.45,
      loop: true
    })
  )
];

/** How far along its path an actor is, 0–1, for the given clock value. */
export function actorFraction(spec: ActorSpec, clock: number): number {
  const [r0, r1] = spec.run;
  if (clock <= r0) return 0;
  if (clock < r1) return spec.openFraction * ((clock - r0) / (r1 - r0));
  if (!spec.close) return 1;
  const [c0, c1] = spec.close;
  if (clock < c0) return spec.openFraction;
  if (clock < c1) return spec.openFraction + (1 - spec.openFraction) * ((clock - c0) / (c1 - c0));
  return 1;
}

export const actorById = (id: string) => actors.find((a) => a.id === id)!;
