import { z } from 'zod';

/** What the waitlist form sends. `website` is a honeypot: people never see it, bots fill it in. */
export const waitlistInput = z.object({
  email: z.email().max(254),
  city: z.string().trim().max(80).default(''),
  country: z.string().trim().max(56).default(''),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
  source: z.string().trim().max(30).default('site')
});
export type WaitlistInput = z.infer<typeof waitlistInput>;

export interface ConfirmPayload {
  email: string;
  city: string;
  country: string;
  source: string;
  /** Issued at, ms since epoch. */
  iat: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** A signed confirmation token: nothing is stored until the person taps the link in their inbox (double opt-in). */
export async function signConfirmToken(payload: ConfirmPayload, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error('WAITLIST_SECRET must be at least 32 characters.');
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** The payload if the token is genuine and younger than maxAgeMs, otherwise null. */
export async function verifyConfirmToken(
  token: string,
  secret: string,
  now = Date.now(),
  maxAgeMs = 7 * 24 * 3600 * 1000
): Promise<ConfirmPayload | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature || secret.length < 32) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(secret), fromBase64Url(signature), encoder.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as ConfirmPayload;
    if (typeof payload.email !== 'string' || typeof payload.iat !== 'number') return null;
    if (now - payload.iat > maxAgeMs || payload.iat > now + 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** A small fixed-window limiter per instance: enough to blunt a burst from one address. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (id: string, now = Date.now()): boolean => {
    const entry = hits.get(id);
    if (!entry || entry.reset <= now) {
      hits.set(id, { count: 1, reset: now + windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
