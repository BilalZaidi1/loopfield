// Deno-only bootstrap shared by edge function entrypoints.
import * as Sentry from '@sentry/deno';
import { scrubSentryEvent } from './core/index.ts';
import { SupabaseBlobStore } from './blobs.ts';
import { getSql, serviceClient, type Sql } from './clients.ts';
import { readEnv, type ServerEnv } from './env.ts';
import { toResponse, withCors } from './http.ts';
import type { BlobStore } from './blobs.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void };

let initialized = false;

export interface Runtime {
  env: ServerEnv;
  sql: Sql;
  blobs: BlobStore;
  report: (err: unknown, context: Record<string, string>) => void;
}

function runtime(): Runtime {
  const env = readEnv((k) => Deno.env.get(k));
  if (!initialized && env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT,
      release: env.RELEASE,
      tracesSampleRate: 0.05,
      beforeSend: (event) => scrubSentryEvent(event as never),
      beforeBreadcrumb: (b) => (b.category === 'http' || b.category === 'fetch' ? null : b)
    });
  }
  initialized = true;
  return {
    env,
    sql: getSql(env),
    blobs: new SupabaseBlobStore(serviceClient(env)),
    report: (err, context) => {
      if (env.SENTRY_DSN) Sentry.withScope((scope) => {
        scope.setTags(context);
        Sentry.captureException(err);
      });
    }
  };
}

/**
 * `browser: true` marks a user-facing function the web version calls: it answers CORS preflight requests and
 * adds CORS headers for allowed origins (see withCors). Webhooks and the job runner never set it.
 */
export function serve(name: string, handler: (req: Request, rt: Runtime) => Promise<Response>, opts: { browser?: boolean } = {}): void {
  Deno.serve(async (req) => {
    let rt: Runtime | null = null;
    const run = async () => {
      try {
        rt = runtime();
        return await handler(req, rt);
      } catch (err) {
        return toResponse(err, rt?.report, { function: name });
      }
    };
    if (!opts.browser) return run();
    const extra = (Deno.env.get('WEB_ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    return withCors(req, extra, run);
  });
}
