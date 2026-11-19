import { describe, expect, it } from 'vitest';
import { axialToXY, catmullRom, cellsInCircle, distanceToPolyline, hexCorners, pointInPolygon, polylineLength, sampleAlong, SQRT3 } from './hex';

describe('pointy-top hexagons', () => {
  it('place neighbours one hex width apart', () => {
    const [x0, y0] = axialToXY(0, 0, 1);
    const [x1, y1] = axialToXY(1, 0, 1);
    const [x2, y2] = axialToXY(0, 1, 1);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(SQRT3);
    expect(Math.hypot(x2 - x0, y2 - y0)).toBeCloseTo(SQRT3);
  });
  it('have a corner straight up and straight down', () => {
    const ys = hexCorners(0, 0, 1).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-1);
    expect(Math.max(...ys)).toBeCloseTo(1);
  });
  it('fill a circle with about πR² / (1.5√3 s²) cells', () => {
    const cells = cellsInCircle(20, 1);
    const expected = (Math.PI * 400) / (1.5 * SQRT3);
    expect(Math.abs(cells.length - expected) / expected).toBeLessThan(0.05);
  });
});

describe('loops', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10]
  ];
  it('know what is inside', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
  });
  it('measure and sample paths', () => {
    expect(polylineLength([...square, [0, 0]])).toBeCloseTo(40);
    const mid = sampleAlong([[0, 0], [10, 0]], 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.dx).toBeCloseTo(1);
    expect(distanceToPolyline(5, 3, [[0, 0], [10, 0]])).toBeCloseTo(3);
  });
  it('smooth a closed loop through its control points', () => {
    const smooth = catmullRom(square, 8, true);
    expect(smooth).toHaveLength(32);
    expect(smooth[0]![0]).toBeCloseTo(0);
    expect(smooth[8]![0]).toBeCloseTo(10);
  });
});
