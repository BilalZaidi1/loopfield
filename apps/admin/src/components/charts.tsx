'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { minutes, num, shortDay } from '@/lib/format';

/** Value formats (a name, not a function, so server pages can pass it to these client charts). */
export type ValueFormat = 'number' | 'minutes';
const formatter = (f: ValueFormat = 'number') => (f === 'minutes' ? (n: number) => minutes(n) : (n: number) => num(n));

/**
 * Charts in the app's palette (checked with the dataviz validator): one violet series, a neutral grey
 * for the previous period, hairline grid and axes, 2 px lines, 4 px rounded bar ends at most 24 px
 * thick, a surface-ringed end dot, hover tooltips and a data table for screen readers.
 */

const C = { series: 'var(--lf-chart-1)', ref: 'var(--lf-chart-ref)', grid: 'var(--lf-chart-grid)', axis: 'var(--lf-chart-axis)', text: 'var(--lf-text-muted)', surface: 'var(--lf-surface)' };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Clean axis maximum and ticks: 0, step, 2·step… with step from 1, 2, 2.5, 5 × 10ⁿ. Counts (`integer`)
 * step by whole numbers, so a chart whose highest day is 1 shows 0 and 1, not quarter gridlines.
 */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((m) => +(m * mag).toPrecision(6)).find((s) => s >= raw) ?? 10 * mag;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}

/** Tick labels with as many decimals as the step needs (0.25 reads 0.25, never a rounded 0.3). */
export function tickFormat(ticks: number[]): (v: number) => string {
  const dp = (String(ticks[1] ?? 1).split('.')[1] ?? '').length;
  return dp ? (v) => num(v, { digits: dp }) : (v) => num(v, { compact: true });
}

const isCount = (vs: number[]) => vs.every((v) => Number.isInteger(v));

/** An axis label centred on x, or pinned to the edge it would run past (11 px text, about 6.4 px a character). */
function fitLabel(x: number, text: string, width: number): { x: number; anchor: 'start' | 'middle' | 'end' } {
  const half = (text.length * 6.4) / 2;
  if (x + half > width - 1) return { x: width - 1, anchor: 'end' };
  if (x - half < 1) return { x: 1, anchor: 'start' };
  return { x, anchor: 'middle' };
}

/**
 * Axis labels kept inside the chart and never touching: placed from the right, so the latest day always
 * shows, and any label that would run into the one after it is left out.
 */
export function placeLabels(items: { i: number; x: number; text: string }[], width: number) {
  const kept: { i: number; x: number; text: string; anchor: 'start' | 'middle' | 'end'; left: number }[] = [];
  for (const it of [...items].reverse()) {
    const at = fitLabel(it.x, it.text, width);
    const size = it.text.length * 6.4;
    const left = at.anchor === 'start' ? at.x : at.anchor === 'end' ? at.x - size : at.x - size / 2;
    const next = kept[kept.length - 1];
    if (next && left + size > next.left - 8) continue;
    kept.push({ ...it, ...at, left });
  }
  return kept.reverse();
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div role="presentation" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-sm bg-ink px-3 py-2 type-caption text-bg shadow-floating whitespace-nowrap"
      style={{ left, top: y - 10 }}>
      {children}
    </div>
  );
}

/**
 * The chart's numbers for screen readers. The visually hidden box wraps the table rather than being it:
 * a table ignores its height and grows to fit its rows, so a hidden 30-row table hung below the page and
 * stretched it with empty space.
 */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function LineChart({ days, values, previous, label, unit, height = 220, formatAs }: {
  days: string[];
  values: number[];
  previous?: number[];
  label: string;
  unit?: string;
  height?: number;
  formatAs?: ValueFormat;
}) {
  const format = formatter(formatAs);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const pad = { l: 44, r: 16, t: 14, b: 26 };
  const w = Math.max(width, 100);
  const all = [...values, ...(previous ?? [])];
  const ticks = niceTicks(Math.max(1, ...all), 4, isCount(all));
  const tick = tickFormat(ticks);
  const max = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const line = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = n > 1 ? `${line(values)}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const xLabels = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
  const last = n - 1;
  const step = n > 1 ? (w - pad.l - pad.r) / (n - 1) : w;
  return (
    <figure className="relative min-w-0" ref={ref}>
      {previous ? (
        <figcaption className="flex flex-wrap gap-4 type-caption text-muted mb-2">
          <span className="inline-flex items-center gap-2"><span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: C.series }} />This period</span>
          <span className="inline-flex items-center gap-2"><span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: C.ref }} />Previous period</span>
        </figcaption>
      ) : null}
      {width > 0 && n > 0 ? (
        <svg width={w} height={height} role="img" aria-label={`${label}, ${n} days, latest ${format(values[last] ?? 0)}${unit ? ` ${unit}` : ''}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={C.text}>{tick(t)}</text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize={11} fill={C.text}>{shortDay(days[i]!)}</text>
          ))}
          {previous && previous.length === n ? <path d={line(previous)} fill="none" stroke={C.ref} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : null}
          {area ? <path d={area} fill={C.series} fillOpacity={0.1} /> : null}
          <path d={line(values)} fill="none" stroke={C.series} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke={C.axis} strokeWidth={1} /> : null}
          <circle cx={x(hover ?? last)} cy={y(values[hover ?? last] ?? 0)} r={4.5} fill={C.series} stroke={C.surface} strokeWidth={2} />
          {values.map((_, i) => (
            <rect key={i} x={x(i) - step / 2} y={pad.t} width={Math.max(step, 6)} height={height - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
          ))}
        </svg>
      ) : <div style={{ height }} />}
      {hover != null && width > 0 ? (
        <Tooltip x={x(hover)} y={y(values[hover] ?? 0)} width={w}>
          <div className="font-semibold">{shortDay(days[hover]!)}</div>
          <div>{format(values[hover] ?? 0)}{unit ? ` ${unit}` : ''}{previous ? <span className="opacity-70"> · before {format(previous[hover] ?? 0)}</span> : null}</div>
        </Tooltip>
      ) : null}
      <DataTable caption={label} head={previous ? ['Day', 'Value', 'Previous period'] : ['Day', 'Value']}
        rows={days.map((d, i) => (previous ? [d, values[i] ?? 0, previous[i] ?? 0] : [d, values[i] ?? 0]))} />
    </figure>
  );
}

/** Columns over days or categories, growing from one baseline; the latest column is labelled. */
export function ColumnChart({ labels, values, label, unit, height = 220, formatAs, labelEvery }: {
  labels: string[];
  values: number[];
  label: string;
  unit?: string;
  height?: number;
  formatAs?: ValueFormat;
  labelEvery?: number;
}) {
  const format = formatter(formatAs);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const pad = { l: 44, r: 8, t: 18, b: 26 };
  const w = Math.max(width, 100);
  const ticks = niceTicks(Math.max(1, ...values), 4, isCount(values));
  const tick = tickFormat(ticks);
  const max = ticks[ticks.length - 1]!;
  const band = (w - pad.l - pad.r) / Math.max(n, 1);
  const bw = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(1, Math.floor((w - pad.l) / 56))));
  const axisLabels = placeLabels(
    values.map((_, i) => i).filter((i) => i % every === 0 || i === n - 1).map((i) => ({ i, x: pad.l + i * band + band / 2, text: labels[i] ?? '' })),
    w
  );
  const bar = (i: number, v: number) => {
    const x0 = pad.l + i * band + (band - bw) / 2;
    const top = y(v);
    const base = y(0);
    const r = Math.min(4, bw / 2, base - top);
    return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`;
  };
  return (
    <figure className="relative min-w-0" ref={ref}>
      {width > 0 ? (
        <svg width={w} height={height} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={C.text}>{tick(t)}</text>
            </g>
          ))}
          {values.map((v, i) => (
            <g key={i}>
              {v > 0 ? <path d={bar(i, v)} fill={C.series} opacity={hover == null || hover === i ? 1 : 0.55} /> : null}
              <rect x={pad.l + i * band} y={pad.t} width={band} height={height - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          ))}
          {axisLabels.map((l) => <text key={l.i} x={l.x} y={height - 6} textAnchor={l.anchor} fontSize={11} fill={C.text}>{l.text}</text>)}
          {n > 0 && values[n - 1]! > 0 && hover == null ? (() => {
            const text = format(values[n - 1]!);
            const at = fitLabel(pad.l + (n - 1) * band + band / 2, text, w);
            return <text x={at.x} y={y(values[n - 1]!) - 6} textAnchor={at.anchor} fontSize={11} fontWeight={600} fill="var(--lf-text)">{text}</text>;
          })() : null}
        </svg>
      ) : <div style={{ height }} />}
      {hover != null && width > 0 ? (
        <Tooltip x={pad.l + hover * band + band / 2} y={y(values[hover] ?? 0)} width={w}>
          <div className="font-semibold">{labels[hover]}</div>
          <div>{format(values[hover] ?? 0)}{unit ? ` ${unit}` : ''}</div>
        </Tooltip>
      ) : null}
      <DataTable caption={label} head={['', 'Value']} rows={labels.map((l, i) => [l, values[i] ?? 0])} />
    </figure>
  );
}

/** Horizontal bars for a ranked breakdown; values sit at the bar tips, shares on hover. */
export function HBars({ items, label, formatAs, showShare = true, empty = 'Nothing in this period.' }: {
  items: { key: string; label?: string; value: number }[];
  label: string;
  formatAs?: ValueFormat;
  showShare?: boolean;
  empty?: string;
}) {
  const format = formatter(formatAs);
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total === 0) return <p className="type-caption text-muted py-6 text-center">{empty}</p>;
  return (
    <figure className="flex flex-col gap-3 min-w-0" aria-label={label}>
      {items.map((i) => (
        <div key={i.key} className="grid grid-cols-[minmax(84px,34%)_1fr] items-center gap-3" title={showShare ? `${format(i.value)} · ${Math.round((100 * i.value) / total)}%` : format(i.value)}>
          <span className="type-caption text-ink truncate">{i.label ?? i.key}</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="h-4 rounded-r-[4px]" style={{ width: `${Math.max(2, (100 * i.value) / max)}%`, background: C.series, maxWidth: 'calc(100% - 56px)' }} />
            <span className="type-caption text-muted tabular-nums whitespace-nowrap">{format(i.value)}</span>
          </span>
        </div>
      ))}
      <DataTable caption={label} head={['', 'Value', 'Share']} rows={items.map((i) => [i.label ?? i.key, i.value, `${Math.round((100 * i.value) / total)}%`])} />
    </figure>
  );
}

/** Tiny trend line for stat tiles. Decorative: the tile states the number. */
export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = values.length;
  const max = Math.max(1, ...values);
  const w = Math.max(width, 60);
  const x = (i: number) => 2 + (n <= 1 ? 0 : (i * (w - 8)) / (n - 1));
  const y = (v: number) => 3 + (height - 6) * (1 - v / max);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div ref={ref} aria-hidden className="w-full">
      {width > 0 && n > 1 ? (
        <svg width={w} height={height}>
          <path d={`${d}L${x(n - 1)},${height}L${x(0)},${height}Z`} fill={C.series} fillOpacity={0.1} />
          <path d={d} fill="none" stroke={C.series} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(n - 1)} cy={y(values[n - 1]!)} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />
        </svg>
      ) : <div style={{ height }} />}
    </div>
  );
}
