#!/usr/bin/env node
// Draws the app icon, the Android adaptive and themed icons, the native splash and the Android notification icon
// from the Loopfield mark (the same geometry as LoopMark and BrandSplash in apps/mobile/src/components/Brand.tsx).
//
//   node scripts/make-brand-assets.mjs
//
// Needs Playwright with Chromium (it renders the SVGs); writes the PNGs into apps/mobile/assets.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'assets');

// Brand colours from the design system: the mark's violet and orange on the splash's near-black.
const RING = '#6762F0';
const DOT = '#FF7A1A';
const GROUND = '#101114';
const ARC = 'M82.84 41.2 A34 34 0 1 1 67 20.56';

/** The mark in a 100-unit box. Single-colour versions cut a small gap round the dot so it stays a dot. */
function mark({ ring = RING, dot = DOT, gap = false } = {}) {
  if (!gap) return `<path d="${ARC}" stroke="${ring}" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="67" cy="20.56" r="7.5" fill="${dot}"/>`;
  return `<mask id="m"><rect width="100" height="100" fill="white"/><circle cx="67" cy="20.56" r="10.5" fill="black"/></mask>
    <path d="${ARC}" stroke="${ring}" stroke-width="11" stroke-linecap="round" fill="none" mask="url(#m)"/><circle cx="67" cy="20.56" r="7.5" fill="${dot}"/>`;
}

/** `size` px square; the 100-unit mark box takes `share` of it, centred (the ring itself is 79% of that box). */
function svg({ size, share, ground = null, ...m }) {
  const box = size * share;
  const off = (size - box) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${ground ? `<rect width="${size}" height="${size}" fill="${ground}"/>` : ''}
    <g transform="translate(${off} ${off}) scale(${box / 100})">${mark(m)}</g></svg>`;
}

const ASSETS = [
  // iOS and the Android fallback icon: opaque, the mark on the dark ground.
  { file: 'icon.png', size: 1024, share: 0.76, ground: GROUND },
  // Android adaptive icon foreground: inside the 66 dp safe circle of the 108 dp layer (the background colour is in app.config.ts).
  { file: 'adaptive-icon.png', size: 1024, share: 0.7 },
  // Android 13+ themed icon: one colour, tinted by the system.
  { file: 'adaptive-icon-monochrome.png', size: 1024, share: 0.7, ring: '#FFFFFF', dot: '#FFFFFF', gap: true },
  // Native splash: at imageWidth 200 the mark box is 158 points, exactly BrandSplash's, so the hand-over doesn't jump.
  { file: 'splash.png', size: 1024, share: 0.79 },
  // Android notification icon: white on transparent (Android shows only its shape, tinted with the accent colour).
  { file: 'notification-icon.png', size: 96, share: 1.16, ring: '#FFFFFF', dot: '#FFFFFF', gap: true }
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const a of ASSETS) {
  await page.setViewportSize({ width: a.size, height: a.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(a)}</body></html>`);
  await page.locator('svg').screenshot({ path: join(OUT, a.file), omitBackground: !a.ground });
  console.log(`wrote ${a.file} (${a.size} px)`);
}
await browser.close();
