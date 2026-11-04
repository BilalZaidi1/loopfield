import { handleStreamWebhook } from '../_shared/api/webhooks.ts';
import { serve } from '../_shared/deno.ts';
import { json, requireMethod } from '../_shared/http.ts';

// Stream Chat webhook (X-Signature HMAC of the raw body). Configure in the Stream dashboard.
serve('stream-webhook', async (req, rt) => {
  requireMethod(req, 'POST');
  const raw = await req.text();
  return json(await handleStreamWebhook(rt.sql, rt.env, raw, req.headers));
});
