/**
 * Cartoon avatars: an original, flat runner portrait built from a small set of parts. The spec is stored
 * on the profile (to edit it later) and validated by the database (internal.valid_avatar_style); the
 * picture itself is saved as an image, so it shows wherever a profile picture does.
 */
export const AVATAR_OPTIONS = {
  bg: ['#5B57E3', '#0A74E0', '#FF7A1A', '#5CC86A', '#E0529C', '#14A3A3', '#F5C02B', '#121318'],
  skin: ['#F6D3B5', '#EAB48C', '#D0976B', '#A86F4A', '#7A4B2E', '#4E2F1D'],
  hair: ['short', 'buzz', 'curly', 'bun', 'ponytail', 'long', 'afro', 'bald'],
  hairColor: ['#1E1B18', '#4A2E1C', '#8A4B22', '#D9A54A', '#B9B6B0', '#3D5AFE', '#E0529C'],
  face: ['smile', 'grin', 'focused', 'wink'],
  outfit: ['tee', 'singlet', 'hoodie', 'jacket', 'track'],
  outfitColor: ['#5B57E3', '#0A74E0', '#FF7A1A', '#2E9E44', '#D63B3B', '#121318', '#F2F3F7'],
  extra: ['none', 'cap', 'headband', 'sunglasses', 'visor', 'earbuds', 'beanie', 'headscarf'],
  extraColor: ['#FF7A1A', '#5B57E3', '#0A74E0', '#5CC86A', '#E0529C', '#121318', '#F2F3F7']
} as const;

export type AvatarSpec = {
  bg: string;
  skin: string;
  hair: (typeof AVATAR_OPTIONS.hair)[number];
  hairColor: string;
  face: (typeof AVATAR_OPTIONS.face)[number];
  outfit: (typeof AVATAR_OPTIONS.outfit)[number];
  outfitColor: string;
  extra: (typeof AVATAR_OPTIONS.extra)[number];
  extraColor: string;
};

export const AVATAR_LABELS: Record<string, string> = {
  short: 'Short', buzz: 'Buzz', curly: 'Curly', bun: 'Bun', ponytail: 'Ponytail', long: 'Long', afro: 'Afro', bald: 'None',
  smile: 'Smile', grin: 'Grin', focused: 'Focused', wink: 'Wink',
  tee: 'T-shirt', singlet: 'Singlet', hoodie: 'Hoodie', jacket: 'Jacket', track: 'Track top',
  none: 'Nothing', cap: 'Cap', headband: 'Headband', sunglasses: 'Sunglasses', visor: 'Visor', earbuds: 'Earbuds', beanie: 'Beanie', headscarf: 'Headscarf'
};

export const DEFAULT_AVATAR: AvatarSpec = {
  bg: '#5B57E3', skin: '#D0976B', hair: 'short', hairColor: '#1E1B18', face: 'smile', outfit: 'tee', outfitColor: '#FF7A1A', extra: 'none', extraColor: '#FF7A1A'
};

const KEYS = Object.keys(DEFAULT_AVATAR) as (keyof AvatarSpec)[];
const OPTION_OF: Record<keyof AvatarSpec, readonly string[]> = AVATAR_OPTIONS;

/** A stored spec, or the default for anything missing or unknown (older or edited data never breaks the picture). */
export function parseAvatar(v: unknown): AvatarSpec {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_AVATAR } as Record<keyof AvatarSpec, string>;
  for (const k of KEYS) if (typeof o[k] === 'string' && OPTION_OF[k].includes(o[k] as string)) out[k] = o[k] as string;
  return out as AvatarSpec;
}

/** Deterministic variety (a seeded shuffle), so "Surprise me" is repeatable in tests. */
export function shuffleAvatar(seed: number): AvatarSpec {
  // mulberry32: small, well-mixed and deterministic.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  const spec = {} as Record<keyof AvatarSpec, string>;
  for (const k of KEYS) spec[k] = pick(OPTION_OF[k]);
  if (spec.bg === spec.outfitColor) spec.outfitColor = AVATAR_OPTIONS.outfitColor[(AVATAR_OPTIONS.outfitColor.indexOf(spec.outfitColor as never) + 2) % AVATAR_OPTIONS.outfitColor.length]!;
  return spec as AvatarSpec;
}

export type Shape =
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill: string; opacity?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number; fill: string; opacity?: number; stroke?: string; strokeWidth?: number }
  | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; opacity?: number }
  | { tag: 'path'; d: string; fill: string; opacity?: number; stroke?: string; strokeWidth?: number; strokeLinecap?: 'round' };

const INK = '#1B1A22';

/** Darker or lighter shade of a #RRGGBB colour (for necks, shadows and highlights). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}

const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170;
};

/**
 * The portrait on a 120×120 square (the square is filled with the background, so the picture works as a
 * square image and inside a circle). Drawn back to front.
 */
export function avatarShapes(spec: AvatarSpec): Shape[] {
  const s: Shape[] = [];
  const skin = spec.skin;
  const skinShade = shade(skin, -0.14);
  const hair = spec.hairColor;
  const top = spec.outfitColor;
  const topShade = shade(top, isLight(top) ? -0.12 : 0.18);
  const covered = spec.extra === 'headscarf';
  const capLike = spec.extra === 'cap' || spec.extra === 'beanie';

  s.push({ tag: 'rect', x: 0, y: 0, width: 120, height: 120, fill: spec.bg });
  // Soft ground light behind the runner.
  s.push({ tag: 'circle', cx: 60, cy: 64, r: 44, fill: '#FFFFFF', opacity: 0.12 });

  // Hair that falls behind the head and shoulders.
  if (!covered) {
    if (spec.hair === 'long') s.push({ tag: 'path', d: 'M34 54 C32 30 46 21 60 21 C74 21 88 30 86 54 L89 90 C80 95 72 92 69 84 L51 84 C48 92 40 95 31 90 Z', fill: hair });
    if (spec.hair === 'afro') s.push({ tag: 'circle', cx: 60, cy: 45, r: 31, fill: hair });
    if (spec.hair === 'ponytail') s.push({ tag: 'path', d: 'M78 40 C94 42 98 62 90 80 C86 70 84 58 76 50 Z', fill: hair });
  }
  if (covered) s.push({ tag: 'path', d: 'M33 56 C31 29 46 19 60 19 C74 19 89 29 87 56 C87 74 80 86 60 90 C40 86 33 74 33 56 Z', fill: spec.extraColor });

  // Body and outfit.
  if (spec.outfit === 'singlet') {
    s.push({ tag: 'path', d: 'M16 120 C20 94 38 86 60 86 C82 86 100 94 104 120 Z', fill: skin });
    s.push({ tag: 'path', d: 'M34 120 C36 100 42 90 48 87 Q60 99 72 87 C78 90 84 100 86 120 Z', fill: top });
  } else {
    if (spec.outfit === 'hoodie') s.push({ tag: 'path', d: 'M36 86 C34 74 44 66 60 66 C76 66 86 74 84 86 Z', fill: topShade });
    s.push({ tag: 'path', d: 'M16 120 C20 94 38 85 60 85 C82 85 100 94 104 120 Z', fill: top });
  }
  // Neck.
  s.push({ tag: 'rect', x: 52, y: 68, width: 16, height: 20, rx: 6, fill: skinShade });
  if (spec.outfit === 'tee' || spec.outfit === 'track') s.push({ tag: 'path', d: 'M48 86 Q60 97 72 86 L70 85 Q60 93 50 85 Z', fill: topShade });
  if (spec.outfit === 'track') {
    s.push({ tag: 'path', d: 'M24 104 C30 96 38 91 46 89', fill: 'none', stroke: '#FFFFFF', strokeWidth: 3, strokeLinecap: 'round', opacity: 0.85 });
    s.push({ tag: 'path', d: 'M96 104 C90 96 82 91 74 89', fill: 'none', stroke: '#FFFFFF', strokeWidth: 3, strokeLinecap: 'round', opacity: 0.85 });
  }
  if (spec.outfit === 'jacket') {
    s.push({ tag: 'path', d: 'M60 92 L60 120', fill: 'none', stroke: topShade, strokeWidth: 3 });
    s.push({ tag: 'path', d: 'M46 86 L60 96 L74 86 L70 84 L60 91 L50 84 Z', fill: topShade });
  }
  if (spec.outfit === 'hoodie') {
    s.push({ tag: 'path', d: 'M54 92 L53 104', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.9 });
    s.push({ tag: 'path', d: 'M66 92 L67 104', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.9 });
  }
  if (covered) s.push({ tag: 'path', d: 'M42 76 Q60 96 78 76 L82 92 Q60 104 38 92 Z', fill: spec.extraColor });

  // Head.
  s.push({ tag: 'circle', cx: 38, cy: 55, r: 5.5, fill: skinShade });
  s.push({ tag: 'circle', cx: 82, cy: 55, r: 5.5, fill: skinShade });
  s.push({ tag: 'ellipse', cx: 60, cy: 52, rx: 22, ry: 24, fill: skin });

  // Hair on top of the head.
  if (!covered && !capLike) {
    switch (spec.hair) {
      case 'short':
      case 'ponytail':
        s.push({ tag: 'path', d: 'M37 50 C35 30 49 23 61 23 C74 23 86 31 83 50 C79 41 71 35 60 36 C51 36 42 40 37 50 Z', fill: hair });
        break;
      case 'buzz':
        s.push({ tag: 'path', d: 'M38.5 46 C40 32 50 27 60 27 C70 27 80 32 81.5 46 C75 39 67 35.5 60 35.5 C53 35.5 45 39 38.5 46 Z', fill: hair, opacity: 0.92 });
        break;
      case 'curly':
        for (const [cx, cy, r] of [[41, 43, 8], [48, 33, 9], [60, 29, 10], [72, 33, 9], [79, 43, 8], [38, 51, 5], [82, 51, 5]] as const) s.push({ tag: 'circle', cx, cy, r, fill: hair });
        break;
      case 'bun':
        s.push({ tag: 'circle', cx: 60, cy: 22, r: 9, fill: hair });
        s.push({ tag: 'path', d: 'M37 50 C35 30 49 25 61 25 C74 25 86 31 83 50 C79 41 71 36 60 36 C51 36 42 40 37 50 Z', fill: hair });
        break;
      case 'long':
        s.push({ tag: 'path', d: 'M37 52 C34 30 48 23 60 23 C73 23 87 30 83 52 C80 41 72 34 62 34 C55 38 46 42 37 52 Z', fill: hair });
        break;
      case 'afro':
        s.push({ tag: 'path', d: 'M36 48 C36 30 48 24 60 24 C72 24 84 30 84 48 C76 40 68 37 60 37 C52 37 44 40 36 48 Z', fill: hair });
        break;
      case 'bald':
        break;
    }
  }

  // Face.
  s.push({ tag: 'circle', cx: 47, cy: 61, r: 4, fill: '#FF8A8A', opacity: 0.28 });
  s.push({ tag: 'circle', cx: 73, cy: 61, r: 4, fill: '#FF8A8A', opacity: 0.28 });
  const eyesHidden = spec.extra === 'sunglasses';
  if (!eyesHidden) {
    if (spec.face === 'focused') {
      s.push({ tag: 'path', d: 'M47.5 52 L54.5 52', fill: 'none', stroke: INK, strokeWidth: 2.8, strokeLinecap: 'round' });
      s.push({ tag: 'path', d: 'M65.5 52 L72.5 52', fill: 'none', stroke: INK, strokeWidth: 2.8, strokeLinecap: 'round' });
    } else {
      s.push({ tag: 'circle', cx: 51, cy: 52, r: 2.7, fill: INK });
      if (spec.face === 'wink') s.push({ tag: 'path', d: 'M66 52.5 Q69 49.5 72 52.5', fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' });
      else s.push({ tag: 'circle', cx: 69, cy: 52, r: 2.7, fill: INK });
    }
    // Brows.
    s.push({ tag: 'path', d: spec.face === 'focused' ? 'M46 46.5 L55 48' : 'M46.5 46 Q51 44 55 46', fill: 'none', stroke: shade(spec.hair === 'bald' ? skin : hair, -0.2), strokeWidth: 2, strokeLinecap: 'round', opacity: 0.85 });
    s.push({ tag: 'path', d: spec.face === 'focused' ? 'M74 46.5 L65 48' : 'M65 46 Q69 44 73.5 46', fill: 'none', stroke: shade(spec.hair === 'bald' ? skin : hair, -0.2), strokeWidth: 2, strokeLinecap: 'round', opacity: 0.85 });
  }
  if (spec.face === 'grin') s.push({ tag: 'path', d: 'M51 61 Q60 72 69 61 Z', fill: INK });
  else if (spec.face === 'focused') s.push({ tag: 'path', d: 'M54 64 Q60 66 66 64', fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' });
  else s.push({ tag: 'path', d: 'M52 62 Q60 69 68 62', fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' });
  if (spec.face === 'grin') s.push({ tag: 'path', d: 'M53.5 62.5 Q60 65 66.5 62.5 L66 63.8 Q60 66 54 63.8 Z', fill: '#FFFFFF' });

  // Extras.
  const ex = spec.extraColor;
  const exShade = shade(ex, isLight(ex) ? -0.15 : 0.2);
  switch (spec.extra) {
    case 'cap':
      s.push({ tag: 'path', d: 'M37 45 C37 29 49 22 60 22 C72 22 83 29 83 45 Z', fill: ex });
      s.push({ tag: 'path', d: 'M56 43 Q80 40 96 46 Q82 50 58 47 Z', fill: exShade });
      s.push({ tag: 'circle', cx: 60, cy: 23, r: 2.2, fill: exShade });
      break;
    case 'beanie':
      s.push({ tag: 'path', d: 'M36 46 C36 26 49 19 60 19 C71 19 84 26 84 46 Z', fill: ex });
      s.push({ tag: 'rect', x: 34, y: 40, width: 52, height: 9, rx: 4.5, fill: exShade });
      s.push({ tag: 'circle', cx: 60, cy: 17, r: 5, fill: exShade });
      break;
    case 'headband':
      s.push({ tag: 'path', d: 'M37 39 C48 33 72 33 83 39 L83 45.5 C72 40 48 40 37 45.5 Z', fill: ex });
      break;
    case 'visor':
      s.push({ tag: 'path', d: 'M37 40 C48 35 72 35 83 40 L83 45 C72 40.5 48 40.5 37 45 Z', fill: ex });
      s.push({ tag: 'path', d: 'M50 42 Q70 38 90 45 Q72 48 52 46 Z', fill: exShade });
      break;
    case 'sunglasses':
      s.push({ tag: 'rect', x: 44, y: 47.5, width: 14, height: 9, rx: 4.5, fill: INK });
      s.push({ tag: 'rect', x: 62, y: 47.5, width: 14, height: 9, rx: 4.5, fill: INK });
      s.push({ tag: 'path', d: 'M58 50 L62 50', fill: 'none', stroke: INK, strokeWidth: 2 });
      s.push({ tag: 'path', d: 'M47 50 L51 50', fill: 'none', stroke: '#FFFFFF', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.55 });
      s.push({ tag: 'path', d: 'M65 50 L69 50', fill: 'none', stroke: '#FFFFFF', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.55 });
      break;
    case 'earbuds':
      s.push({ tag: 'circle', cx: 37.5, cy: 56, r: 3.2, fill: '#FFFFFF' });
      s.push({ tag: 'circle', cx: 82.5, cy: 56, r: 3.2, fill: '#FFFFFF' });
      s.push({ tag: 'path', d: 'M37.5 59 L37.5 65', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round' });
      s.push({ tag: 'path', d: 'M82.5 59 L82.5 65', fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, strokeLinecap: 'round' });
      break;
    case 'headscarf':
      s.push({ tag: 'path', d: 'M38 47 C42 31 78 31 82 47 C76 37 44 37 38 47 Z', fill: exShade });
      break;
    case 'none':
      break;
  }
  return s;
}

/** The same picture as an SVG document (tests and previews outside the app). */
export function avatarSvg(spec: AvatarSpec, size = 120): string {
  const attrs = (o: Record<string, unknown>) =>
    Object.entries(o)
      .filter(([k, v]) => k !== 'tag' && v !== undefined)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${String(v)}"`)
      .join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">${avatarShapes(spec).map((sh) => `<${sh.tag} ${attrs(sh)}/>`).join('')}</svg>`;
}
