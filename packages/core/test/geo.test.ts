import { describe, expect, it } from 'vitest';
import { destination, haversineMeters, pathLengthMeters, trimPathEnds } from '../src/index.ts';

describe('trimPathEnds (shared route preview)', () => {
  const ORIGIN_TRIM = { lat: 24.86, lng: 67.02 };
  const north = (m: number) => destination(ORIGIN_TRIM, m, 0);
  const path = Array.from({ length: 21 }, (_, i) => north(i * 100)); // 2 km due north, a point every 100 m

  it('leaves out exactly the first and last 200 m', () => {
    const t = trimPathEnds(path, 200);
    expect(pathLengthMeters(t)).toBeCloseTo(1600, 0);
    expect(haversineMeters(t[0]!, path[0]!)).toBeCloseTo(200, 0);
    expect(haversineMeters(t[t.length - 1]!, path[path.length - 1]!)).toBeCloseTo(200, 0);
  });

  it('cuts inside a segment, not only at points', () => {
    const t = trimPathEnds(path, 250, 150);
    expect(haversineMeters(t[0]!, path[0]!)).toBeCloseTo(250, 0);
    expect(pathLengthMeters(t)).toBeCloseTo(1600, 0);
  });

  it('shows nothing when the run is too short to hide its ends', () => {
    expect(trimPathEnds(path.slice(0, 4), 200)).toEqual([]);
  });
});
