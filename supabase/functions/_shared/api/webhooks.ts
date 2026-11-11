import {
  scrubText,
  verifyRevenueCatAuthorization,
  verifyStandardWebhook,
  verifyStreamWebhook,
  type RcEvent
} from '../core/index.ts';
import type { Sql } from '../clients.ts';
import { AUTH_NOTIFICATION_ACTIONS, authEmail, isAuthEmailAction, sha256Hex, type AuthEmailAction, type EmailMessage } from '../email.ts';
import { requireKeys, type ServerEnv } from '../env.ts';
import { HttpError } from '../http.ts';
import { applyEvent } from '../jobs/billing.ts';

/** Stream Chat webhook → safe in-app notification + single push path (no message text stored). */
export async function handleStreamWebhook(sql: Sql, env: ServerEnv, raw: string, headers: Headers): Promise<{ handled: boolean }> {
  const cfg = requireKeys(env, ['STREAM_API_KEY', 'STREAM_API_SECRET']);
  const ok = await verifyStreamWebhook(raw, { signature: headers.get('x-signature'), apiKey: headers.get('x-api-key') }, { apiKey: cfg.STREAM_API_KEY, apiSecret: cfg.STREAM_API_SECRET });
  if (!ok) throw new HttpError(401, 'invalid_signature');
  const event = JSON.parse(raw) as { type: string; channel_id?: string; message?: { id: string; user?: { id: string } }; user?: { id: string } };
  if (event.type !== 'message.new' || !event.message?.id || !event.channel_id) return { handled: false };
  const inserted = await sql`insert into internal.webhook_events (provider, event_id, event_type) values ('stream', ${event.message.id}, ${event.type}) on conflict do nothing returning event_id`;
  if (!inserted.length) return { handled: false }; // duplicate delivery
  const sender = event.message.user?.id ?? event.user?.id;
  const [conv] = await sql`select id, member_a, member_b, frozen from public.conversations where channel_id = ${event.channel_id}`;
  if (!conv || !sender || conv.frozen) return { handled: false };
  const recipient = conv.member_a === sender ? conv.member_b : conv.member_a;
  await sql`select internal.notify(${recipient}::uuid, 'message', 'message', ${sender}::uuid, 'conversation', ${conv.id}::text,
                                   ${sql.json({ channel_id: event.channel_id })}::jsonb, ${'msg:' + event.message.id})`;
  return { handled: true };
}

/** RevenueCat webhook: authorization header, idempotent by event id, monotonic per entitlement, then REST reconciliation. */
export async function handleRevenueCatWebhook(sql: Sql, env: ServerEnv, raw: string, authorization: string | null): Promise<{ applied: boolean; duplicate: boolean }> {
  const cfg = requireKeys(env, ['REVENUECAT_WEBHOOK_AUTH']);
  if (!verifyRevenueCatAuthorization(authorization, cfg.REVENUECAT_WEBHOOK_AUTH)) throw new HttpError(401, 'unauthorized');
  const { event } = JSON.parse(raw) as { event: RcEvent };
  if (!event?.id || !event.type) throw new HttpError(400, 'invalid_event');
  const inserted = await sql`
    insert into internal.billing_events (event_id, app_user_id, type, event_timestamp_ms, environment, payload)
    values (${event.id}, ${event.app_user_id ?? ''}, ${event.type}, ${event.event_timestamp_ms ?? 0}, ${event.environment ?? null},
            ${sql.json({ ...event, subscriber_attributes: undefined } as never)})
    on conflict (event_id) do nothing returning event_id`;
  if (!inserted.length) return { applied: false, duplicate: true };
  const affected = await applyEvent(sql, event, env.PREMIUM_ENTITLEMENT_ID);
  if (env.REVENUECAT_SECRET_API_KEY) {
    for (const userId of affected) {
      await sql`select internal.enqueue_job('billing', 'reconcile_entitlement', ${sql.json({ user_id: userId })}::jsonb, ${'rc:' + userId}, now() + interval '5 seconds')`;
    }
  }
  await sql`update internal.billing_events set status = ${affected.length ? 'applied' : 'ignored'}, processed_at = now() where event_id = ${event.id}`;
  return { applied: affected.length > 0, duplicate: false };
}

/** Resend delivery webhook (Svix signatures): bounces and complaints become suppressions. */
export async function handleResendWebhook(sql: Sql, env: ServerEnv, raw: string, headers: Headers): Promise<{ handled: boolean }> {
  const cfg = requireKeys(env, ['RESEND_WEBHOOK_SECRET']);
  const ok = await verifyStandardWebhook(raw, { id: headers.get('svix-id'), timestamp: headers.get('svix-timestamp'), signature: headers.get('svix-signature') }, cfg.RESEND_WEBHOOK_SECRET);
  if (!ok) throw new HttpError(401, 'invalid_signature');
  const evt = JSON.parse(raw) as { type: string; data?: { email_id?: string; to?: string[] } };
  const inserted = await sql`insert into internal.webhook_events (provider, event_id, event_type) values ('resend', ${headers.get('svix-id')!}, ${evt.type}) on conflict do nothing returning event_id`;
  if (!inserted.length) return { handled: false };
  const status = ({ 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained' } as Record<string, string>)[evt.type];
  if (status && evt.data?.email_id) await sql`update internal.email_log set status = ${status}, updated_at = now() where provider_id = ${evt.data.email_id}`;
  if ((evt.type === 'email.bounced' || evt.type === 'email.complained') && evt.data?.to?.length) {
    for (const to of evt.data.to) {
      await sql`insert into internal.email_suppressions (email_hash, reason) values (${await sha256Hex(to.toLowerCase())}, ${evt.type === 'email.bounced' ? 'bounced' : 'complained'})
                on conflict (email_hash) do nothing`;
    }
  }
  return { handled: true };
}

interface AuthHookPayload {
  user: { id: string; email: string; new_email?: string };
  email_data: {
    token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string; token_new?: string; token_hash_new?: string;
    /** Security notifications (password, email, phone, sign-in method and verification method changes). */
    old_email?: string; old_phone?: string; provider?: string; factor_type?: string;
  };
}

/**
 * Supabase Send Email Hook → Resend. This is the only auth-email path (no SMTP configured), so each
 * auth email is sent exactly once; the Standard Webhooks signature is verified first.
 */
export async function handleAuthEmailHook(env: ServerEnv, raw: string, headers: Headers, send: (m: EmailMessage) => Promise<{ id: string }>): Promise<void> {
  const cfg = requireKeys(env, ['SEND_EMAIL_HOOK_SECRET']);
  const ok = await verifyStandardWebhook(raw, { id: headers.get('webhook-id'), timestamp: headers.get('webhook-timestamp'), signature: headers.get('webhook-signature') }, cfg.SEND_EMAIL_HOOK_SECRET);
  if (!ok) throw new HttpError(401, 'invalid_signature');
  const { user, email_data: d } = JSON.parse(raw) as AuthHookPayload;
  if (!isAuthEmailAction(d.email_action_type)) {
    // Never block an auth operation on an email type this version does not know; log it for follow-up.
    console.warn(`auth email hook: unhandled action ${scrubText(d.email_action_type)}`);
    return;
  }
  const action: AuthEmailAction = d.email_action_type;
  if (AUTH_NOTIFICATION_ACTIONS.includes(action)) {
    // Security notices go to the address that could be losing control: the old one after an email change.
    const to = action === 'email_changed_notification' && d.old_email ? d.old_email : user.email;
    const content = authEmail(env.APP_NAME, action, { url: null, token: '', oldEmail: d.old_email, newEmail: user.email, provider: d.provider, factorType: d.factor_type });
    const key = headers.get('webhook-id') ?? `${user.id}:${action}:${Math.floor(Date.now() / 60_000)}`;
    await send({ to, ...content, tag: `auth_${action}`, idempotencyKey: `auth-${await sha256Hex(key + action)}` });
    return;
  }
  const verifyUrl = (hash: string, type: string) =>
    `${env.SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(d.redirect_to || d.site_url)}`;
  const messages: Array<{ to: string; action: AuthEmailAction; url: string | null; token: string; key: string }> = [];
  if (action === 'email_change' && user.new_email) {
    // Secure email change: confirm on both the current and the new address.
    messages.push({ to: user.email, action: 'email_change', url: verifyUrl(d.token_hash_new ?? d.token_hash, 'email_change'), token: d.token, key: d.token_hash });
    messages.push({ to: user.new_email, action: 'email_change_new', url: verifyUrl(d.token_hash, 'email_change'), token: d.token_new ?? d.token, key: d.token_hash + ':new' });
  } else {
    const type = action === 'signup' ? 'signup' : action;
    messages.push({ to: user.email, action, url: action === 'reauthentication' ? null : verifyUrl(d.token_hash, type), token: d.token, key: d.token_hash || d.token });
  }
  for (const m of messages) {
    const content = authEmail(env.APP_NAME, m.action, { url: m.url, token: m.token });
    await send({ to: m.to, ...content, tag: `auth_${m.action}`, idempotencyKey: `auth-${await sha256Hex(m.key + m.action)}` });
  }
}

export const safeLog = (msg: string) => console.log(scrubText(msg));
