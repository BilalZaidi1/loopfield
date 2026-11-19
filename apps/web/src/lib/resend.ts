import 'server-only';

/**
 * The waitlist's two calls to Resend: the confirmation email, and the contact (in the waitlist segment) once the
 * link is tapped. Configured with RESEND_API_KEY, RESEND_SEGMENT_ID, WAITLIST_FROM and WAITLIST_SECRET.
 */
export interface WaitlistConfig {
  apiKey: string;
  segmentId: string;
  from: string;
  secret: string;
}

export function waitlistConfig(): WaitlistConfig | null {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const segmentId = process.env.RESEND_SEGMENT_ID ?? '';
  const from = process.env.WAITLIST_FROM ?? '';
  const secret = process.env.WAITLIST_SECRET ?? '';
  if (!apiKey || !segmentId || !from || secret.length < 32) return null;
  return { apiKey, segmentId, from, secret };
}

async function resend(path: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function sendConfirmEmail(config: WaitlistConfig, to: string, link: string): Promise<boolean> {
  const safe = escapeHtml(link);
  const html = `<!doctype html><html><body style="margin:0;background:#101114;font-family:Helvetica,Arial,sans-serif;color:#F5F6FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="100%" style="max-width:480px;background:#1C1D22;border-radius:24px" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 32px">
<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8B87FF">Loopfield</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.1;font-style:italic;font-weight:900;text-transform:uppercase">Confirm your spot</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:24px;color:#A3A7B5">Tap the button to join the waitlist. We’ll email you when Loopfield opens where you run.</p>
<a href="${safe}" style="display:inline-block;background:#6762F0;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 28px;border-radius:999px">Confirm my spot</a>
<p style="margin:28px 0 0;font-size:13px;line-height:19px;color:#7A7E8C">Didn’t ask for this? Ignore this email: nothing is saved until you confirm.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Confirm your spot on the Loopfield waitlist:\n${link}\n\nDidn't ask for this? Ignore this email: nothing is saved until you confirm.`;
  const res = await resend('/emails', config.apiKey, { from: config.from, to: [to], subject: 'Confirm your spot on the Loopfield waitlist', html, text });
  return res.ok;
}

/** Adds the confirmed person to the waitlist segment. A contact that already exists counts as done. */
export async function addWaitlistContact(config: WaitlistConfig, contact: { email: string; city: string; country: string; source: string }): Promise<boolean> {
  const res = await resend('/contacts', config.apiKey, {
    email: contact.email,
    unsubscribed: false,
    properties: { city: contact.city, country: contact.country, source: contact.source },
    segments: [config.segmentId]
  });
  return res.ok || res.status === 409;
}
