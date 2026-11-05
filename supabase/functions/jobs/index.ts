import { runBatch } from '../_shared/jobs/registry.ts';
import { serve } from '../_shared/deno.ts';
import { buildIntegrations } from '../_shared/integrations.ts';
import { HttpError, json, requireMethod } from '../_shared/http.ts';
import { serverSecret } from '../_shared/clients.ts';
import { timingSafeEqual } from '../_shared/core/index.ts';

// Job runner invoked every minute by pg_cron (pg_net) with the shared x-jobs-secret header.
// Runs batches until ~45 s have elapsed so it finishes inside the edge function wall-clock limit.
serve('jobs', async (req, rt) => {
  requireMethod(req, 'POST');
  // Same secret pg_cron sends: the environment value, or else the Vault entry the cron job reads.
  const expected = await serverSecret(rt.sql, rt.env.JOBS_RUNNER_SECRET, 'jobs_runner_secret').catch(() => '');
  if (!expected || !timingSafeEqual(req.headers.get('x-jobs-secret') ?? '', expected)) throw new HttpError(401, 'unauthorized');
  const ctx = { sql: rt.sql, blobs: rt.blobs, env: rt.env, integrations: buildIntegrations(rt.env), log: (m: string) => console.log(m) };
  const started = Date.now();
  const totals = { claimed: 0, succeeded: 0, failed: 0 };
  const workerId = `edge-${crypto.randomUUID().slice(0, 8)}`;
  while (Date.now() - started < 45_000) {
    const r = await runBatch(ctx, workerId, undefined, 5, (err, job) => rt.report(err, { job: job.kind }));
    totals.claimed += r.claimed; totals.succeeded += r.succeeded; totals.failed += r.failed;
    if (r.claimed === 0) break;
  }
  return json(totals);
});
