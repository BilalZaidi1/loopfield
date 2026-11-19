import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mark, palette, springs, territory } from './brand';

/*
 * The site mirrors the app's dark tokens. These tests read the app's own source files, so a colour or spring
 * changed in the app fails here until the site follows.
 */
const apps = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, apps), 'utf8');

const tokens = read('mobile/src/theme/tokens.ts');
const motion = read('mobile/src/theme/motion.ts');
const brandTsx = read('mobile/src/components/Brand.tsx');
const css = read('web/src/app/globals.css');

function block(src: string, name: string): string {
  const match = src.match(new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!match?.[1]) throw new Error(`No block named ${name}`);
  return match[1];
}

function strings(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+):\s*'([^']*)'/g)) out[m[1]!] = m[2]!;
  return out;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('palette', () => {
  const dark = strings(block(tokens, 'dark'));
  it.each(Object.entries(palette))('%s matches the app', (key, value) => {
    expect(dark[key]?.toUpperCase()).toBe(value.toUpperCase());
  });
  it.each(Object.entries(palette))('%s matches globals.css', (key, value) => {
    const m = css.match(new RegExp(`--lf-${kebab(key)}:\\s*(#[0-9a-fA-F]{6})`));
    expect(m?.[1]?.toUpperCase()).toBe(value.toUpperCase());
  });
});

describe('territory', () => {
  const body = block(tokens, 'territoryDark');
  const dark = strings(body);
  const scalarKeys = Object.keys(territory).filter((k) => typeof territory[k as keyof typeof territory] === 'string');
  it.each(scalarKeys)('%s matches the app', (key) => {
    expect(dark[key]?.toUpperCase()).toBe(String(territory[key as keyof typeof territory]).toUpperCase());
  });
  it('rival hues match the app in order', () => {
    const hues = body.match(/rivalHues:\s*\[([^\]]*)\]/)?.[1]?.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(hues.map((h) => h.toUpperCase())).toEqual(territory.rivalHues.map((h) => h.toUpperCase()));
  });
  it('rival opacity and building opacity match', () => {
    expect(Number(body.match(/rivalOpacity:\s*([\d.]+)/)?.[1])).toBe(territory.rivalOpacity);
    expect(Number(body.match(/buildingOpacity:\s*([\d.]+)/)?.[1])).toBe(territory.buildingOpacity);
  });
});

describe('motion', () => {
  it.each(['press', 'sheet', 'pop'] as const)('%s spring matches motion.ts', (name) => {
    const m = motion.match(new RegExp(`${name}:\\s*\\{\\s*damping:\\s*([\\d.]+),\\s*stiffness:\\s*([\\d.]+),\\s*mass:\\s*([\\d.]+)`));
    expect(m && { damping: Number(m[1]), stiffness: Number(m[2]), mass: Number(m[3]) }).toEqual(springs[name]);
  });
  it('splash ring spring matches Brand.tsx', () => {
    const m = brandTsx.match(/ring\.value = withSpring\(1, \{ damping: ([\d.]+), stiffness: ([\d.]+), mass: ([\d.]+) \}\)/);
    expect(m && { damping: Number(m[1]), stiffness: Number(m[2]), mass: Number(m[3]) }).toEqual(springs.splashRing);
  });
});

describe('mark', () => {
  it('uses the app icon geometry and colours', () => {
    expect(brandTsx).toContain(`d="${mark.ring}"`);
    expect(brandTsx).toContain(`cx={${mark.dot.cx}} cy={${mark.dot.cy}} r={${mark.dot.r}}`);
    expect(brandTsx).toContain(`ring = '${mark.ringColor}'`);
    expect(brandTsx).toContain(`dot = '${mark.dotColor}'`);
  });
});
