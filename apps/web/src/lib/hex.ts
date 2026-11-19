/**
 * Pointy-top hexagon geometry, the orientation of the app's onboarding board (and of H3 cells on the map).
 * Shared by the 3D field and the 2D practice board.
 */
export type Vec2 = readonly [number, number];

export const SQRT3 = Math.sqrt(3);

/** Centre of axial cell (q, r) for a hexagon of circumradius s. */
export function axialToXY(q: number, r: number, s: number): [number, number] {
  return [s * SQRT3 * (q + r / 2), s * 1.5 * r];
}

/** The six corners of a pointy-top hexagon (angles 60i − 30°, as in the app's hexPoints). */
export function hexCorners(cx: number, cy: number, s: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return [cx + s * Math.cos(a), cy + s * Math.sin(a)] as [number, number];
  });
}

/** Every cell whose centre lies within radius R of the origin. */
export function cellsInCircle(R: number, s: number): { q: number; r: number; x: number; y: number }[] {
  const out: { q: number; r: number; x: number; y: number }[] = [];
  const span = Math.ceil(R / (s * 1.5)) + 2;
  for (let r = -span; r <= span; r++) {
    for (let q = -span * 2; q <= span * 2; q++) {
      const [x, y] = axialToXY(q, r, s);
      if (x * x + y * y <= R * R) out.push({ q, r, x, y });
    }
  }
  return out;
}

/** Cells covering a w × h rectangle (offset rows), for the practice board. */
export function cellsInRect(w: number, h: number, s: number, margin = 0): { x: number; y: number; row: number; col: number }[] {
  const hexW = SQRT3 * s;
  const out: { x: number; y: number; row: number; col: number }[] = [];
  const rows = Math.ceil((h + margin * 2) / (s * 1.5)) + 1;
  const cols = Math.ceil((w + margin * 2) / hexW) + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * hexW + (row % 2 ? hexW / 2 : 0) - margin;
      const y = row * s * 1.5 - margin;
      out.push({ x, y, row, col });
    }
  }
  return out;
}

/** Even-odd ray casting. */
export function pointInPolygon(x: number, y: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polylineLength(pts: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return len;
}

export function distanceToSegment(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export function distanceToPolyline(px: number, py: number, pts: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distanceToSegment(px, py, pts[i - 1]!, pts[i]!));
  return best;
}

/** Smooth curve through control points (centripetal-free uniform Catmull-Rom), like the app's smoothLoop. */
export function catmullRom(points: readonly Vec2[], samplesPerSegment: number, closed: boolean): [number, number][] {
  const n = points.length;
  const out: [number, number][] = [];
  const segments = closed ? n : n - 1;
  const at = (i: number): Vec2 => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!);
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push([points[n - 1]![0], points[n - 1]![1]]);
  return out;
}

/** Point and tangent at a fraction (0–1) of a polyline's length. */
export function sampleAlong(pts: readonly Vec2[], fraction: number, cumulative?: number[]): { x: number; y: number; dx: number; dy: number } {
  const cum = cumulative ?? cumulativeLengths(pts);
  const total = cum[cum.length - 1]!;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < target) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]! || 1;
  const t = (target - cum[i - 1]!) / seg;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dl = Math.hypot(dx, dy) || 1;
  return { x: a[0] + dx * t, y: a[1] + dy * t, dx: dx / dl, dy: dy / dl };
}

export function cumulativeLengths(pts: readonly Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return cum;
}

/** Deterministic pseudo-random numbers, so the city and the board draw the same every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
