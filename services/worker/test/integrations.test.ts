import { afterAll, describe, expect, it } from 'vitest';
import { circlePath, loopEvents, ORIGIN, samplePath } from '../../../packages/core/test/fixtures.ts';
import { destination, hmacSha256Hex, signStandardWebhook } from '../../../packages/core/src/index.ts';
import { handleAuthEmailHook, handleResendWebhook, handleRevenueCatWebhook, handleStreamWebhook } from '../../../supabase/functions/_shared/api/webhooks.ts';
import { reportMessage, startConversation, type ChatServer } from '../../../supabase/functions/_shared/api/chat.ts';
import { issueTicket } from '../../../supabase/functions/_shared/api/sessions.ts';
import { BUCKETS } from '../../../supabase/functions/_shared/blobs.ts';
import type { Sql } from '../../../supabase/functions/_shared/clients.ts';
import { COMP, createUser, drain, grantConsent, makeCtx, TEST_SECRETS, uploadRun } from './helpers.ts';

const ctx = makeCtx(4);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

const asUser = async <T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> =>
  (ctx.sql as unknown as { begin<R>(cb: (tx: Sql) => Promise<R>): Promise<R> }).begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    return fn(tx);
  });

describe('RevenueCat webhook (authenticated, idempotent, out-of-order safe)', () => {
  const day = 86_400_000;
  const now = Date.now();
  const event = (over: Record<string, unknown>) => JSON.stringify({ api_version: '1.0', event: { entitlement_ids: ['premium'], store: 'APP_STORE', environment: 'SANDBOX', ...over } });

  it('rejects a wrong authorization header', async () => {
    await expect(handleRevenueCatWebhook(ctx.sql, ctx.env, event({ id: 'x', type: 'TEST', app_user_id: 'x', event_timestamp_ms: now }), 'Bearer wrong')).rejects.toMatchObject({ status: 401 });
  });

  it('applies purchases once, ignores duplicates and older events', async () => {
    const u = await createUser(ctx.sql, 'buyer1');
    const purchase = event({ id: 'evt-1', type: 'INITIAL_PURCHASE', app_user_id: u, event_timestamp_ms: now - day, expiration_at_ms: now + 29 * day, product_id: 'monthly' });
    expect(await handleRevenueCatWebhook(ctx.sql, ctx.env, purchase, TEST_SECRETS.rcAuth)).toEqual({ applied: true, duplicate: false });
    expect(await handleRevenueCatWebhook(ctx.sql, ctx.env, purchase, TEST_SECRETS.rcAuth)).toEqual({ applied: false, duplicate: true });
    const stale = event({ id: 'evt-0', type: 'EXPIRATION', app_user_id: u, event_timestamp_ms: now - 2 * day, expiration_at_ms: now - 2 * day });
    await handleRevenueCatWebhook(ctx.sql, ctx.env, stale, TEST_SECRETS.rcAuth);
    const [e] = await ctx.sql`select is_active, status from public.entitlements where user_id = ${u}`;
    expect(e).toMatchObject({ is_active: true, status: 'active' });
    const refund = event({ id: 'evt-2', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: u, event_timestamp_ms: now, expiration_at_ms: now });
    await handleRevenueCatWebhook(ctx.sql, ctx.env, refund, TEST_SECRETS.rcAuth);
    const [r] = await ctx.sql`select is_active, status from public.entitlements where user_id = ${u}`;
    expect(r).toMatchObject({ is_active: false, status: 'refunded' });
  });

  it('never grants entitlements to anonymous RevenueCat ids', async () => {
    const r = await handleRevenueCatWebhook(ctx.sql, ctx.env, event({ id: 'evt-anon', type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc', event_timestamp_ms: now, expiration_at_ms: now + day }), TEST_SECRETS.rcAuth);
    expect(r.applied).toBe(false);
  });
});

describe('Stream Chat: server-side channels, webhook notifications, blocks and reports', () => {
  const fakeChat = (): ChatServer & { created: string[] } => {
    const created: string[] = [];
    return {
      apiKey: 'k',
      created,
      async upsertUser() {},
      createToken: (userId, ttl) => ({ token: `tok-${userId}`, expiresAt: Math.floor(Date.now() / 1000) + ttl }),
      async createChannel(channelId) {
        created.push(channelId);
      },
      async getMessage(id) {
        return { id, text: 'unwanted text', user_id: (globalThis as { __sender?: string }).__sender ?? '', channel_id: (globalThis as { __channel?: string }).__channel ?? '', created_at: new Date().toISOString() };
      },
      async getContext() {
        return [{ id: 'prev', text: 'earlier', user_id: 'x', created_at: '' }];
      }
    };
  };

  it('requires mutual follows by default and creates channels only server-side', async () => {
    const a = await createUser(ctx.sql, 'chat_a');
    const b = await createUser(ctx.sql, 'chat_b');
    const chat = fakeChat();
    await expect(startConversation(ctx.sql, chat, a, b)).rejects.toMatchObject({ status: 403 });
    await ctx.sql`insert into public.follows (follower_id, followee_id, state) values (${a}, ${b}, 'accepted'), (${b}, ${a}, 'accepted')`;
    const conv = await startConversation(ctx.sql, chat, a, b);
    expect(conv.created).toBe(true);
    expect(chat.created).toEqual([conv.channelId]);
    // Stream webhook (HMAC over raw body) creates one safe notification for the recipient.
    const raw = JSON.stringify({ type: 'message.new', channel_id: conv.channelId, message: { id: 'm1', text: 'hello there', user: { id: a } } });
    const headers = new Headers({ 'x-signature': await hmacSha256Hex(TEST_SECRETS.streamSecret, raw), 'x-api-key': TEST_SECRETS.streamKey });
    expect(await handleStreamWebhook(ctx.sql, ctx.env, raw, headers)).toEqual({ handled: true });
    expect(await handleStreamWebhook(ctx.sql, ctx.env, raw, headers)).toEqual({ handled: false });
    const notes = await ctx.sql`select kind, data from public.notifications where user_id = ${b} and category = 'message'`;
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes[0])).not.toContain('hello there');
    await expect(handleStreamWebhook(ctx.sql, ctx.env, raw, new Headers({ 'x-signature': 'bad', 'x-api-key': TEST_SECRETS.streamKey }))).rejects.toMatchObject({ status: 401 });
    // Push delivery: one safe push, never the message text.
    await ctx.sql`insert into public.push_tokens (user_id, token, platform) values (${b}, 'ExponentPushToken[b]', 'ios')`;
    await ctx.sql`update public.notification_prefs set quiet_start = null, quiet_end = null where user_id = ${b}`;
    await ctx.sql`update internal.jobs set run_at = now() where kind = 'push_pending' and status = 'queued'`; // skip the 5 s debounce
    await drain(ctx);
    const pushes = ctx.integrations.calls.push as Array<{ to: string; body: string }>;
    const toB = pushes.filter((p) => p.to === 'ExponentPushToken[b]');
    expect(toB).toHaveLength(1);
    expect(toB[0]!.body).not.toContain('hello there');

    // Report: restricted case with the reported message plus minimal context.
    (globalThis as { __sender?: string }).__sender = a;
    (globalThis as { __channel?: string }).__channel = conv.channelId;
    const rep = await reportMessage(ctx.sql, chat, b, { channelId: conv.channelId, messageId: 'm1', category: 'harassment' });
    expect(rep.reportId).toBeTruthy();
    const [ev] = await ctx.sql`select e.evidence from internal.moderation_evidence e join public.moderation_cases c on c.id = e.case_id where c.object_id = 'm1'`;
    expect((ev!.evidence as { context: unknown[] }).context).toHaveLength(1);

    // Block → server freezes the channel; new conversations are refused.
    await asUser(b, (tx) => tx`select public.block_user(${a}::uuid)`);
    await drain(ctx);
    expect(ctx.integrations.calls.frozen).toContainEqual([conv.channelId, true]);
    await expect(startConversation(ctx.sql, chat, a, b)).rejects.toMatchObject({ status: 403 });
  });
});

describe('Resend and Supabase auth email hook (separate signature schemes)', () => {
  it('suppresses bounced addresses from a signed Svix webhook', async () => {
    const raw = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_1', to: ['Bounce@Example.test'] } });
    const ts = Math.floor(Date.now() / 1000);
    const headers = new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': await signStandardWebhook(raw, 'msg_1', ts, TEST_SECRETS.resendWebhook) });
    expect(await handleResendWebhook(ctx.sql, ctx.env, raw, headers)).toEqual({ handled: true });
    const [s] = await ctx.sql`select count(*)::int as n from internal.email_suppressions where reason = 'bounced'`;
    expect(s!.n).toBe(1);
  });

  it('sends exactly one recovery email with a verification link', async () => {
    const raw = JSON.stringify({
      user: { id: crypto.randomUUID(), email: 'reset@example.test' },
      email_data: { token: '123456', token_hash: 'hash-abc', redirect_to: 'loopfield://reset-password', email_action_type: 'recovery', site_url: 'loopfield://' }
    });
    const ts = Math.floor(Date.now() / 1000);
    const headers = new Headers({ 'webhook-id': 'wh_1', 'webhook-timestamp': String(ts), 'webhook-signature': await signStandardWebhook(raw, 'wh_1', ts, TEST_SECRETS.authHook) });
    const sent: Array<{ to: string; text: string }> = [];
    await handleAuthEmailHook(ctx.env, raw, headers, async (m) => {
      sent.push(m);
      return { id: 'x' };
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('/auth/v1/verify?token=hash-abc&type=recovery');
    await expect(handleAuthEmailHook(ctx.env, raw, new Headers({ 'webhook-id': 'wh_1', 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,bad' }), async () => ({ id: 'x' }))).rejects.toMatchObject({ status: 401 });
  });
});

describe('media pipeline strips location metadata (FR39)', () => {
  it('publishes processed derivatives only', async () => {
    const u = await createUser(ctx.sql, 'photo_runner');
    const created = await asUser(u, async (tx) => (await tx`select public.create_post('public', 'Sunrise loop', null, null, '{}', null, true, 1) as r`)[0]!.r as { post_id: string; upload_slots: Array<{ path: string }> });
    const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
    const jpeg = Uint8Array.from([0xff, 0xd8, ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53]), ...seg(0xdb, new Array(65).fill(1)), ...seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 1, 2, 3, 0xff, 0xd9]);
    await ctx.blobs.put(BUCKETS.uploads, created.upload_slots[0]!.path, jpeg, 'image/jpeg');
    const [before] = await ctx.sql`select status from public.posts where id = ${created.post_id}`;
    expect(before!.status).toBe('processing');
    await asUser(u, (tx) => tx`select public.finalize_post_media(${created.post_id}::uuid, array['Runner at sunrise'])`);
    await drain(ctx);
    const [post] = await ctx.sql`select status from public.posts where id = ${created.post_id}`;
    expect(post!.status).toBe('published');
    const [m] = await ctx.sql`select derivative_path, status, alt_text from public.post_media where post_id = ${created.post_id}`;
    expect(m).toMatchObject({ status: 'ready', alt_text: 'Runner at sunrise' });
    const out = await ctx.blobs.get(BUCKETS.media, m!.derivative_path);
    expect(new TextDecoder('latin1').decode(out!)).not.toContain('Exif');
    expect(await ctx.blobs.get(BUCKETS.uploads, created.upload_slots[0]!.path)).toBeNull();
  });
});

describe('data export (FR09)', () => {
  it('exports only the requester’s own records and never another runner’s route', async () => {
    const owner = await createUser(ctx.sql, 'export_owner');
    const other = await createUser(ctx.sql, 'export_other');
    const start = Date.now() - 4 * 3600_000;
    const own = samplePath(circlePath(destination(ORIGIN, 7000, 90), 240), { startT: start });
    const theirs = samplePath(circlePath(destination(ORIGIN, 7000, 270), 240), { startT: start });
    await uploadRun(ctx, owner, own, loopEvents(own), null);
    await uploadRun(ctx, other, theirs, loopEvents(theirs), null);
    await drain(ctx);
    const [{ id: exportId }] = (await asUser(owner, (tx) => tx`select public.request_data_export() as id`)) as unknown as [{ id: string }];
    await drain(ctx);
    const [row] = await ctx.sql`select status, storage_path, expires_at from public.data_exports where id = ${exportId}`;
    expect(row!.status).toBe('ready');
    expect(new Date(row!.expires_at).getTime()).toBeGreaterThan(Date.now());
    const body = await ctx.blobs.get(BUCKETS.exports, row!.storage_path);
    const data = JSON.parse(new TextDecoder().decode(body!));
    expect(data.profile.id).toBe(owner);
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0].personal_route).toBeTruthy();
    const [theirActivity] = await ctx.sql`select id, personal_route from public.activities where user_id = ${other}`;
    const text = JSON.stringify(data);
    expect(text).not.toContain(theirActivity!.id);
    expect(text).not.toContain(theirActivity!.personal_route);
    expect(data.notes.join(' ')).toMatch(/health data is stored only on your phone/i);
    // Under RLS as the `authenticated` role, only the owner can see the export row.
    const visibleTo = (userId: string) => asUser(userId, async (tx) => {
      await tx`set local role authenticated`;
      return tx`select id from public.data_exports where id = ${exportId}`;
    });
    expect(await visibleTo(other)).toHaveLength(0);
    expect(await visibleTo(owner)).toHaveLength(1);
  });
});

describe('account deletion (FR23) and consent withdrawal', () => {
  it('withdraws land, removes identity and deletes the auth user', async () => {
    const u = await createUser(ctx.sql, 'leaving_runner');
    await grantConsent(ctx.sql, u, ['territory_competition']);
    const start = Date.now() - 2 * 3600_000;
    const ticket = await issueTicket(ctx.sql, ctx.env, u, { mode: 'territory', competitionId: COMP }, start - 60_000);
    const s = samplePath(circlePath(destination(ORIGIN, 6000, 0), 260), { startT: start });
    await uploadRun(ctx, u, s, loopEvents(s), ticket);
    await drain(ctx);
    const [owned] = await ctx.sql`select count(*)::int as n from internal.cell_control where controller_id = ${u}`;
    expect(owned!.n).toBeGreaterThan(0);
    await asUser(u, (tx) => tx`select public.request_account_deletion('DELETE')`);
    await drain(ctx);
    const [after] = await ctx.sql`select count(*)::int as n from internal.cell_control where controller_id = ${u}`;
    expect(after!.n).toBe(0);
    const [auth] = await ctx.sql`select count(*)::int as n from auth.users where id = ${u}`;
    expect(auth!.n).toBe(0);
    expect(ctx.integrations.calls.deletedUsers).toContain(u);
    expect(ctx.integrations.calls.email.some((e) => e.tag === 'account_deleted')).toBe(true);
    expect(await ctx.blobs.list(BUCKETS.evidence, u)).toEqual([]);
  });
});
