import { scrubText } from './core/index.ts';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

export type ErrorReporter = (err: unknown, context: Record<string, string>) => void;

/** Maps Postgres/HTTP errors to safe client responses; never echoes internals or personal data. */
export function toResponse(err: unknown, report?: ErrorReporter, context: Record<string, string> = {}): Response {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
  const e = err as { code?: string; message?: string; name?: string };
  if (e?.name === 'ConfigError') {
    report?.(err, context);
    return json({ error: 'not_configured', message: e.message }, 503);
  }
  switch (e?.code) {
    case '42501':
      return json({ error: 'forbidden' }, 403);
    case '28000':
      return json({ error: 'unauthenticated' }, 401);
    case 'P0429':
      return json({ error: 'rate_limited' }, 429);
    case 'P0413':
      return json({ error: 'zoom_in' }, 413);
    case 'P0503':
      return json({ error: 'temporarily_unavailable', message: e.message }, 503);
    case 'P0001':
      return json({ error: 'rejected', message: e.message ? scrubText(e.message) : undefined }, 422);
  }
  report?.(err, context);
  console.error('unhandled', scrubText(String(e?.message ?? err)));
  return json({ error: 'internal_error' }, 500);
}

export async function readJson<T>(req: Request, maxBytes = 1_000_000): Promise<{ raw: string; body: T }> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'payload_too_large');
  const raw = await req.text();
  if (raw.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  try {
    return { raw, body: JSON.parse(raw) as T };
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export function requireMethod(req: Request, method: string): void {
  if (req.method !== method) throw new HttpError(405, 'method_not_allowed');
}

/**
 * Browser origins allowed to call the user-facing functions: the web version on Expo Hosting (the project's
 * `loopfield` or `bilalzaidi95-loopfield` subdomain, production and `--<id>` preview deployments) and local web
 * development. WEB_ALLOWED_ORIGINS adds more (comma-separated). Native apps send no Origin header and are
 * unaffected. CORS only limits which websites may call these endpoints from a browser; every request still
 * needs a valid user session.
 */
export const DEFAULT_WEB_ORIGINS: readonly string[] = ['http://localhost:8081', 'http://localhost:19006'];
const EXPO_HOSTING_ORIGIN = /^https:\/\/(?:bilalzaidi95-)?loopfield(?:--[a-z0-9-]+)?\.expo\.app$/;

export function allowedWebOrigin(origin: string | null, extra: readonly string[] = []): string | null {
  if (!origin) return null;
  return DEFAULT_WEB_ORIGINS.includes(origin) || extra.includes(origin) || EXPO_HOSTING_ORIGIN.test(origin) ? origin : null;
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '600',
    vary: 'Origin'
  };
}

/**
 * Wraps a user-facing handler for browser use: answers CORS preflight requests and adds the CORS headers to
 * every response for an allowed origin. Requests from other origins get no CORS headers, so browsers block them.
 */
export async function withCors(req: Request, extraOrigins: readonly string[], handle: () => Promise<Response>): Promise<Response> {
  const origin = allowedWebOrigin(req.headers.get('origin'), extraOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : { vary: 'Origin' } });
  const res = await handle();
  if (!origin) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
