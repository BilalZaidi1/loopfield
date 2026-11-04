import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo/geo.ts';
import { buildCourse, isDuplicateCourse } from '../src/speed/course.ts';
import { evaluateSpeedAttempt } from '../src/speed/match.ts';
import { replayTitle, requiredMarginMs, requiredTimeMs, formatDuration, type TitleAttempt } from '../src/speed/titles.ts';
import { circlePath, ORIGIN, samplePath, speedEvents } from './fixtures.ts';

const COURSE_PATH = circlePath(ORIGIN, 250, 180);
const course = buildCourse(COURSE_PATH, { closed: true });

/** Attempt path: a short approach, the course, and a short run-out past the gate. */
function attemptPath(path = COURSE_PATH) {
  const approach = destination(path[0]!, 40, 270); // 40 m before the gate (runner heads east at the start)
  const runout = path.slice(1, 8);
  return [approach, ...path, ...runout];
}

describe('speed attempt matching', () => {
  it('times a full traversal gate-to-gate', () => {
    const s = samplePath(attemptPath(), { speedMps: 3.5 });
    const r = evaluateSpeedAttempt(s, speedEvents(s), course);
    expect(r.reasons).toEqual([]);
    expect(r.decision).toBe('eligible');
    const expected = (course.lengthM / 3.5) * 1000;
    expect(Math.abs(r.elapsedMs! - expected)).toBeLessThan(4000);
    expect(r.uncertaintyMs).toBeLessThanOrEqual(3000);
    expect(r.coverage).toBeGreaterThanOrEqual(0.95);
  });

  it('rejects the wrong direction', () => {
    const reversed = [...COURSE_PATH].reverse();
    const s = samplePath(attemptPath(reversed));
    const r = evaluateSpeedAttempt(s, speedEvents(s), course);
    expect(r.decision).not.toBe('eligible');
    expect(r.reasons).toContain('wrong_direction');
  });

  it('does not count loitering near the start as a completed lap', () => {
    const near = [COURSE_PATH[0]!, COURSE_PATH[3]!, COURSE_PATH[0]!, COURSE_PATH[3]!, COURSE_PATH[0]!];
    const s = samplePath([destination(COURSE_PATH[0]!, 40, 270), ...near]);
    const r = evaluateSpeedAttempt(s, speedEvents(s), course);
    expect(r.decision).not.toBe('eligible');
    expect(r.reasons.some((x) => x === 'finish_not_crossed' || x === 'missed_checkpoint')).toBe(true);
  });

  it('rejects a shortcut across the course', () => {
    const half = COURSE_PATH.slice(0, 60);
    const s = samplePath(attemptPath([...half, COURSE_PATH[0]!]));
    const r = evaluateSpeedAttempt(s, speedEvents(s), course);
    expect(r.decision).not.toBe('eligible');
    expect(r.reasons).toContain('missed_checkpoint');
  });

  it('withholds results when gate fixes are too sparse', () => {
    const s = samplePath(attemptPath(), { intervalS: 5 });
    const r = evaluateSpeedAttempt(s, speedEvents(s), course);
    expect(r.reasons).toContain('gate_fix_spacing');
    expect(r.reasons).toContain('timing_uncertainty');
    expect(r.decision).toBe('unranked');
  });

  it('detects materially duplicate routes in the same direction only', () => {
    const shifted = buildCourse(circlePath(destination(ORIGIN, 8, 45), 252, 150), { closed: true });
    expect(isDuplicateCourse(course, shifted)).toBe(true);
    const reversed = buildCourse([...COURSE_PATH].reverse(), { closed: true });
    expect(isDuplicateCourse(course, reversed)).toBe(false);
  });
});

describe('speed title margin and replay (FR14, Appendix A)', () => {
  const att = (id: string, userId: string, hour: number, seconds: number, unc = 1000): TitleAttempt => ({
    id,
    userId,
    completedAt: Date.UTC(2026, 10, 2, hour),
    elapsedMs: seconds * 1000,
    uncertaintyMs: unc
  });

  it('needs 10:53.4 or faster to beat an 11:00 benchmark', () => {
    expect(requiredMarginMs(660_000, 1000, 1000)).toBe(6600);
    expect(requiredTimeMs(660_000, 1000, 1000)).toBe(653_400);
    expect(formatDuration(653_400)).toBe('10:53.4');
  });

  it('keeps the champion on a near tie and changes it on a clear win', () => {
    const near = replayTitle([att('a', 'A', 9, 660), att('b', 'B', 10, 655)]);
    expect(near.championId).toBe('A');
    expect(near.events[1]!.kind).toBe('near_tie');
    const win = replayTitle([att('a', 'A', 9, 660), att('c', 'C', 10, 650)]);
    expect(win.championId).toBe('C');
    expect(win.benchmarkMs).toBe(650_000);
  });

  it('is independent of upload order', () => {
    const attempts = [att('a', 'A', 9, 660), att('b', 'B', 10, 655), att('c', 'C', 11, 650)];
    const forward = replayTitle(attempts);
    const reversed = replayTitle([...attempts].reverse());
    expect(forward.championId).toBe('C');
    expect(reversed.championId).toBe('C');
    expect(reversed.events.map((e) => e.kind)).toEqual(forward.events.map((e) => e.kind));
  });

  it('replays after invalidation exactly as Appendix A describes', () => {
    // A invalidated: B becomes first champion at 655; C (650) is within 1% of 655 => B retains.
    const r = replayTitle([att('b', 'B', 10, 655), att('c', 'C', 11, 650)]);
    expect(r.championId).toBe('B');
    expect(r.events[1]!.kind).toBe('near_tie');
  });

  it('updates the benchmark only on a margin-beating improvement by the champion', () => {
    const r = replayTitle([att('a1', 'A', 9, 660), att('a2', 'A', 10, 657), att('a3', 'A', 11, 650)]);
    expect(r.events.map((e) => e.kind)).toEqual(['initial', 'champion_no_improvement', 'improvement']);
    expect(r.benchmarkMs).toBe(650_000);
  });

  it('widens the margin when combined timing uncertainty is larger', () => {
    // Benchmark 300 s: 1% = 3 s, min 5 s; uncertainties 2.9 s + 2.9 s = 5.8 s => 5.8 s margin.
    expect(requiredMarginMs(300_000, 2900, 2900)).toBe(5800);
  });
});
