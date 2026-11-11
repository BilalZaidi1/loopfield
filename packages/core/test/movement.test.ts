import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo/geo.ts';
import { achievementScore, evaluateMovement, pointsForDistance, quoteReclaim, reclaimCostPerCell } from '../src/movement/points.ts';
import type { LocationSample, RecordingEvent } from '../src/recording/types.ts';
import { ORIGIN, T0, samplePath } from './fixtures.ts';

const line = (lengthM: number, bearing = 90, from = ORIGIN) => [from, destination(from, lengthM, bearing)];
const runEvents = (s: readonly LocationSample[], extra: RecordingEvent[] = []): RecordingEvent[] => [
  { kind: 'start', t: s[0]!.t, afterSeq: -1 },
  ...extra,
  { kind: 'finish', t: s[s.length - 1]!.t, afterSeq: s[s.length - 1]!.seq }
];

describe('movement points: verified distance', () => {
  it('counts an honest 2 km run at running pace', () => {
    const s = samplePath(line(2000), { speedMps: 3 });
    const r = evaluateMovement(s, runEvents(s));
    expect(r.decision).toBe('eligible');
    expect(r.reasons).toEqual([]);
    expect(r.verifiedDistanceM).toBeGreaterThan(1990);
    expect(r.verifiedDistanceM).toBeLessThan(2010);
    expect(pointsForDistance(r.verifiedDistanceM)).toBe(Math.floor(r.verifiedDistanceM / 100));
  });

  it('voids the whole run when any location is mocked', () => {
    const s = samplePath(line(3000), { speedMps: 3, mocked: true });
    const r = evaluateMovement(s, runEvents(s));
    expect(r).toMatchObject({ decision: 'invalid', reasons: ['mock_location'], verifiedDistanceM: 0 });
  });

  it('never bridges a recording gap (unrecorded movement is not reconstructed)', () => {
    const s = samplePath(line(3000), { speedMps: 3, gap: [300, 400] }); // 100 s without fixes ≈ 300 m
    const r = evaluateMovement(s, runEvents(s));
    expect(r.decision).toBe('eligible');
    expect(r.verifiedDistanceM).toBeLessThan(2720);
    expect(r.verifiedDistanceM).toBeGreaterThan(2650);
  });

  it('does not count distance covered while paused', () => {
    const s = samplePath(line(2000), { speedMps: 2 });
    const pause: RecordingEvent = { kind: 'pause', t: T0 + 200_000, afterSeq: 200 };
    const resume: RecordingEvent = { kind: 'resume', t: T0 + 500_000, afterSeq: 500 };
    const r = evaluateMovement(s, runEvents(s, [pause, resume]));
    expect(r.verifiedDistanceM).toBeGreaterThan(1350);
    expect(r.verifiedDistanceM).toBeLessThan(1450); // 300 s × 2 m/s left out
  });

  it('leaves out a sustained vehicle-speed stretch but keeps the honest running around it', () => {
    const run1 = samplePath(line(1000), { speedMps: 3 });
    const mid = destination(ORIGIN, 1000, 90);
    const car = samplePath(line(2000, 90, mid), { speedMps: 9, startT: run1[run1.length - 1]!.t + 1000 }, run1.length);
    const end = destination(mid, 2000, 90);
    const run2 = samplePath(line(500, 90, end), { speedMps: 3, startT: car[car.length - 1]!.t + 1000 }, run1.length + car.length);
    const s = [...run1, ...car, ...run2];
    const r = evaluateMovement(s, runEvents(s));
    expect(r.decision).toBe('eligible');
    expect(r.reasons).toContain('suspicious_speed');
    expect(r.verifiedDistanceM).toBeGreaterThan(1450);
    expect(r.verifiedDistanceM).toBeLessThan(1560);
    expect(r.excludedDistanceM).toBeGreaterThan(1900);
  });

  it('keeps a short fast burst (a sprint), which is not a vehicle', () => {
    const run1 = samplePath(line(800), { speedMps: 3 });
    const mid = destination(ORIGIN, 800, 90);
    const sprint = samplePath(line(200, 90, mid), { speedMps: 7, startT: run1[run1.length - 1]!.t + 1000 }, run1.length); // ~29 s
    const s = [...run1, ...sprint];
    const r = evaluateMovement(s, runEvents(s));
    expect(r.reasons).not.toContain('suspicious_speed');
    expect(r.verifiedDistanceM).toBeGreaterThan(990);
  });

  it('drops a single GPS jump', () => {
    const s = samplePath(line(1500), { speedMps: 3 });
    const k = 200;
    const far = destination(s[k]!, 600, 0);
    s[k] = { ...s[k]!, lat: far.lat, lng: far.lng };
    const r = evaluateMovement(s, runEvents(s));
    expect(r.reasons).toContain('gps_jump');
    expect(r.verifiedDistanceM).toBeGreaterThan(1480);
    expect(r.verifiedDistanceM).toBeLessThan(1520);
  });

  it('ignores inaccurate fixes and earns nothing below 200 m', () => {
    const shortRun = samplePath(line(150), { speedMps: 2 });
    expect(evaluateMovement(shortRun, runEvents(shortRun))).toMatchObject({ decision: 'unranked', reasons: ['movement_too_short'], verifiedDistanceM: 0 });
    const vague = samplePath(line(2000), { speedMps: 3, accuracyM: 80 });
    expect(evaluateMovement(vague, runEvents(vague))).toMatchObject({ decision: 'unranked', reasons: ['insufficient_samples'] });
  });
});

describe('movement points: economy', () => {
  it('pays whole points per verified kilometre, rounded down', () => {
    expect(pointsForDistance(0)).toBe(0);
    expect(pointsForDistance(99.9)).toBe(0);
    expect(pointsForDistance(100)).toBe(1);
    expect(pointsForDistance(5_049)).toBe(50);
    expect(pointsForDistance(-5)).toBe(0);
  });

  it('prices a cell by its area so the cost does not depend on the grid', () => {
    expect(reclaimCostPerCell(11)).toBe(3);
    expect(reclaimCostPerCell(10)).toBe(16);
    expect(reclaimCostPerCell(12)).toBe(1);
    expect(reclaimCostPerCell(9)).toBe(106);
  });

  it('quotes total, balance and remaining for a selection', () => {
    expect(quoteReclaim(4, 3, 20)).toEqual({ cells: 4, costPerCell: 3, total: 12, balance: 20, remaining: 8, affordable: true });
    expect(quoteReclaim(8, 3, 20)).toMatchObject({ total: 24, remaining: -4, affordable: false });
    expect(quoteReclaim(0, 3, 20).affordable).toBe(false);
  });

  it('keeps running far cheaper than points: a 5 km loop earns enough for only a handful of cells', () => {
    const points = pointsForDistance(5000);
    expect(Math.floor(points / reclaimCostPerCell(11))).toBe(16);
  });
});

describe('achievement score', () => {
  it('adds tier points and a bonus for each category with a badge, never movement points', () => {
    const r = achievementScore([
      { tier: 'bronze', category: 'distance' },
      { tier: 'silver', category: 'distance' },
      { tier: 'gold', category: 'territory' }
    ]);
    expect(r).toEqual({ score: 10 + 25 + 60 + 2 * 25, tierTotal: 95, categories: 2, bonus: 50 });
    expect(achievementScore([]).score).toBe(0);
  });
});
