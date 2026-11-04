/**
 * Provider-specific webhook authentication. Each provider documents a different scheme; they are
 * deliberately implemented separately rather than through one generic check.
 *  - Stream Chat: X-Signature = hex(HMAC-SHA256(rawBody, apiSecret)), plus X-Api-Key must match.
 *  - RevenueCat: the Authorization header value configured in the RevenueCat dashboard.
 *  - Resend (Svix) and Supabase Auth hooks (Standard Webhooks): base64(HMAC-SHA256(`${id}.${ts}.${body}`))
 *    with a whsec_ secret, versioned "v1," signatures and a timestamp tolerance.
 */

const encoder = new TextEncoder();

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i % (ab.length || 1)] ?? 0) ^ (bb[i % (bb.length || 1)] ?? 0);
  return diff === 0 && ab.length === bb.length;
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await hmac(encoder.encode(secret), message));
}

/** Stream Chat webhook (and before-message-send hook) signature. */
export async function verifyStreamWebhook(rawBody: string, headers: { signature: string | null; apiKey: string | null }, cfg: { apiKey: string; apiSecret: string }): Promise<boolean> {
  if (!headers.signature || !headers.apiKey) return false;
  if (!timingSafeEqual(headers.apiKey, cfg.apiKey)) return false;
  const expected = await hmacSha256Hex(cfg.apiSecret, rawBody);
  return timingSafeEqual(expected, headers.signature.trim().toLowerCase());
}

/** RevenueCat webhook: exact match on the configured Authorization header value. */
export function verifyRevenueCatAuthorization(header: string | null, configured: string): boolean {
  if (!header || !configured) return false;
  return timingSafeEqual(header.trim(), configured.trim());
}

export interface StandardWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Standard Webhooks / Svix verification. `secret` may be "whsec_<b64>" or "v1,whsec_<b64>"
 * (Supabase hook secret format). Throws nothing; returns false on any failure.
 */
export async function verifyStandardWebhook(
  rawBody: string,
  headers: StandardWebhookHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const cleaned = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  let keyBytes: Uint8Array;
  try {
    keyBytes = fromBase64(cleaned);
  } catch {
    return false;
  }
  const expected = toBase64(await hmac(keyBytes, `${headers.id}.${headers.timestamp}.${rawBody}`));
  return headers.signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .some((part) => timingSafeEqual(part.slice(3), expected));
}

/** Test helper / client for signing Standard Webhooks payloads. */
export async function signStandardWebhook(rawBody: string, id: string, timestamp: number, secret: string): Promise<string> {
  const cleaned = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  return `v1,${toBase64(await hmac(fromBase64(cleaned), `${id}.${timestamp}.${rawBody}`))}`;
}
