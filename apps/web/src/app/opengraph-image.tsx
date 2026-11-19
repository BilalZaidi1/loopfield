import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { copy } from '@/content/en';
import { mark, palette, territory } from '@/theme/brand';

export const alt = copy.meta.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** A cluster of cells on the right: your violet patch beside a rival's. Pointy-top, as in the app. */
function cells(): { x: number; y: number; fill: string; opacity: number; stroke: string }[] {
  const out: { x: number; y: number; fill: string; opacity: number; stroke: string }[] = [];
  const s = 34;
  const w = Math.sqrt(3) * s;
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 7; col++) {
      const x = col * w + (row % 2 ? w / 2 : 0);
      const y = row * s * 1.5;
      const dMine = Math.hypot(x - 150, y - 260);
      const dRival = Math.hypot(x - 330, y - 120);
      if (dMine < 120) out.push({ x, y, fill: territory.mineFill, opacity: 0.9, stroke: territory.mineLine });
      else if (dRival < 92) out.push({ x, y, fill: territory.rivalHues[0], opacity: territory.rivalOpacity, stroke: territory.rivalHues[0] });
      else out.push({ x, y, fill: palette.surface, opacity: 1, stroke: 'rgba(255,255,255,0.08)' });
    }
  }
  return out;
}

const hex = (cx: number, cy: number, s: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** The share card: the loop mark and the headline in black italic on the app's ink. */
export default async function OpengraphImage() {
  const font = await readFile(join(process.cwd(), 'src/fonts/figtree-latin-900-italic.woff'));
  const [first, second] = copy.hero.lines;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, fontFamily: 'Figtree', position: 'relative' }}>
        <svg width="520" height="630" viewBox="0 0 520 630" style={{ position: 'absolute', right: -40, top: 0 }}>
          {cells().map((c) => (
            <polygon key={`${c.x}-${c.y}`} points={hex(c.x, c.y, 30)} fill={c.fill} fillOpacity={c.opacity} stroke={c.stroke} strokeWidth="2" />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(90deg, #101114 0%, #101114 52%, rgba(16,17,20,0) 80%)' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <svg width="72" height="72" viewBox={mark.viewBox}>
              <path d={mark.ring} stroke={mark.ringColor} strokeWidth={mark.strokeWidth} strokeLinecap="round" fill="none" />
              <circle cx={mark.dot.cx} cy={mark.dot.cy} r={mark.dot.r} fill={mark.dotColor} />
            </svg>
            <span style={{ fontSize: 48, color: palette.text, fontStyle: 'italic', fontWeight: 900, letterSpacing: -1.5 }}>Loopfield</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 112, lineHeight: 0.94, fontStyle: 'italic', fontWeight: 900, letterSpacing: -4 }}>
            <span style={{ color: palette.text }}>{first.toUpperCase()}</span>
            <span style={{ color: palette.primary }}>{second.toUpperCase()}</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Figtree', data: font, style: 'italic', weight: 900 }] }
  );
}
