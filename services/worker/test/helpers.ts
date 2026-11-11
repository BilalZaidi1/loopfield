import postgres from 'postgres';
import { MemoryBlobStore } from '../../../supabase/functions/_shared/blobs.ts';
import type { Sql } from '../../../supabase/functions/_shared/clients.ts';
import { readEnv } from '../../../supabase/functions/_shared/env.ts';
import type { Integrations, JobContext } from '../../../supabase/functions/_shared/jobs/context.ts';
import { runBatch } from '../../../supabase/functions/_shared/jobs/registry.ts';
import { finalizeActivity, storeChunk, type Receipt } from '../../../supabase/functions/_shared/api/upload.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import { serializeSamples, sha256Hex, type LocationSample, type RecordingEvent } from '../../../packages/core/src/index.ts';

export const DB_URL = process.env.PGTEST_URL
  ? `${process.env.PGTEST_URL.replace(/\/[^/]*$/, '')}/loopfield_worker_test`
  : 'postgresql://postgres@localhost:54329/loopfield_worker_test';

export const COMP = '00000000-0000-4000-8000-000000000031';
export const SEASON = '00000000-0000-4000-8000-000000000041';

export const TEST_SECRETS = {
  ticket: 't'.repeat(48),
  streamKey: 'stream-key',
  streamSecret: 'stream-secret',
  rcAuth: 'Bearer rc-test-auth',
  resendWebhook: 'whsec_' + Buffer.from('resend-webhook-secret-0123456789').toString('base64'),
  authHook: 'v1,whsec_' + Buffer.from('auth-hook-secret-0123456789abcdef').toString('base64')
};

export function testEnv() {
  return readEnv((k) =>
    ({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_DB_URL: DB_URL,
      TICKET_SIGNING_SECRET: TEST_SECRETS.ticket,
      STREAM_API_KEY: TEST_SECRETS.streamKey,
      STREAM_API_SECRET: TEST_SECRETS.streamSecret,
      REVENUECAT_WEBHOOK_AUTH: TEST_SECRETS.rcAuth,
      RESEND_API_KEY: 're_test',
      RESEND_FROM: 'Loopfield <noreply@example.test>',
      RESEND_WEBHOOK_SECRET: TEST_SECRETS.resendWebhook,
      SEND_EMAIL_HOOK_SECRET: TEST_SECRETS.authHook
    })[k]
  );
}

export interface FakeIntegrations extends Integrations {
  calls: {
    push: unknown[];
    email: Array<{ to: string; subject: string; text: string; tag: string }>;
    frozen: Array<[string, boolean]>;
    deletedUsers: string[];
    groups: Map<string, { name: string; members: string[] }>;
    deletedGroups: string[];
  };
}

export function fakeIntegrations(sql: Sql): FakeIntegrations {
  const calls: FakeIntegrations['calls'] = { push: [], email: [], frozen: [], deletedUsers: [], groups: new Map(), deletedGroups: [] };
  return {
    calls,
    async sendPush(messages) {
      calls.push.push(...messages);
      return messages.map((m) => ({ token: m.to, ok: !m.to.includes('invalid'), invalidToken: m.to.includes('invalid') }));
    },
    async sendEmail(msg) {
      calls.email.push({ to: msg.to, subject: msg.subject, text: msg.text, tag: msg.tag });
      return { id: `email_${calls.email.length}` };
    },
    chat: {
      async setFrozen(channelId, frozen) {
        calls.frozen.push([channelId, frozen]);
      },
      async deactivateUser() {},
      async deleteUser(userId) {
        calls.deletedUsers.push(userId);
      },
      async deleteMessage() {},
      async syncGroup(channelId, name, members) {
        calls.groups.set(channelId, { name, members: members.map((m) => m.id) });
      },
      async deleteGroup(channelId) {
        calls.deletedGroups.push(channelId);
        calls.groups.delete(channelId);
      }
    },
    revenuecat: null,
    auth: {
      async deleteUser(userId) {
        await sql`delete from auth.users where id = ${userId}`;
      },
      async getEmail(userId) {
        const [u] = await sql`select email from auth.users where id = ${userId}`;
        return u?.email ?? null;
      }
    }
  };
}

export function makeCtx(max = 4): JobContext & { integrations: FakeIntegrations; blobs: MemoryBlobStore } {
  const sql = postgres(DB_URL, { max, prepare: false, onnotice: () => {} }) as unknown as Sql;
  return { sql, blobs: new MemoryBlobStore(), env: testEnv(), integrations: fakeIntegrations(sql), log: () => {} };
}

export async function createUser(sql: Sql, handle: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${handle + '@example.test'})`;
  await sql`update public.profiles set handle = ${handle}, display_name = ${handle} where id = ${id}`;
  return id;
}

export async function grantConsent(sql: Sql, userId: string, kinds: Array<'territory_competition' | 'speed_competition'>) {
  for (const k of kinds) {
    await sql`insert into public.consents (user_id, kind, version, granted) values (${userId}, ${k}, 'test', true)`;
    if (k === 'territory_competition') await sql`update public.user_settings set territory_competition_enabled = true where user_id = ${userId}`;
    else await sql`update public.user_settings set speed_competition_enabled = true where user_id = ${userId}`;
  }
}

/** Runs queued jobs until none are left (only `queues`, when given: test files share one database). */
export async function drain(ctx: JobContext, workerId = 'test-worker', rounds = 50, queues?: string[]) {
  for (let i = 0; i < rounds; i++) {
    const r = await runBatch(ctx, workerId, queues, 20);
    if (r.claimed === 0) return;
  }
}

/** Upload a recorded run exactly as the device does: chunked evidence, then finalize. */
export async function uploadRun(
  ctx: JobContext,
  userId: string,
  samples: LocationSample[],
  events: RecordingEvent[],
  ticket: Awaited<ReturnType<typeof issueTicket>> | null,
  opts: { chunkSize?: number; now?: number } = {}
): Promise<Receipt> {
  const activityId = crypto.randomUUID();
  const size = opts.chunkSize ?? 400;
  let idx = 0;
  for (let i = 0; i < samples.length; i += size) {
    const part = samples.slice(i, i + size);
    const data = serializeSamples(part);
    await storeChunk(ctx.sql, ctx.blobs, userId, { activityId, idx, seqFrom: part[0]!.seq, seqTo: part[part.length - 1]!.seq, digest: await sha256Hex(data), data, startedAt: events[0]!.t });
    idx++;
  }
  return finalizeActivity(
    ctx.sql,
    ctx.blobs,
    ctx.env,
    userId,
    {
      activityId,
      startedAt: events[0]!.t,
      endedAt: events[events.length - 1]!.t,
      events,
      sampleCount: samples.length,
      chunkCount: idx,
      evidenceDigest: await sha256Hex(serializeSamples(samples)),
      device: { platform: 'ios', osVersion: '26', model: 'test', appVersion: '0.1.0' },
      ticket: ticket ? { claims: ticket.claims, signature: ticket.signature } : null
    },
    opts.now
  );
}
