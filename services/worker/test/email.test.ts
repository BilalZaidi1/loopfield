import { afterAll, describe, expect, it } from 'vitest';
import { signStandardWebhook } from '../../../packages/core/src/index.ts';
import { unsubscribe } from '../../../supabase/functions/_shared/api/email.ts';
import { handleAuthEmailHook } from '../../../supabase/functions/_shared/api/webhooks.ts';
import { sha256Hex } from '../../../supabase/functions/_shared/email.ts';
import { sendEmailJob } from '../../../supabase/functions/_shared/jobs/email.ts';
import { pushPending } from '../../../supabase/functions/_shared/jobs/social.ts';
import type { JobRow } from '../../../supabase/functions/_shared/jobs/context.ts';
import { createUser, makeCtx, TEST_SECRETS } from './helpers.ts';

const ctx = makeCtx(4);
afterAll(async () => {
  await (ctx.sql as unknown as { end(): Promise<void> }).end();
});

// attempts counts the current attempt, as claim_jobs returns it.
const job = (attempts = 1): JobRow => ({ id: 0, queue: 'email', kind: 'send_email', payload: {}, attempts, max_attempts: 8 });

/** Queue an outbox row the way the triggers do, then run the send job directly (no shared queue). */
async function send(userId: string, template: string, data: Record<string, unknown>, attempts = 1) {
  const key = `test:${template}:${crypto.randomUUID()}`;
  await ctx.sql`insert into internal.email_outbox (dedupe_key, user_id, template, data) values (${key}, ${userId}, ${template}, ${ctx.sql.json(data as never)})`;
  const before = ctx.integrations.calls.email.length;
  let error: unknown = null;
  await sendEmailJob({ key }, ctx, job(attempts)).catch((e) => (error = e));
  const [row] = await ctx.sql`select status, reason, provider_id from internal.email_outbox where dedupe_key = ${key}`;
  return { row: row!, mail: ctx.integrations.calls.email.length > before ? ctx.integrations.calls.email.at(-1)! : null, error };
}

describe('email outbox: branded, preference-aware, once only', () => {
  it('sends the welcome email with a settings link and no unsubscribe for account email', async () => {
    const u = await createUser(ctx.sql, 'mail_welcome');
    const { row, mail } = await send(u, 'welcome', {});
    expect(row.status).toBe('sent');
    expect(mail!.subject).toBe('Welcome to Loopfield');
    expect(mail!.html).toContain(`${ctx.env.APP_WEB_URL}/settings/notifications`);
    expect(mail!.html).toContain('<meta name="viewport"');
    expect(mail!.html).not.toContain('Stop ');
    expect(mail!.headers).toBeUndefined();
    expect(mail!.text).toContain('Welcome to Loopfield');
  });

  it('adds one-click unsubscribe to optional email and escapes names people typed', async () => {
    const owner = await createUser(ctx.sql, 'mail_owner');
    const guest = await createUser(ctx.sql, 'mail_guest');
    const [club] = await ctx.sql`insert into public.clubs (kind, name, visibility, join_policy, created_by) values ('community', 'Striders <b>East</b>', 'public', 'request', ${owner}) returning id`;
    await ctx.sql`insert into public.club_memberships (club_id, user_id, role, state) values (${club!.id}, ${owner}, 'owner', 'active'), (${club!.id}, ${guest}, 'member', 'invited')`;
    const { row, mail } = await send(guest, 'club_invite', { object_id: club!.id, actor_id: owner });
    expect(row.status).toBe('sent');
    expect(mail!.subject).toContain('mail_owner invited you to Striders <b>East</b>');
    expect(mail!.html).toContain('Striders &lt;b&gt;East&lt;/b&gt;');
    expect(mail!.html).not.toContain('<b>East</b>');
    expect(mail!.headers!['List-Unsubscribe']).toMatch(/\/functions\/v1\/email\/unsubscribe\?t=[A-Za-z0-9_-]+&c=clubs>$/);
    expect(mail!.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail!.html).toContain('Stop community and group emails');

    // Answered invitations are not emailed.
    await ctx.sql`update public.club_memberships set state = 'active' where club_id = ${club!.id} and user_id = ${guest}`;
    expect((await send(guest, 'club_invite', { object_id: club!.id, actor_id: owner })).row).toMatchObject({ status: 'skipped', reason: 'invite_answered' });
  });

  it('re-checks preferences and suppressions at send time', async () => {
    const u = await createUser(ctx.sql, 'mail_prefs');
    await ctx.sql`update public.notification_prefs set email_events = false where user_id = ${u}`;
    expect((await send(u, 'event_results', { name: 'Weekend', rank: 2 })).row).toMatchObject({ status: 'skipped', reason: 'preference' });
    const b = await createUser(ctx.sql, 'mail_bounced');
    await ctx.sql`insert into internal.email_suppressions (email_hash, reason) values (${await sha256Hex('mail_bounced@example.test')}, 'bounced')`;
    const r = await send(b, 'welcome', {});
    expect(r.row).toMatchObject({ status: 'skipped', reason: 'suppressed_bounced' });
    expect(r.mail).toBeNull();
  });

  it('records failures Resend will not accept and retries the rest', async () => {
    const bad = await createUser(ctx.sql, 'reject_me');
    const refused = await send(bad, 'welcome', {});
    expect(refused.row).toMatchObject({ status: 'failed', reason: 'resend_422' });
    expect(refused.error).toBeNull();
    const flaky = await createUser(ctx.sql, 'flaky_inbox');
    const later = await send(flaky, 'welcome', {});
    expect(later.row.status).toBe('queued');
    expect(later.error).toBeTruthy();
    expect((await send(flaky, 'welcome', {}, 7)).row.status).toBe('queued'); // one attempt left
    const last = await send(flaky, 'welcome', {}, 8);
    expect(last.row).toMatchObject({ status: 'failed', reason: 'retries_exhausted' });
  });

  it('summarises a run without heart rate, places or a map', async () => {
    const u = await createUser(ctx.sql, 'mail_runner');
    expect((await send(u, 'run_summary', { activity_id: crypto.randomUUID() })).row).toMatchObject({ status: 'skipped', reason: 'preference' }); // off by default
    await ctx.sql`update public.notification_prefs set email_runs = true where user_id = ${u}`;
    const id = crypto.randomUUID();
    await ctx.sql`insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms, moving_ms, avg_pace_s_per_km)
                  values (${id}, ${u}, now() - interval '1 hour', now() - interval '30 minutes', 'processed', 5000, 1800000, 1740000, 348)`;
    const { mail } = await send(u, 'run_summary', { activity_id: id });
    expect(mail!.subject).toMatch(/^Your run on /);
    expect(mail!.text).toContain('Distance: 5.00 km');
    expect(mail!.text).toContain('Average pace: 5:48 /km');
    expect(mail!.html).toContain(`${ctx.env.APP_WEB_URL}/activities/${id}`);
    expect(`${mail!.text}${mail!.html}`).not.toMatch(/bpm|heart rate|latitude|<img/i);
  });

  it('unsubscribes with the link token alone, never from account email', async () => {
    const u = await createUser(ctx.sql, 'mail_unsub');
    const [t] = await ctx.sql`select internal.email_token(${u}) as token`;
    expect(await unsubscribe(ctx.sql, t!.token as string, 'events')).toBe(true);
    const [p] = await ctx.sql`select email_events from public.notification_prefs where user_id = ${u}`;
    expect(p!.email_events).toBe(false);
    expect(await unsubscribe(ctx.sql, t!.token as string, 'account')).toBe(false);
    expect(await unsubscribe(ctx.sql, 'x'.repeat(32), 'events')).toBe(false);
    expect(await unsubscribe(ctx.sql, null, 'events')).toBe(false);
  });
});

describe('security notices through the auth email hook', () => {
  const hook = async (action: string, extra: Record<string, string> = {}) => {
    const raw = JSON.stringify({
      user: { id: crypto.randomUUID(), email: 'now@example.test' },
      email_data: { token: '', token_hash: '', redirect_to: '', email_action_type: action, site_url: 'loopfield://', ...extra }
    });
    const ts = Math.floor(Date.now() / 1000);
    const id = `wh_${crypto.randomUUID()}`;
    const headers = new Headers({ 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': await signStandardWebhook(raw, id, ts, TEST_SECRETS.authHook) });
    const sent: Array<{ to: string; subject: string; text: string; tag: string }> = [];
    await handleAuthEmailHook(ctx.env, raw, headers, async (m) => {
      sent.push(m);
      return { id: 'x' };
    });
    return sent;
  };

  it('tells the runner their password changed, with what to do if it was not them', async () => {
    const sent = await hook('password_changed_notification');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'now@example.test', subject: 'Your password was changed — Loopfield', tag: 'auth_password_changed_notification' });
    expect(sent[0]!.text).toContain('If this was not you');
  });

  it('warns the old address when the email changes', async () => {
    const sent = await hook('email_changed_notification', { old_email: 'before@example.test' });
    expect(sent[0]!.to).toBe('before@example.test');
    expect(sent[0]!.text).toContain('from before@example.test to now@example.test');
  });

  it('never blocks an auth action it does not know', async () => {
    expect(await hook('something_new_notification')).toEqual([]);
  });
});

describe('push follows the notification policy', () => {
  it("keeps friends' runs in the app until pushes for them are on", async () => {
    const u = await createUser(ctx.sql, 'push_friend');
    const a = await createUser(ctx.sql, 'push_author');
    await ctx.sql`insert into public.push_tokens (user_id, token, platform) values (${u}, ${'ExponentPushToken[' + u.slice(0, 8) + ']'}, 'android')`;
    await ctx.sql`update public.notification_prefs set quiet_start = null, quiet_end = null where user_id = ${u}`;
    await ctx.sql`select internal.notify(${u}::uuid, 'social', 'friend_run', ${a}::uuid, 'post', ${crypto.randomUUID()}, '{}'::jsonb, ${'frun:test:' + u})`;
    await pushPending({ user_id: u }, ctx, job());
    const [n] = await ctx.sql`select push_state from public.notifications where user_id = ${u} and kind = 'friend_run'`;
    expect(n!.push_state).toBe('suppressed');

    await ctx.sql`update public.notification_prefs set friend_runs = true where user_id = ${u}`;
    await ctx.sql`select internal.notify(${u}::uuid, 'social', 'friend_run', ${a}::uuid, 'post', ${crypto.randomUUID()}, '{}'::jsonb, ${'frun:test2:' + u})`;
    await pushPending({ user_id: u }, ctx, job());
    const [m] = await ctx.sql`select push_state from public.notifications where user_id = ${u} and dedupe_key = ${'frun:test2:' + u}`;
    expect(m!.push_state).toBe('sent');
  });
});
