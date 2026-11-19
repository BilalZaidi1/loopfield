'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { copy } from '@/content/en';
import { bucket, track } from '@/lib/analytics';
import { catmullRom, cellsInRect, cumulativeLengths, mulberry32, pointInPolygon, polylineLength, type Vec2 } from '@/lib/hex';
import { springAt, springDuration } from '@/lib/springs';
import { story } from '@/story/state';
import { palette, springs, territory } from '@/theme/brand';
import { PillButton } from './Pill';

/*
 * The practice board: the visitor draws a loop and claims the cells inside it, with the app's rules (close near the
 * start, enough ground inside, grey cells never awarded, the newest loop takes a rival's cells). Drawn on a 2D canvas
 * so it works on every device, including those without WebGL. It only animates while something is moving.
 */

export interface DrawResult {
  cells: number;
  taken: number;
  grey: number;
}

type Phase = 'idle' | 'drawing' | 'auto' | 'claimed';
type Hint = 'start' | 'close' | 'small';
type RGB = readonly [number, number, number];
type Pt = [number, number];

const KIND = { free: 0, rival: 1, grey: 2, park: 3 } as const;

interface Cell {
  x: number;
  y: number;
  kind: number;
  base: RGB;
  line: string;
  /** performance.now() when the claim spring starts; Infinity = not claimed, -Infinity = claimed without motion. */
  claimAt: number;
}

interface Board {
  w: number;
  h: number;
  R: number;
  cells: Cell[];
}

const POP_S = springDuration(springs.pop);
const RIPPLE_MS = 560;
const AUTO_MS = 1800;
const MIN_LENGTH = 140;
const MIN_CELLS = 5;
const CORNERS: Pt[] = Array.from({ length: 6 }, (_, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});

const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;

const SUNKEN = rgb(palette.surfaceSunken);
const FREE = rgb('#16171C');
const MINE = rgb(territory.mineFill);
const MINE_SIDE = rgb('#4A47A8');
const PATH_A = rgb(territory.pathStart);
const PATH_B = rgb(territory.path);

function makeBoard(w: number, h: number): Board {
  const R = w < 480 ? 13 : 16;
  const m = Math.min(w, h);
  const rivals = [
    { x: w * 0.67, y: h * 0.34, r: m * 0.18, hue: territory.rivalHues[0] },
    { x: w * 0.31, y: h * 0.71, r: m * 0.15, hue: territory.rivalHues[1] }
  ];
  const grey = { x: w * 0.86, y: h * 0.82, r: m * 0.13 };
  const park = { x: w * 0.15, y: h * 0.19, r: m * 0.11 };
  const rand = mulberry32(1119);
  const cells = cellsInRect(w, h, R, R).map(({ x, y }): Cell => {
    const seed = rand();
    const within = (b: { x: number; y: number; r: number }) => Math.hypot(x - b.x, y - b.y) <= b.r * (0.86 + seed * 0.28);
    if (within(grey)) return { x, y, kind: KIND.grey, base: mix(SUNKEN, rgb(territory.unavailableFill), 0.16), line: 'rgba(156,160,174,0.5)', claimAt: Infinity };
    if (within(park)) return { x, y, kind: KIND.park, base: rgb(palette.greenSoft), line: 'rgba(92,200,106,0.24)', claimAt: Infinity };
    const rival = rivals.find(within);
    if (rival) return { x, y, kind: KIND.rival, base: mix(SUNKEN, rgb(rival.hue), territory.rivalOpacity), line: css(rgb(rival.hue), 0.6), claimAt: Infinity };
    return { x, y, kind: KIND.free, base: FREE, line: 'rgba(255,255,255,0.05)', claimAt: Infinity };
  });
  return { w, h, R, cells };
}

/** The sample loop: round the middle of the board, through both rivals' ground. */
function sampleLoop(w: number, h: number): Pt[] {
  const pts = catmullRom(
    (
      [
        [0.47, 0.2],
        [0.71, 0.24],
        [0.8, 0.5],
        [0.64, 0.78],
        [0.38, 0.82],
        [0.21, 0.6],
        [0.27, 0.33]
      ] as const
    ).map(([fx, fy]): Vec2 => [fx * w, fy * h]),
    16,
    true
  );
  pts.push([pts[0]![0], pts[0]![1]]);
  return pts;
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [ux, uy] = CORNERS[i]!;
    if (i === 0) ctx.moveTo(cx + s * ux, cy + s * uy);
    else ctx.lineTo(cx + s * ux, cy + s * uy);
  }
  ctx.closePath();
}

/** A cell lifted off the board: the hull of its base and raised top (the side), then the top face. */
function prism(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, lift: number, side: string, top: string, line: string) {
  ctx.beginPath();
  for (const i of [0, 1, 2, 3, 4]) {
    const [ux, uy] = CORNERS[i]!;
    if (i === 0) ctx.moveTo(cx + s * ux, cy + s * uy);
    else ctx.lineTo(cx + s * ux, cy + s * uy);
  }
  for (const i of [4, 5, 0]) {
    const [ux, uy] = CORNERS[i]!;
    ctx.lineTo(cx + s * ux, cy - lift + s * uy);
  }
  ctx.closePath();
  ctx.fillStyle = side;
  ctx.fill();
  hexPath(ctx, cx, cy - lift, s);
  ctx.fillStyle = top;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.stroke();
}

function strokePath(ctx: CanvasRenderingContext2D, pts: readonly Pt[], alpha: number) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = territory.routeCasing;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
  // The app's path gradient, blue at the start to violet at the head.
  ctx.lineWidth = 4.5;
  const n = pts.length - 1;
  for (let i = 1; i <= n; i++) {
    ctx.strokeStyle = css(mix(PATH_A, PATH_B, i / n));
    ctx.beginPath();
    ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
    ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.stroke();
  }
  ctx.restore();
}

function marker(ctx: CanvasRenderingContext2D, [x, y]: Pt, color: string, glow: number) {
  if (glow > 0) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, `rgba(255,154,77,${(0.45 * glow).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,154,77,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = palette.surfaceSunken;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function runner(ctx: CanvasRenderingContext2D, [x, y]: Pt) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 20);
  g.addColorStop(0, 'rgba(255,122,26,0.42)');
  g.addColorStop(1, 'rgba(255,122,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = palette.orange;
  ctx.fill();
}

interface Ui {
  phase: (p: Phase) => void;
  hint: (h: Hint) => void;
  result: (r: DrawResult, mode: 'drawn' | 'auto') => void;
  counter: (n: number) => void;
}

class Pad {
  board: Board | null = null;
  phase: Phase = 'idle';
  private path: Pt[] = [];
  private len = 0;
  private failed = false;
  private auto: { pts: Pt[]; cum: number[]; start: number } | null = null;
  private claim: { start: number; at: Pt; reach: number; animate: boolean } | null = null;
  private grey = new Set<Cell>();
  private raf = 0;
  private dpr = 1;
  private shown = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ui: Ui
  ) {}

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.board = makeBoard(w, h);
    this.path = [];
    this.len = 0;
    this.auto = null;
    this.claim = null;
    this.grey.clear();
    this.setPhase('idle');
    this.ui.hint('start');
    this.ui.counter(-1);
    this.schedule();
  }

  down(x: number, y: number): boolean {
    if (!this.board || this.phase === 'auto') return false;
    this.clearClaim();
    this.path = [[x, y]];
    this.len = 0;
    this.failed = false;
    this.setPhase('drawing');
    this.ui.hint('start');
    this.schedule();
    return true;
  }

  move(x: number, y: number) {
    if (this.phase !== 'drawing' || this.path.length > 4000) return;
    const last = this.path[this.path.length - 1]!;
    const d = Math.hypot(x - last[0], y - last[1]);
    if (d < 3) return;
    this.path.push([x, y]);
    const before = this.len;
    this.len += d;
    if (before <= 60 && this.len > 60) this.ui.hint('close');
    this.schedule();
  }

  up() {
    if (this.phase !== 'drawing') return;
    if (this.len < 24) {
      // a tap, not a loop
      this.path = [];
      this.setPhase('idle');
      this.ui.hint('start');
      this.schedule();
      return;
    }
    const hint = this.tryClaim(this.path, performance.now(), story.motion, 'drawn');
    if (hint) {
      this.failed = true;
      this.setPhase('idle');
      this.ui.hint(hint);
      this.schedule();
    }
  }

  playSample() {
    if (!this.board || this.phase === 'auto' || this.phase === 'drawing') return;
    this.clearClaim();
    this.failed = false;
    const pts = sampleLoop(this.board.w, this.board.h);
    if (!story.motion) {
      this.tryClaim(pts, performance.now(), false, 'auto');
      return;
    }
    this.auto = { pts, cum: cumulativeLengths(pts), start: performance.now() };
    this.path = [];
    this.setPhase('auto');
    this.schedule();
  }

  reset() {
    if (this.phase === 'auto' || this.phase === 'drawing') return;
    this.clearClaim();
    this.path = [];
    this.len = 0;
    this.failed = false;
    this.setPhase('idle');
    this.ui.hint('start');
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.ui.phase(p);
  }

  private clearClaim() {
    if (!this.board) return;
    for (const c of this.board.cells) c.claimAt = Infinity;
    this.grey.clear();
    this.claim = null;
    this.shown = -1;
    this.ui.counter(-1);
  }

  /** The app's rules: close near the start, long enough, at least a few whole cells inside. */
  private tryClaim(path: Pt[], now: number, animate: boolean, mode: 'drawn' | 'auto'): Hint | null {
    const b = this.board;
    if (!b || path.length < 3) return 'close';
    const start = path[0]!;
    const end = path[path.length - 1]!;
    const closeR = Math.max(26, b.R * 1.6);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) > closeR) return 'close';
    if (polylineLength(path) < MIN_LENGTH) return 'small';

    const s = b.R * 0.82;
    const inside: Cell[] = [];
    const grey: Cell[] = [];
    for (const c of b.cells) {
      if (!pointInPolygon(c.x, c.y, path)) continue;
      if (!CORNERS.every(([ux, uy]) => pointInPolygon(c.x + ux * s, c.y + uy * s, path))) continue;
      (c.kind === KIND.grey ? grey : inside).push(c);
    }
    if (inside.length < MIN_CELLS) return 'small';

    let reach = 1;
    for (const c of inside) reach = Math.max(reach, Math.hypot(c.x - end[0], c.y - end[1]));
    let taken = 0;
    for (const c of inside) {
      if (c.kind === KIND.rival) taken++;
      c.claimAt = animate ? now + RIPPLE_MS * (Math.hypot(c.x - end[0], c.y - end[1]) / reach) : -Infinity;
    }
    for (const c of grey) this.grey.add(c);
    this.claim = { start: now, at: [end[0], end[1]], reach, animate };
    this.path = [...path, [start[0], start[1]]];
    this.auto = null;
    this.setPhase('claimed');
    this.ui.result({ cells: inside.length, taken, grey: grey.length }, mode);
    this.schedule();
    return null;
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    const busy = this.paint(now);
    if (busy) this.schedule();
  };

  private paint(now: number): boolean {
    const b = this.board;
    const ctx = this.canvas.getContext('2d');
    if (!b || !ctx) return false;
    let busy = false;

    // The sample loop plays like a run: the dot draws it, then it closes.
    let finishAuto: Pt[] | null = null;
    if (this.phase === 'auto' && this.auto) {
      const u = Math.min(1, (now - this.auto.start) / AUTO_MS);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const { pts, cum } = this.auto;
      const target = e * cum[cum.length - 1]!;
      let i = 1;
      while (i < pts.length - 1 && cum[i]! < target) i++;
      const a = pts[i - 1]!;
      const c = pts[i]!;
      const t = (target - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
      this.path = [...pts.slice(0, i), [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]];
      this.len = target;
      if (u >= 1) finishAuto = pts;
      else busy = true;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = palette.surfaceSunken;
    ctx.fillRect(0, 0, b.w, b.h);

    const r = b.R * 0.9;
    const liftMax = b.R * 0.5;
    let count = 0;
    ctx.lineWidth = 1;
    for (const c of b.cells) {
      let p = 0;
      if (c.claimAt === -Infinity) {
        p = 1;
        count++;
      } else if (c.claimAt !== Infinity) {
        const t = (now - c.claimAt) / 1000;
        if (t > 0) {
          count++;
          p = t >= POP_S ? 1 : springAt(springs.pop, t);
        }
        if (t < POP_S) busy = true;
      }
      if (p <= 0) {
        hexPath(ctx, c.x, c.y, r);
        ctx.fillStyle = css(c.base);
        ctx.fill();
        if (c.kind === KIND.grey) ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.line;
        ctx.stroke();
        if (c.kind === KIND.grey) ctx.setLineDash([]);
        continue;
      }
      const k = Math.min(1, p / 0.45);
      prism(ctx, c.x, c.y, r, liftMax * p, css(mix(c.base, MINE_SIDE, k)), css(mix(c.base, MINE, k)), `rgba(169,166,255,${(0.3 + 0.6 * k).toFixed(3)})`);
    }

    // Grey cells inside the loop light their dashed edge: they are never awarded.
    if (this.grey.size) {
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(156,160,174,0.95)';
      for (const c of this.grey) {
        hexPath(ctx, c.x, c.y, r);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // Soft vignette, so the board reads as a lit patch of the map.
    const vg = ctx.createRadialGradient(b.w / 2, b.h / 2, Math.min(b.w, b.h) * 0.32, b.w / 2, b.h / 2, Math.max(b.w, b.h) * 0.72);
    vg.addColorStop(0, 'rgba(11,12,14,0)');
    vg.addColorStop(1, 'rgba(11,12,14,0.78)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, b.w, b.h);

    // The ring of light that runs out from the closing point.
    if (this.claim?.animate) {
      const t = now - this.claim.start;
      const dur = RIPPLE_MS + 420;
      if (t < dur) {
        busy = true;
        const u = t / dur;
        ctx.save();
        ctx.globalAlpha = (1 - u) * 0.85;
        ctx.strokeStyle = territory.mineLine;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.claim.at[0], this.claim.at[1], this.claim.reach * 1.1 * (1 - (1 - u) ** 3), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.path.length === 0 && this.phase === 'idle') {
      // A faint suggestion of where a loop could go, with its start marked.
      const hint = sampleLoop(b.w, b.h);
      ctx.save();
      ctx.setLineDash([2, 9]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(245,246,250,0.2)';
      ctx.beginPath();
      ctx.moveTo(hint[0]![0], hint[0]![1]);
      for (const [x, y] of hint) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
      marker(ctx, hint[0]!, territory.start, 0);
    } else {
      strokePath(ctx, this.path, this.phase === 'idle' && this.failed ? 0.45 : 1);
    }

    if ((this.phase === 'drawing' || this.phase === 'auto') && this.path.length > 1) {
      const s0 = this.path[0]!;
      const cur = this.path[this.path.length - 1]!;
      const d = Math.hypot(cur[0] - s0[0], cur[1] - s0[1]);
      const closeR = Math.max(26, b.R * 1.6);
      // The gap glows orange as the runner comes back to the start.
      const near = this.len > MIN_LENGTH * 0.5 ? Math.max(0, Math.min(1, 1 - (d - closeR) / (closeR * 2.2))) : 0;
      if (near > 0) {
        ctx.save();
        ctx.globalAlpha = near;
        ctx.strokeStyle = territory.closing;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        if (d > closeR) ctx.setLineDash([2, 7]);
        ctx.beginPath();
        ctx.moveTo(cur[0], cur[1]);
        ctx.lineTo(s0[0], s0[1]);
        ctx.stroke();
        ctx.restore();
      }
      marker(ctx, s0, near > 0.6 ? territory.closing : territory.start, near);
      runner(ctx, cur);
    }

    if (this.phase === 'claimed' && count !== this.shown) {
      this.shown = count;
      this.ui.counter(count);
    }

    if (finishAuto) this.tryClaim(finishAuto, now, true, 'auto');
    return busy;
  }
}

/** The board with its live hint line and buttons. Results go up to the section for its call to action. */
export function DrawPad({ onClaim }: { onClaim: (r: DrawResult) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const counterWrap = useRef<HTMLDivElement>(null);
  const pad = useRef<Pad | null>(null);
  const claimRef = useRef(onClaim);
  const [phase, setPhase] = useState<Phase>('idle');
  const [hint, setHint] = useState<Hint>('start');
  const [result, setResult] = useState<DrawResult | null>(null);

  useEffect(() => {
    claimRef.current = onClaim;
  }, [onClaim]);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const p = new Pad(cv, {
      phase: setPhase,
      hint: (h) => {
        setHint(h);
        setResult(null);
      },
      result: (r, mode) => {
        setResult(r);
        claimRef.current(r);
        track('draw_loop_complete', { cells: bucket(r.cells), mode });
      },
      counter: (n) => {
        if (counterWrap.current) counterWrap.current.style.opacity = n < 0 ? '0' : '1';
        if (counter.current && n >= 0) counter.current.textContent = `+${n}`;
      }
    });
    pad.current = p;
    let width = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0 || Math.abs(w - width) < 1) return;
      width = w;
      p.resize(w, h);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      p.destroy();
      pad.current = null;
    };
  }, []);

  const local = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const status =
    phase === 'claimed' && result
      ? [copy.turn.yours(result.cells), result.taken > 0 ? copy.turn.took(result.taken) : '', result.grey > 0 ? copy.turn.grey : ''].filter(Boolean).join(' ')
      : phase === 'auto'
        ? copy.turn.close
        : copy.turn[hint];

  return (
    <div className="rounded-[28px] bg-sunken/90 p-2.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-sm sm:p-3">
      <div ref={wrap} className="relative aspect-square overflow-hidden rounded-[20px] sm:aspect-[6/5]">
        <canvas
          ref={canvas}
          role="img"
          aria-label={copy.turn.boardLabel}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none"
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const [x, y] = local(e);
            if (pad.current?.down(x, y)) {
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }
          }}
          onPointerMove={(e) => {
            if (pad.current?.phase !== 'drawing') return;
            // Coalesced events keep fast strokes smooth on phones and pens.
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
            const rect = e.currentTarget.getBoundingClientRect();
            for (const ev of events) pad.current.move(ev.clientX - rect.left, ev.clientY - rect.top);
          }}
          onPointerUp={() => pad.current?.up()}
          onPointerCancel={() => pad.current?.up()}
          onLostPointerCapture={() => pad.current?.up()}
        />
        <div ref={counterWrap} aria-hidden className="pointer-events-none absolute left-4 top-3 flex items-baseline gap-2 opacity-0 transition-opacity duration-300 sm:left-5 sm:top-4">
          <span ref={counter} className="font-display text-[clamp(40px,5vw,60px)] font-black italic leading-none tracking-[-0.03em] text-primary tabular [text-shadow:0_2px_18px_rgba(11,12,14,0.9)]">
            +0
          </span>
          <span className="t-kicker text-on-primary-soft">{copy.turn.cells}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-2 pb-1.5 pt-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-2.5">
        <p aria-live="polite" className={`t-label min-h-10 sm:min-h-0 ${phase === 'idle' && hint === 'small' ? 'text-orange-text' : phase === 'claimed' ? 'text-ink' : 'text-muted'}`}>
          {status}
        </p>
        {phase === 'claimed' ? (
          <PillButton variant="ghost" size="md" arrow={false} className="shrink-0 self-start sm:self-auto" onClick={() => pad.current?.reset()}>
            {copy.turn.again}
          </PillButton>
        ) : (
          <PillButton
            variant="ghost"
            size="md"
            arrow={false}
            className="shrink-0 self-start disabled:pointer-events-none disabled:opacity-40 sm:self-auto"
            disabled={phase === 'auto' || phase === 'drawing'}
            onClick={() => pad.current?.playSample()}
          >
            {copy.turn.auto}
          </PillButton>
        )}
      </div>
    </div>
  );
}
