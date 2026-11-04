import { requireKeys, type ServerEnv } from './env.ts';

/**
 * Transactional email through Resend's HTTP API (server-side only). Retries transient failures with
 * backoff and uses an Idempotency-Key so a retried job cannot send twice.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
  idempotencyKey: string;
}

export async function sendEmail(env: ServerEnv, msg: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  const cfg = requireKeys(env, ['RESEND_API_KEY', 'RESEND_FROM']);
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': msg.idempotencyKey
      },
      body: JSON.stringify({ from: cfg.RESEND_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, tags: [{ name: 'category', value: msg.tag }] })
    });
    if (res.ok) return (await res.json()) as { id: string };
    lastError = `resend ${res.status}`;
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw new Error(`email send failed: ${lastError}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(appName: string, title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#13201a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1f6f4a">${esc(appName)}</td></tr>
<tr><td style="padding-top:16px;font-size:22px;font-weight:700">${esc(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:16px;line-height:1.5">${bodyHtml}</td></tr>
${cta ? `<tr><td style="padding-top:24px"><a href="${esc(cta.url)}" style="display:inline-block;background:#1f6f4a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(cta.label)}</a></td></tr>` : ''}
<tr><td style="padding-top:28px;font-size:12px;color:#5b6b63;line-height:1.5">You received this because of activity on your ${esc(appName)} account. If this wasn't you, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

export type AuthEmailAction = 'signup' | 'recovery' | 'magiclink' | 'email_change' | 'email_change_new' | 'invite' | 'reauthentication';

/** Templates for the Supabase Send Email Hook (single delivery path for auth email). */
export function authEmail(appName: string, action: AuthEmailAction, opts: { url: string | null; token: string }): { subject: string; html: string; text: string } {
  const code = `<p style="font-size:28px;font-weight:700;letter-spacing:.2em;margin:16px 0">${esc(opts.token)}</p>`;
  const t: Record<AuthEmailAction, [string, string, string]> = {
    signup: ['Confirm your email', 'Confirm your email address to finish creating your account.', 'Confirm email'],
    recovery: ['Reset your password', 'Use the link below to choose a new password. It expires soon and can be used once.', 'Reset password'],
    magiclink: ['Your sign-in link', 'Use the link below to sign in.', 'Sign in'],
    email_change: ['Confirm your email change', 'Confirm that you want to change the email address on your account.', 'Confirm change'],
    email_change_new: ['Confirm your new email', 'Confirm this address for your account.', 'Confirm email'],
    invite: ['You have been invited', 'You have been invited to create an account.', 'Accept invitation'],
    reauthentication: ['Confirm it is you', 'Enter this code in the app to continue.', '']
  };
  const [subject, sentence, label] = t[action];
  const body = `<p>${esc(sentence)}</p>${action === 'reauthentication' || !opts.url ? code : `<p>Or enter this code in the app:</p>${code}`}`;
  return {
    subject: `${subject} — ${appName}`,
    html: layout(appName, subject, body, opts.url && label ? { label, url: opts.url } : undefined),
    text: `${subject}\n\n${sentence}\n\n${opts.url ? `${opts.url}\n\n` : ''}Code: ${opts.token}\n`
  };
}

export function clubInvitationEmail(appName: string, clubName: string, inviter: string, url: string) {
  const subject = `${inviter} invited you to ${clubName}`;
  return {
    subject: `${subject} — ${appName}`,
    html: layout(appName, subject, `<p>${esc(inviter)} invited you to join <strong>${esc(clubName)}</strong> on ${esc(appName)}. Joining is optional and you can leave at any time.</p>`, { label: 'View invitation', url }),
    text: `${subject}\n\nJoining is optional and you can leave at any time.\n\n${url}\n`
  };
}

export function exportReadyEmail(appName: string, url: string) {
  return {
    subject: `Your data export is ready — ${appName}`,
    html: layout(appName, 'Your data export is ready', '<p>Open the app to download your export. The download link expires after 72 hours.</p>', { label: 'Open the app', url }),
    text: `Your data export is ready. Open the app to download it. The link expires after 72 hours.\n${url}\n`
  };
}

export function accountDeletedEmail(appName: string) {
  return {
    subject: `Your account was deleted — ${appName}`,
    html: layout(appName, 'Your account was deleted', '<p>Your account and associated data have been deleted as requested. Data held on your phone by the app was cleared when you signed out or removed the app. Records in Apple Health or Health Connect are not deleted by us.</p>'),
    text: 'Your account and associated data have been deleted as requested. Records in Apple Health or Health Connect are not deleted by us.\n'
  };
}

export const ensureConfigured = (env: ServerEnv) => requireKeys(env, ['RESEND_API_KEY', 'RESEND_FROM']);
