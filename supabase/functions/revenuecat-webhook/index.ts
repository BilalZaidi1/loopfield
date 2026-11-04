import { handleRevenueCatWebhook } from '../_shared/api/webhooks.ts';
import { serve } from '../_shared/deno.ts';
import { json, requireMethod } from '../_shared/http.ts';

// RevenueCat webhook (Authorization header value configured in the RevenueCat dashboard).
serve('revenuecat-webhook', async (req, rt) => {
  requireMethod(req, 'POST');
  const raw = await req.text();
  return json(await handleRevenueCatWebhook(rt.sql, rt.env, raw, req.headers.get('authorization')));
});
