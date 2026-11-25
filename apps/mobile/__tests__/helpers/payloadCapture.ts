/**
 * Payload capture for tests: records what would leave the phone during a test, then lists anything that looks
 * like a position, a heart-rate value or another health reading.
 *
 * - analytics: each `track` call as it would be sent, after the event schema (`sanitizeEvent`);
 * - error: log lines (the error reporter collects console output as breadcrumbs, after `scrubText`) and error
 *   reports after `scrubSentryEvent`;
 * - network: each server call (RPC, edge function or table write) with its arguments.
 *
 * A test mocks the app's boundaries to call `captureAnalytics`, `captureError` and `captureRequest`, runs a
 * flow, then expects `problems()` to be empty. Network calls whose job is to carry a position (a live-link push,
 * a planned route, path following) are passed in `allowNetwork`.
 */
import { sanitizeEvent, scrubSentryEvent } from '@loopfield/core';

export type Channel = 'analytics' | 'error' | 'network';
export interface Payload {
  channel: Channel;
  name: string;
  body: unknown;
}

export const payloads: Payload[] = [];

export function resetPayloads(): void {
  payloads.length = 0;
}

export function captureAnalytics(event: string, props: Record<string, unknown> = {}): void {
  const clean = sanitizeEvent(event as never, props as never);
  payloads.push({ channel: 'analytics', name: clean.event, body: clean.properties });
}

export function captureError(name: string, body: unknown): void {
  const sent = body && typeof body === 'object' && !Array.isArray(body) ? scrubSentryEvent(body as never) : body;
  payloads.push({ channel: 'error', name, body: sent });
}

export function captureRequest(name: string, body: unknown): void {
  payloads.push({ channel: 'network', name, body });
}

/** Console output as the error reporter would collect it (it is scrubbed by `log` before it gets there). */
export function captureConsole(): () => void {
  const warn = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => captureError('console.warn', args.map(String).join(' ')));
  const error = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => captureError('console.error', args.map(String).join(' ')));
  return () => {
    warn.mockRestore();
    error.mockRestore();
  };
}

const POSITION_KEY = /^(lat|lng|lon|long|latitude|longitude|coords?|coordinates|position|positions|trail|path|points|location|last)$/i;
const HEALTH_KEY = /(heart|^hr($|_)|bpm|pulse|effort|load|balance|vo2|calorie|weight|sleep|zone|prediction|predicted)/i;
/** "24.86123, 67.01234" or "24.86123 67.01234" in text. */
const POSITION_TEXT = /-?\d{1,3}\.\d{4,}\s*[, ]\s*-?\d{1,3}\.\d{4,}/;

function walk(value: unknown, visit: (key: string | null, v: unknown, path: string) => void, key: string | null = null, path = '$'): void {
  visit(key, value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, null, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, k, `${path}.${k}`);
}

/** Problems found, as "channel name: path (reason)". `health` also checks health keys; `healthValues` exact numbers to look for. */
export function problems(opts: { allowNetwork?: (p: Payload) => boolean; health?: boolean; healthValues?: number[] } = {}): string[] {
  const out: string[] = [];
  for (const p of payloads) {
    if (p.channel === 'network' && opts.allowNetwork?.(p)) continue;
    walk(p.body, (key, v, path) => {
      const where = `${p.channel} ${p.name}: ${path}`;
      if (key && POSITION_KEY.test(key) && v != null && typeof v !== 'boolean') out.push(`${where} (position key)`);
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180 && !Number.isInteger(v) && (String(v).split('.')[1]?.length ?? 0) >= 4) out.push(`${where} (coordinate-like number ${v})`);
      if (typeof v === 'string' && POSITION_TEXT.test(v)) out.push(`${where} (coordinates in text)`);
      if (opts.health && key && HEALTH_KEY.test(key)) out.push(`${where} (health key)`);
      if (opts.healthValues?.length && typeof v === 'number' && opts.healthValues.includes(v)) out.push(`${where} (health value ${v})`);
      if (opts.healthValues?.length && typeof v === 'string' && opts.healthValues.some((h) => new RegExp(`(^|[^0-9.])${h}([^0-9.]|$)`).test(v))) out.push(`${where} (health value in text)`);
    });
  }
  return out;
}
