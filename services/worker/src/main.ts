/**
 * Long-running job worker. Polls the durable `internal.jobs` queue with SKIP LOCKED, runs the shared
 * handlers, retries with backoff and dead-letters after max attempts. Safe to run several replicas.
 *   WORKER_QUEUES=territory,speed  (default: all)   WORKER_CONCURRENCY=2   WORKER_POLL_MS=1000
 */
import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { scrubSentryEvent, scrubText } from '../../../supabase/functions/_shared/core/index.ts';
import { SupabaseBlobStore } from '../../../supabase/functions/_shared/blobs.ts';
import { closeSql, getSql, serviceClient } from '../../../supabase/functions/_shared/clients.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import { buildIntegrations } from '../../../supabase/functions/_shared/integrations.ts';
import { ALL_QUEUES, runBatch } from '../../../supabase/functions/_shared/jobs/registry.ts';
import type { JobContext } from '../../../supabase/functions/_shared/jobs/context.ts';

const env = readEnv((k) => process.env[k]);
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.RELEASE,
    tracesSampleRate: 0.05,
    beforeSend: (e) => scrubSentryEvent(e as never)
  });
}

const queues = (process.env.WORKER_QUEUES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
const pollMs = Number(process.env.WORKER_POLL_MS ?? 1000);
const ctx: JobContext = {
  sql: getSql(env, concurrency + 2),
  blobs: new SupabaseBlobStore(serviceClient(env)),
  env,
  integrations: buildIntegrations(env),
  log: (message, data) => console.log(JSON.stringify({ level: 'info', message: scrubText(message), ...(data ? { data: JSON.parse(scrubText(JSON.stringify(data))) } : {}) }))
};

let running = true;
let lastBatchAt = Date.now();
async function loop(slot: number) {
  const workerId = `node-${process.pid}-${slot}`;
  while (running) {
    try {
      const r = await runBatch(ctx, workerId, queues.length ? queues : ALL_QUEUES, 5, (err, job) => {
        if (env.SENTRY_DSN) Sentry.withScope((s) => { s.setTag('job', job.kind); Sentry.captureException(err); });
      });
      lastBatchAt = Date.now();
      if (r.claimed === 0) await new Promise((res) => setTimeout(res, pollMs));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', message: scrubText(String((err as Error).message)) }));
      if (env.SENTRY_DSN) Sentry.captureException(err);
      await new Promise((res) => setTimeout(res, pollMs * 5));
    }
  }
}

// Health endpoint for container orchestrators.
const server = createServer((_req, res) => {
  const healthy = Date.now() - lastBatchAt < 60_000;
  res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ healthy }));
}).listen(Number(process.env.PORT ?? 8080));

async function shutdown() {
  running = false;
  server.close();
  await new Promise((r) => setTimeout(r, 2000));
  await closeSql();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(JSON.stringify({ level: 'info', message: 'worker started', queues: queues.length ? queues : 'all', concurrency }));
await Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i)));
