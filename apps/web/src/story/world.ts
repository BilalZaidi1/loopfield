import { catmullRom, cellsInCircle, cumulativeLengths, distanceToPolyline, mulberry32, pointInPolygon, type Vec2 } from '@/lib/hex';

/*
 * The field: a fictional city laid out in the app's pointy-top hexagon cells, with the loops, rivals and route the
 * page's story plays out on. Everything is deterministic, so the server can quote the same numbers the 3D shows.
 * World units: a cell has circumradius 1. 2D points are [x, z] on the ground plane (z grows towards the camera).
 */

export const CELL = 1;
/** Drawn radius; the gap between cells is the grid. */
export const CELL_INSET = 0.9;
/** Story clock units (one per section) to animation seconds, for scroll-scrubbed cells. */
export const SECONDS_PER_T = 5;
/** The hero's opening loop plays in real time, once. */
export const INTRO_SECONDS = 2.8;
export const NEVER = 1e4;

/** Section order on the story clock: T = index + progress through the section. */
export const SECTIONS = ['hero', 'how', 'turn', 'rivals', 'titles', 'clubs', 'progress', 'privacy', 'app', 'final', 'faq'] as const;
export type SectionId = (typeof SECTIONS)[number];
export const sectionIndex = (id: SectionId) => SECTIONS.indexOf(id);

/** When each beat happens on the story clock. Tall pinned sections run their beats between ~0.2 and ~0.8. */
export const beats = {
  hero: { closeAt: 0.62, claimAt: 0.74 },
  how: { run: [1.2, 1.55], close: [1.55, 1.62], claim: 1.62, ripple: 0.14 },
  rivals: { run: [3.12, 3.42], close: [3.42, 3.47], flip: 3.47, ripple: 0.08, reclaim: 3.72, reclaimRipple: 0.06 },
  titles: { iris: [4.08, 4.26], run: [4.2, 4.72], title: 4.74 },
  clubs: { run: [5.14, 5.48], close: [5.48, 5.54], claim: 5.55, ripple: 0.1 },
  privacy: { fade: [7.08, 7.34], blurIn: [7.12, 7.4], blurOut: [7.8, 8.06] },
  app: { screens: [8.14, 8.86] },
  /** The patchwork spreads as the camera pulls back, your patch pulses as the header's loop closes, then the block opens. */
  final: { patch: 9.04, patchSpread: 0.34, pulse: 9.42, iris: [9.44, 9.6] }
} as const;

/**
 * The final call's height, and where links to #download land in it (vh from its top). The story reads progress at
 * the middle of the screen, so landing 133vh in reads about 0.70: after the block has opened (0.6) and before its
 * 100vh stage unpins (about 0.81). Without this, the links landed at the top, where only the headline shows.
 */
export const finalCall = { heightVh: 260, landVh: 133 } as const;

const sample = (f: (t: number) => Vec2, n = 140): Vec2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** Streets are gaps in the grid. The route in the titles section runs along the south avenue. */
export const roads: Vec2[][] = [
  sample((t) => {
    const x = -72 + 144 * t;
    return [x, -19 + 2.4 * Math.sin(x / 9)];
  }),
  sample((t) => {
    const z = -72 + 144 * t;
    return [12 + 2.2 * Math.sin(z / 8), z];
  }),
  sample((t) => {
    const x = -72 + 144 * t;
    return [x, 25 + 0.08 * x + 2 * Math.sin(x / 11)];
  })
];
export const ROAD_HALF_WIDTH = 1.05;

/** Cheap first pass: how far a point is across each street's own formula, before the exact polyline check. */
const nearRoad = (x: number, z: number): boolean =>
  Math.abs(z - (-19 + 2.4 * Math.sin(x / 9))) < 3 ||
  Math.abs(x - (12 + 2.2 * Math.sin(z / 8))) < 3 ||
  Math.abs(z - (25 + 0.08 * x + 2 * Math.sin(x / 11))) < 3;

const onRoad = (x: number, z: number): boolean =>
  nearRoad(x, z) && roads.some((road) => distanceToPolyline(x, z, road) <= ROAD_HALF_WIDTH);

/** The logo as a run: an open loop from −15° clockwise to 300°, then the dot closes the 45° gap. */
export const heroLoop: Vec2[] = (() => {
  const r = 6.2;
  const pts: Vec2[] = [];
  const start = -15;
  for (let i = 0; i <= 160; i++) {
    const a = ((start + (360 * i) / 160) * Math.PI) / 180;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
})();
/** Fraction of the hero loop where the open arc ends and the closing gap begins (315° of 360°). */
export const HERO_GAP_AT = 315 / 360;

export const loopA: Vec2[] = catmullRom(
  [
    [-26, 5],
    [-22, 1.5],
    [-15, 2.5],
    [-11.5, 7],
    [-13.5, 13],
    [-19, 15.5],
    [-25, 12.5]
  ],
  18,
  true
);

export const rivalLoop: Vec2[] = catmullRom(
  [
    [-12.5, -1],
    [-7, -5.5],
    [-1.5, -4],
    [0.5, 2.5],
    [-2.5, 8.5],
    [-8.5, 9.5],
    [-13, 5]
  ],
  18,
  true
);
/** Lost cells east of this line are the ones taken back with movement points. */
export const RECLAIM_X = -4;

export const clubLoop: Vec2[] = catmullRom(
  [
    [18, 7],
    [23, 4.5],
    [29, 6],
    [31, 12],
    [28.5, 18],
    [22, 19],
    [17.5, 14]
  ],
  18,
  true
);
/** Five club mates run side by side: lateral offsets from the club loop, in world units. */
export const clubOffsets = [-1.3, -0.65, 0, 0.65, 1.3] as const;

/** The approved route: along the south avenue, west to east (routes have a set direction). */
export const route: Vec2[] = sample((t) => {
  const x = -34 + 64 * t;
  return [x, -19 + 2.4 * Math.sin(x / 9)];
}, 90);
export const routeGates = { start: 0, checkpoints: [0.33, 0.66], finish: 1 } as const;

interface Blob {
  x: number;
  z: number;
  r: number;
  hue: number;
}

/** Rivals already on the map when the page opens: the shared map is never empty. */
const ambientRivals: Blob[] = [
  { x: 9, z: 8.5, r: 3.1, hue: 1 },
  { x: -27, z: -10, r: 3.5, hue: 2 },
  { x: 22, z: -1.5, r: 2.8, hue: 3 },
  { x: -14, z: 18, r: 2.5, hue: 4 },
  { x: 4, z: -11, r: 2.4, hue: 5 }
];
const greyZone = { x: 18, z: -8.5, r: 2.6 };
const park = { x: -8, z: -12.5, r: 3.6 };
const buildingClusters = [
  { x: -31, z: -2, r: 4.5 },
  { x: 32, z: -13, r: 4 },
  { x: 3, z: 18, r: 3.2 },
  { x: -36, z: 18, r: 4 },
  { x: 38, z: 26, r: 4.5 }
];

/** The city-wide patchwork the final call pulls back to reveal. */
const patchBlobs: Blob[] = (() => {
  const rand = mulberry32(20261119);
  const out: Blob[] = [];
  const keepClear: { x: number; z: number; r: number }[] = [
    { x: 0, z: 0, r: 9.5 },
    { x: -19, z: 9, r: 10 },
    { x: 24, z: 12, r: 10 },
    { x: -6, z: 2, r: 9 },
    greyZone,
    park
  ];
  let guard = 0;
  while (out.length < 30 && guard++ < 2000) {
    const a = rand() * Math.PI * 2;
    const d = 8 + rand() * 40;
    const b = { x: Math.cos(a) * d, z: Math.sin(a) * d, r: 1.8 + rand() * 2.4, hue: Math.floor(rand() * 6) };
    if (keepClear.some((k) => Math.hypot(k.x - b.x, k.z - b.z) < k.r + b.r)) continue;
    if (out.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r + 0.6)) continue;
    out.push(b);
  }
  return out;
})();

export const KIND = { normal: 0, grey: 1, park: 2, building: 3 } as const;

export interface FieldData {
  count: number;
  /** x, z, base height */
  offset: Float32Array;
  /** heroDelay (intro fraction, −1 = not hero), mineT, rivalT (−1 = always), reclaimT */
  a: Float32Array;
  /** clubT, patchT, rival hue, patch hue */
  b: Float32Array;
  /** kind, seed */
  c: Float32Array;
  stats: { cells: number; hero: number; loopA: number; lost: number; reclaimed: number; club: number };
}

const inBlob = (x: number, z: number, b: { x: number; z: number; r: number }) => Math.hypot(x - b.x, z - b.z) <= b.r;

/** Build the per-cell data for a field of the given radius (smaller on phones). */
export function buildField(radius: number): FieldData {
  const raw = cellsInCircle(radius, CELL).filter(({ x, y }) => !onRoad(x, y));
  const rand = mulberry32(7);
  const n = raw.length;
  const offset = new Float32Array(n * 3);
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  const c = new Float32Array(n * 2);
  const stats = { cells: n, hero: 0, loopA: 0, lost: 0, reclaimed: 0, club: 0 };

  const heroClose = heroLoop[0]!;
  const loopAStart = loopA[0]!;
  const rivalStart = rivalLoop[0]!;
  const clubStart = clubLoop[0]!;
  const maxD = (pts: Vec2[], from: Vec2) => Math.max(...pts.map(([x, z]) => Math.hypot(x - from[0], z - from[1])));
  const heroMax = maxD(heroLoop, heroClose);
  const aMax = maxD(loopA, loopAStart);
  const rMax = maxD(rivalLoop, rivalStart);
  const cMax = maxD(clubLoop, clubStart);

  raw.forEach(({ x, y: z }, i) => {
    let kind: number = KIND.normal;
    let base = 0.06 + rand() * 0.08;
    const seed = rand();
    if (inBlob(x, z, greyZone)) kind = KIND.grey;
    else if (inBlob(x, z, park)) {
      kind = KIND.park;
      base = 0.05;
    } else {
      for (const bc of buildingClusters) {
        const d = Math.hypot(x - bc.x, z - bc.z);
        if (d <= bc.r) {
          kind = KIND.building;
          base = 0.35 + (1 - d / bc.r) * 0.9 * (0.6 + seed * 0.4);
        }
      }
    }

    const hero = pointInPolygon(x, z, heroLoop);
    const inA = pointInPolygon(x, z, loopA);
    const inRival = pointInPolygon(x, z, rivalLoop);
    const inClub = pointInPolygon(x, z, clubLoop);
    const claimable = kind !== KIND.grey;

    const heroDelay = hero && claimable ? beats.hero.claimAt + 0.2 * (Math.hypot(x - heroClose[0], z - heroClose[1]) / heroMax) : -1;
    const mineT = inA && claimable ? beats.how.claim + beats.how.ripple * (Math.hypot(x - loopAStart[0], z - loopAStart[1]) / aMax) : NEVER;
    let rivalT = NEVER;
    let rivalHue = 0;
    if (inRival && claimable) rivalT = beats.rivals.flip + beats.rivals.ripple * (Math.hypot(x - rivalStart[0], z - rivalStart[1]) / rMax);
    else {
      const amb = ambientRivals.find((bl) => inBlob(x, z, bl));
      if (amb && claimable && !hero && !inA) {
        rivalT = -1;
        rivalHue = amb.hue;
      }
    }
    const wasMine = heroDelay >= 0 || mineT < NEVER;
    const lost = wasMine && rivalT < NEVER && rivalT >= 0;
    const reclaimT = lost && x > RECLAIM_X ? beats.rivals.reclaim + beats.rivals.reclaimRipple * Math.min(1, Math.hypot(x - RECLAIM_X, z - 2) / 8) : NEVER;
    const clubT = inClub && claimable && rivalT === NEVER ? beats.clubs.claim + beats.clubs.ripple * (Math.hypot(x - clubStart[0], z - clubStart[1]) / cMax) : NEVER;

    let patchT = NEVER;
    let patchHue = 0;
    if (!wasMine && rivalT === NEVER && clubT === NEVER && claimable && kind !== KIND.park) {
      const pb = patchBlobs.find((bl) => inBlob(x, z, bl));
      if (pb) {
        patchT = beats.final.patch + beats.final.patchSpread * (Math.hypot(x, z) / 50) + seed * 0.04;
        patchHue = pb.hue;
      }
    }

    if (heroDelay >= 0) stats.hero++;
    if (mineT < NEVER) stats.loopA++;
    if (lost) stats.lost++;
    if (reclaimT < NEVER) stats.reclaimed++;
    if (clubT < NEVER) stats.club++;

    offset.set([x, z, base], i * 3);
    a.set([heroDelay, mineT, rivalT, reclaimT], i * 4);
    b.set([clubT, patchT, rivalHue, patchHue], i * 4);
    c.set([kind, seed], i * 2);
  });

  return { count: n, offset, a, b, c, stats };
}

/** Field radius by device: phones draw fewer, nearer cells. */
export const FIELD_RADIUS = { large: 50, small: 36 } as const;

/** Cells claimed by the run in How it works, quoted by the page's counter. */
export function loopACellCount(): number {
  return buildField(FIELD_RADIUS.small).stats.loopA;
}

/** A path with its cumulative lengths, for actors that run along it. */
export interface Track {
  pts: Vec2[];
  cum: number[];
  length: number;
}
export function track(pts: Vec2[]): Track {
  const cum = cumulativeLengths(pts);
  return { pts, cum, length: cum[cum.length - 1]! };
}
