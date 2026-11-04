import { handleAuthEmailHook } from '../_shared/api/webhooks.ts';
import { serve } from '../_shared/deno.ts';
import { sendEmail } from '../_shared/email.ts';
import { json, requireMethod } from '../_shared/http.ts';

// Supabase Auth "Send Email" hook → Resend. Enable in Auth > Hooks; do not also configure SMTP.
serve('auth-email-hook', async (req, rt) => {
  requireMethod(req, 'POST');
  const raw = await req.text();
  await handleAuthEmailHook(rt.env, raw, req.headers, (m) => sendEmail(rt.env, m));
  return json({});
});
