import { describe, expect, it } from 'vitest';
import {
  alongMeters,
  buildCourse,
  buildReplay,
  destination,
  evaluateSpeedAttempt,
  evaluateStretch,
  haversineMeters,
  isLoopShape,
  isUsable,
  locateStretch,
  pathLengthMeters,
  pointAlongLine,
  replayAt,
  replayZoom,
  simplify,
  sliceLine,
  stretchAttemptEvents,
  type LatLng,
  type LocationSample,
  type RecordingEvent,
  type Split
} from '../src/index.ts';
import { circlePath, ORIGIN, outAndBackPath, samplePath, T0 } from './fixtures.ts';

const east = (m: number, from: LatLng = ORIGIN) => destination(from, m, 90);
/** The run's own line as the server stores it: its usable fixes, simplified at 5 m. */
const lineOf = (samples: readonly LocationSample[]) => simplify(samples.filter((s) => isUsable(s)), 5);
const startEvents = (samples: readonly LocationSample[], extra: RecordingEvent[] = []): RecordingEvent[] => [
  { kind: 'start', t: samples[0]!.t - 1000, afterSeq: -1 },
  ...extra,
  { kind: 'finish', t: samples[samples.length - 1]!.t + 1000, afterSeq: samples[samples.length - 1]!.seq }
];
/** Distance run by the fix at `index`. */
const ranAt = (samples: readonly LocationSample[], index: number) => alongMeters(samples)[index]!;

describe('lines', () => {
  it('finds a point along a line and cuts a part of it', () => {
    const line = [ORIGIN, east(1000), east(2000)];
    expect(haversineMeters(pointAlongLine(line, 500), ORIGIN)).toBeCloseTo(500, 0);
    expect(pointAlongLine(line, -10)).toEqual(ORIGIN);
    expect(pointAlongLine(line, 5000)).toEqual(line[2]);
    const part = sliceLine(line, 500, 1500);
    expect(pathLengthMeters(part)).toBeCloseTo(1000, 0);
    expect(part).toHaveLength(3);
    expect(sliceLine(line, 1500, 500)).toEqual([]);
  });

  it('tells a loop from a start-to-finish route by how far apart the ends are', () => {
    expect(isLoopShape(circlePath(ORIGIN, 300))).toBe(true);
    expect(isLoopShape([ORIGIN, east(1000)])).toBe(false);
    expect(isLoopShape([ORIGIN, east(1000), east(25)], 20)).toBe(true);
  });
});

describe('part of a run', () => {
  // Out 3 km and back along the same street: every place on it is passed twice.
  const outBack = samplePath(outAndBackPath(ORIGIN, 3000, 90));
  const outBackLine = lineOf(outBack);

  it('finds each end at the right pass, to within one fix', () => {
    const going = locateStretch(outBack, outBackLine, 1000, 2000)!;
    expect(Math.abs(ranAt(outBack, going.startIndex) - 1000)).toBeLessThanOrEqual(3.5);
    expect(Math.abs(ranAt(outBack, going.endIndex) - 2000)).toBeLessThanOrEqual(3.5);
    const coming = locateStretch(outBack, outBackLine, 4000, 5000)!;
    expect(Math.abs(ranAt(outBack, coming.startIndex) - 4000)).toBeLessThanOrEqual(3.5);
    expect(Math.abs(ranAt(outBack, coming.endIndex) - 5000)).toBeLessThanOrEqual(3.5);
    // The same places, two different passes.
    expect(haversineMeters(outBack[going.startIndex]!, outBack[coming.endIndex]!)).toBeLessThan(5);
  });

  it('cannot place a part outside the run or the wrong way round', () => {
    expect(locateStretch(outBack, outBackLine, 7000, 8000)).toBeNull();
    expect(locateStretch(outBack, outBackLine, 2000, 1000)).toBeNull();
    expect(locateStretch(outBack, [ORIGIN], 0, 1000)).toBeNull();
  });

  it('checks a clean part like a whole run, without land\'s shape rules', () => {
    const s = evaluateStretch(outBack, startEvents(outBack), outBackLine, 1000, 2500);
    expect(s.found).toBe(true);
    expect(s.blocking).toEqual([]);
    expect(s.closed).toBe(false);
    expect(pathLengthMeters(s.trace)).toBeCloseTo(1500, -1);
    expect(s.endT! - s.startT!).toBeCloseTo(500_000, -4);
  });

  // Running west: 600 m to the park, once round a 2.5 km lap of it, then 600 m on.
  const park = east(1200);
  const lapPath = circlePath(destination(park, 400, 0), 400, 120, true, 180);
  const lap = pathLengthMeters(lapPath);
  const parkRun = samplePath([destination(park, 600, 90), ...lapPath, destination(park, 600, 270)]);
  const parkLine = lineOf(parkRun);

  it('recognises a loop inside a longer run', () => {
    const s = evaluateStretch(parkRun, startEvents(parkRun), parkLine, 600, 600 + lap);
    expect(s.found).toBe(true);
    expect(s.blocking).toEqual([]);
    expect(s.closed).toBe(true);
    expect(isLoopShape(sliceLine(parkLine, 600, 600 + lap))).toBe(true);
    expect(Math.abs(pathLengthMeters(s.trace) - lap)).toBeLessThan(15); // one fix (3 m) either end, and the fixes cut corners less
  });

  it('times a founding run over just the part', () => {
    const part = evaluateStretch(parkRun, startEvents(parkRun), parkLine, 600, 600 + lap);
    const course = buildCourse(part.trace, { closed: true });
    // Without a window the whole run would be searched from its start, where no speed window was ever opened.
    expect(evaluateSpeedAttempt(parkRun, startEvents(parkRun), course).reasons).toContain('interval_missing');
    const events = stretchAttemptEvents(parkRun, startEvents(parkRun), parkLine, 600, 600 + lap)!;
    const r = evaluateSpeedAttempt(parkRun, events, course);
    expect(r.reasons).toEqual([]);
    expect(r.decision).toBe('eligible');
    expect(r.elapsedMs! / 1000).toBeCloseTo(lap / 3, -1);
    expect(stretchAttemptEvents(parkRun, startEvents(parkRun), parkLine, 9000, 9500)).toBeNull();
  });

  it('blocks a part with a pause, a gap or mock locations in it, and only that part', () => {
    const pausedAt = outBack[400]!;
    const pause: RecordingEvent[] = [
      { kind: 'pause', t: pausedAt.t + 200, afterSeq: pausedAt.seq },
      { kind: 'resume', t: pausedAt.t + 800, afterSeq: pausedAt.seq }
    ];
    expect(evaluateStretch(outBack, startEvents(outBack, pause), outBackLine, 1000, 2000).blocking).toContain('paused_interval');
    expect(evaluateStretch(outBack, startEvents(outBack, pause), outBackLine, 2000, 3500).blocking).not.toContain('paused_interval');

    const gappy = samplePath(outAndBackPath(ORIGIN, 3000, 90), { gap: [400, 430] });
    const gappyLine = lineOf(gappy);
    expect(evaluateStretch(gappy, startEvents(gappy), gappyLine, 1000, 1500).blocking).toContain('recording_gap');
    expect(evaluateStretch(gappy, startEvents(gappy), gappyLine, 2000, 3000).blocking).toEqual([]);

    const mocked = outBack.map((f, i) => (i > 350 && i < 380 ? { ...f, mocked: true } : f));
    expect(evaluateStretch(mocked, startEvents(mocked), outBackLine, 1000, 1500).blocking).toContain('mock_location');
  });

  it('ignores the run\'s own capture interval: the part is what is checked', () => {
    const lastFix = outBack[outBack.length - 1]!;
    const events = startEvents(outBack, [
      { kind: 'capture_start', t: outBack[0]!.t, afterSeq: -1 },
      { kind: 'capture_end', t: lastFix.t, afterSeq: lastFix.seq }
    ]);
    const s = evaluateStretch(outBack, events, outBackLine, 4500, 5500);
    expect(s.found).toBe(true);
    expect(s.startT).toBeGreaterThan(outBack[0]!.t + 1_000_000);
  });

  it('does not find a part on a run with no usable fixes there', () => {
    expect(evaluateStretch(outBack, startEvents(outBack), outBackLine, 6500, 9000)).toMatchObject({ found: false, trace: [] });
  });
});

describe('replay', () => {
  const split = (seconds: number, metres = 1000, gap = false): Split => ({ index: 0, distanceM: metres, elapsedMs: seconds * 1000, containsGap: gap });

  it('takes about 20 seconds whatever the length, from the start to the finish', () => {
    for (const km of [1, 5, 42.2]) {
      const line = [ORIGIN, east(km * 1000)];
      const plan = buildReplay(line, [])!;
      expect(plan.durationMs).toBe(20_000);
      expect(plan.frames).toHaveLength(41);
      expect(plan.frames[0]!.center).toEqual(ORIGIN);
      expect(haversineMeters(plan.frames[40]!.center, line[1]!)).toBeLessThan(1);
    }
    expect(replayZoom(1000)).toBe(16.5);
    expect(replayZoom(42_195)).toBe(12.5);
    expect(replayZoom(10_000)).toBeGreaterThan(replayZoom(21_100));
  });

  it('points the camera along the run, and turns at the far end of an out-and-back', () => {
    const plan = buildReplay([ORIGIN, east(3000)], [])!;
    expect(plan.frames[20]!.headingDeg).toBeCloseTo(90, 0);
    const back = buildReplay(outAndBackPath(ORIGIN, 3000, 45), [])!;
    expect(back.frames[5]!.headingDeg).toBeCloseTo(45, 0);
    expect(back.frames[35]!.headingDeg).toBeCloseTo(225, 0);
  });

  it('shades each kilometre by its pace, darker for faster, with no shade where a pause or gap was', () => {
    const line = [ORIGIN, east(4100)];
    const plan = buildReplay(line, [split(300), split(280), split(320), split(310, 1000, true), split(40, 100)])!;
    expect(plan.stretches.map((s) => s.shade)).toEqual([2, 4, 0, null, null]);
    expect(plan.stretches.map((s) => s.paceSecPerKm)).toEqual([300, 280, 320, null, null]);
    expect(pathLengthMeters(plan.stretches[0]!.line)).toBeCloseTo(1000, -1);
    expect(haversineMeters(plan.stretches[4]!.line.at(-1)!, line[1]!)).toBeLessThan(1);
    const even = buildReplay(line, [split(300), split(300)])!;
    expect(even.stretches.map((s) => s.shade)).toEqual([2, 2]);
  });

  it('marks every kilometre, or every mile', () => {
    const plan = buildReplay([ORIGIN, east(5200)], [split(300), split(300), split(300), split(300), split(300), split(60, 200)])!;
    expect(plan.markers.map((m) => m.label)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.markers[0]!.distanceM).toBeCloseTo(1000, -1);
    const miles = buildReplay([ORIGIN, east(5200)], [], { markerEveryM: 1609.344 })!;
    expect(miles.markers.map((m) => m.label)).toEqual([1, 2, 3]);
    expect(buildReplay([ORIGIN, east(5000)], [])!.markers).toHaveLength(4);
  });

  it('can be dragged to any moment, turning the short way round', () => {
    const plan = buildReplay([ORIGIN, east(2000)], [])!;
    const mid = replayAt(plan, 250);
    expect(mid.distanceM).toBeCloseTo((plan.frames[0]!.distanceM + plan.frames[1]!.distanceM) / 2, 3);
    expect(replayAt(plan, 99_999).distanceM).toBeCloseTo(2000, 0);
    const turning = { ...plan, frames: [{ ...plan.frames[0]!, atMs: 0, headingDeg: 350 }, { ...plan.frames[1]!, atMs: 500, headingDeg: 10 }], durationMs: 500 };
    expect(replayAt(turning, 250).headingDeg).toBeCloseTo(0, 5);
  });

  it('needs a line', () => {
    expect(buildReplay([], [])).toBeNull();
    expect(buildReplay([ORIGIN, ORIGIN], [])).toBeNull();
    expect(T0).toBeGreaterThan(0);
  });
});
