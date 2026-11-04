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

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
