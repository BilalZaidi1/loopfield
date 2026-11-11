#!/usr/bin/env node
// Boots every edge function under the Deno runtime against a disposable local database and checks how each
// one answers unauthenticated, wrongly signed and correctly signed requests. This proves the Deno entrypoints
// start, resolve their npm imports, read configuration and reach Postgres. It is not a substitute for the
// hosted runtime: user-session paths need Supabase Auth, so they are checked only for rejection here.
//
//   DENO=/path/to/deno node scripts/smoke-functions.mjs        (deno on PATH is used when DENO is unset)
//   PGTEST_URL=postgres://…/postgres                           (optional: use an existing server, as in CI)
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const deno = process.env.DENO || 'deno';
const dbUrl = execFileSync('bash', [join(root, 'scripts/test-db.sh'), '--migrate-only'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();

// Throwaway values generated for this run only.
const rnd = (n = 24) => randomBytes(n).toString('base64url');
const secrets = {
  REVENUECAT_WEBHOOK_AUTH: `Bearer ${rnd()}`,
  STREAM_API_KEY: `smoke${rnd(6)}`,
  STREAM_API_SECRET: rnd(32),
  RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64')}`,
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${randomBytes(24).toString('base64')}`,
  JOBS_RUNNER_SECRET: rnd(),
  TICKET_SIGNING_SECRET: rnd(48)
};
const env = {
  ...process.env,
  SUPABASE_URL: 'http://127.0.0.1:9', // nothing listens here: session checks must fail closed
  SUPABASE_SECRET_KEY: 'smoke-not-a-real-key',
  SUPABASE_PUBLISHABLE_KEY: 'smoke-not-a-real-key',
  SUPABASE_DB_URL: dbUrl,
  ...secrets,
  SENTRY_DSN_BACKEND: '',
  RESEND_API_KEY: '' // deliberately unset: the auth hook must report "not configured", never pretend to send
};

const svixSign = (secret, id, ts, body) =>
  `v1,${createHmac('sha256', Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;
const now = () => Math.floor(Date.now() / 1000);
const rcEvent = JSON.stringify({ api_version: '1.0', event: { id: `smoke-${rnd(6)}`, type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:smoke', event_timestamp_ms: Date.now(), environment: 'SANDBOX', entitlement_ids: ['premium'] } });
const streamBody = JSON.stringify({ type: 'message.read', channel_id: 'x' });
const resendBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'smoke' } });
const hookBody = JSON.stringify({ user: { id: '00000000-0000-4000-8000-000000000000', email: 'smoke@example.test' }, email_data: { token: '123456', token_hash: 'abcdefabcdefabcdef', redirect_to: 'loopfield://auth/callback', email_action_type: 'recovery', site_url: 'loopfield://' } });
const svixId = `msg_${rnd(8)}`;
const hookId = `msg_${rnd(8)}`;

const userFunctions = ['session-ticket', 'activity-upload/finalize', 'chat/token', 'account', 'billing-sync'];
const cases = {
  'revenuecat-webhook': [
    { name: 'wrong method', method: 'GET', status: 405 },
    { name: 'missing authorization', body: rcEvent, status: 401 },
    { name: 'authorized anonymous purchase is recorded, grants nothing', body: rcEvent, headers: { authorization: secrets.REVENUECAT_WEBHOOK_AUTH }, status: 200, expect: { applied: false, duplicate: false } },
    { name: 'duplicate delivery is ignored', body: rcEvent, headers: { authorization: secrets.REVENUECAT_WEBHOOK_AUTH }, status: 200, expect: { duplicate: true } }
  ],
  'stream-webhook': [
    { name: 'bad signature', body: streamBody, headers: { 'x-signature': 'bad', 'x-api-key': secrets.STREAM_API_KEY }, status: 401 },
    { name: 'signed non-message event is acknowledged without action', body: streamBody, headers: { 'x-signature': createHmac('sha256', secrets.STREAM_API_SECRET).update(streamBody).digest('hex'), 'x-api-key': secrets.STREAM_API_KEY }, status: 200, expect: { handled: false } }
  ],
  'resend-webhook': [
    { name: 'bad signature', body: resendBody, headers: { 'svix-id': svixId, 'svix-timestamp': String(now()), 'svix-signature': 'v1,bad' }, status: 401 },
    { name: 'signed delivery event is recorded', body: resendBody, headers: () => { const ts = now(); return { 'svix-id': svixId, 'svix-timestamp': String(ts), 'svix-signature': svixSign(secrets.RESEND_WEBHOOK_SECRET, svixId, ts, resendBody) }; }, status: 200, expect: { handled: true } },
    { name: 'replayed delivery is ignored', body: resendBody, headers: () => { const ts = now(); return { 'svix-id': svixId, 'svix-timestamp': String(ts), 'svix-signature': svixSign(secrets.RESEND_WEBHOOK_SECRET, svixId, ts, resendBody) }; }, status: 200, expect: { handled: false } }
  ],
  'auth-email-hook': [
    { name: 'bad signature', body: hookBody, headers: { 'webhook-id': hookId, 'webhook-timestamp': String(now()), 'webhook-signature': 'v1,bad' }, status: 401 },
    { name: 'stale timestamp', body: hookBody, headers: () => { const ts = now() - 3600; return { 'webhook-id': hookId, 'webhook-timestamp': String(ts), 'webhook-signature': svixSign(secrets.SEND_EMAIL_HOOK_SECRET, hookId, ts, hookBody) }; }, status: 401 },
    { name: 'signed request without Resend configured reports not_configured', body: hookBody, headers: () => { const ts = now(); return { 'webhook-id': hookId, 'webhook-timestamp': String(ts), 'webhook-signature': svixSign(secrets.SEND_EMAIL_HOOK_SECRET, hookId, ts, hookBody) }; }, status: 503, expect: { error: 'not_configured' } }
  ],
  'email/unsubscribe': [
    { name: 'opening the link changes nothing (GET is refused)', method: 'GET', status: 405 },
    { name: 'one-click without a valid token is refused', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' }, status: 400, expect: { error: 'invalid_link' } },
    { name: 'the web page with an unknown token is refused', body: JSON.stringify({ token: 'x'.repeat(32), category: 'runs' }), status: 400, expect: { error: 'invalid_link' } },
    { name: 'browser preflight from the web app is allowed', method: 'OPTIONS', headers: { origin: 'https://loopfield.expo.app', 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey, content-type' }, status: 204, expectHeaders: { 'access-control-allow-origin': 'https://loopfield.expo.app' } }
  ],
  jobs: [
    { name: 'missing runner secret', body: '{}', status: 401 },
    { name: 'authorized run on an empty queue', body: '{}', headers: { 'x-jobs-secret': secrets.JOBS_RUNNER_SECRET }, status: 200, expect: { claimed: 0, failed: 0 } }
  ]
};
const webApp = 'https://loopfield.expo.app';
const preflight = (origin) => ({ origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, apikey, content-type' });
for (const path of userFunctions) {
  cases[path] = [
    { name: 'no session', body: '{}', status: 401, expect: { error: 'unauthenticated' } },
    { name: 'unverifiable session', body: '{}', headers: { authorization: 'Bearer not-a-real-session' }, status: 401, expect: { error: 'unauthenticated' } },
    { name: 'browser preflight from the web app is allowed', method: 'OPTIONS', headers: preflight(webApp), status: 204, expectHeaders: { 'access-control-allow-origin': webApp } },
    { name: 'browser preflight from a web preview deployment is allowed', method: 'OPTIONS', headers: preflight('https://loopfield--k3x9q2.expo.app'), status: 204, expectHeaders: { 'access-control-allow-origin': 'https://loopfield--k3x9q2.expo.app' } },
    { name: 'browser preflight from another site gets no CORS grant', method: 'OPTIONS', headers: preflight('https://other.example'), status: 204, expectHeaders: { 'access-control-allow-origin': null } },
    { name: 'web app request without a session is still rejected', body: '{}', headers: { origin: webApp }, status: 401, expect: { error: 'unauthenticated' }, expectHeaders: { 'access-control-allow-origin': webApp } }
  ];
}
// Webhooks are server-to-server: no CORS, and anything but POST is refused.
cases['stream-webhook'].push({ name: 'no CORS for webhooks', method: 'OPTIONS', headers: preflight(webApp), status: 405, expectHeaders: { 'access-control-allow-origin': null } });

async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await fetch(url, { method: 'OPTIONS' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`server did not start: ${url}`);
}

let failures = 0, port = 18600;
for (const [path, list] of Object.entries(cases)) {
  const fn = path.split('/')[0];
  const addr = `127.0.0.1:${port++}`;
  const child = spawn(deno, ['run', '-A', '--quiet', '--config', join(root, 'supabase/functions/deno.json'), join(root, 'supabase/functions', fn, 'index.ts')], {
    env: { ...env, DENO_SERVE_ADDRESS: `tcp:${addr}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.stdout.on('data', (d) => (stderr += d));
  try {
    await waitFor(`http://${addr}/`);
    for (const c of list) {
      const headers = { 'content-type': 'application/json', ...(typeof c.headers === 'function' ? c.headers() : c.headers ?? {}) };
      const res = await fetch(`http://${addr}/${path}`, { method: c.method ?? 'POST', headers, body: c.method === 'GET' || c.method === 'OPTIONS' ? undefined : c.body });
      const text = await res.text();
      let body = {};
      try { body = JSON.parse(text); } catch { /* non-JSON */ }
      const okBody = !c.expect || Object.entries(c.expect).every(([k, v]) => body[k] === v);
      const okHeaders = !c.expectHeaders || Object.entries(c.expectHeaders).every(([k, v]) => res.headers.get(k) === v);
      const ok = res.status === c.status && okBody && okHeaders;
      if (!ok) failures++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${path}: ${c.name} -> ${res.status}${ok ? '' : ` ${text.slice(0, 200)}`}`);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 200));
        if (stderr.trim()) console.log(`     function log: ${stderr.trim().split('\n').slice(-6).join('\n     ')}`);
      }
      stderr = '';
    }
  } catch (err) {
    failures++;
    console.log(`FAIL ${path}: ${err.message}\n${stderr.slice(-1500)}`);
  } finally {
    child.kill('SIGTERM');
  }
}
console.log(failures ? `${failures} smoke check(s) failed` : 'all edge function smoke checks passed');
process.exit(failures ? 1 : 0);
