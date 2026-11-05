import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { json, requireMethod } from '../_shared/http.ts';

// Called by the app after purchase/restore: queues authoritative reconciliation from RevenueCat's REST API.
// The client never writes entitlements; it only asks the server to re-check.
serve('billing-sync', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  if (!rt.env.REVENUECAT_SECRET_API_KEY) return json({ queued: false, reason: 'reconciliation_not_configured' }, 202);
  await rt.sql`select internal.enqueue_job('billing', 'reconcile_entitlement', ${rt.sql.json({ user_id: userId })}::jsonb, ${'rc:' + userId})`;
  return json({ queued: true }, 202);
}, { browser: true });
