import { handleResendWebhook } from '../_shared/api/webhooks.ts';
import { serve } from '../_shared/deno.ts';
import { json, requireMethod } from '../_shared/http.ts';

// Resend delivery events (Svix signature headers).
serve('resend-webhook', async (req, rt) => {
  requireMethod(req, 'POST');
  const raw = await req.text();
  return json(await handleResendWebhook(rt.sql, rt.env, raw, req.headers));
});
