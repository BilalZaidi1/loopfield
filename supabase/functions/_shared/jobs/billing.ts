import {
  applyRevenueCatEvent,
  emptyEntitlement,
  entitlementFromSubscriber,
  entitlementStatus,
  eventEntitlements,
  isEntitled,
  type EntitlementState,
  type RcEvent,
  type RcSubscriberResponse
} from '../core/index.ts';
import type { Sql } from '../clients.ts';
import type { JobHandler } from './context.ts';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

async function loadState(sql: Sql, userId: string, entitlement: string): Promise<EntitlementState> {
  const [r] = await sql`select * from public.entitlements where user_id = ${userId} and entitlement = ${entitlement}`;
  if (!r) return emptyEntitlement(userId, entitlement);
  const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
  return {
    userId,
    entitlement,
    productId: r.product_id,
    store: r.store,
    periodType: r.period_type,
    environment: r.environment,
    expiresAt: ms(r.expires_at),
    graceExpiresAt: ms(r.grace_expires_at),
    willRenew: r.will_renew,
    billingIssueAt: ms(r.billing_issue_at),
    refundedAt: ms(r.refunded_at),
    lifetime: false,
    lastEventMs: Number(r.last_event_ms)
  };
}

export async function saveState(sql: Sql, s: EntitlementState, source: 'webhook' | 'reconciliation', now = Date.now()): Promise<void> {
  const d = (v: number | null) => (v === null ? null : new Date(v));
  await sql`
    insert into public.entitlements (user_id, entitlement, is_active, status, product_id, store, period_type, environment, expires_at, grace_expires_at,
                                     will_renew, billing_issue_at, refunded_at, last_event_ms, source, updated_at)
    values (${s.userId}, ${s.entitlement}, ${isEntitled(s, now)}, ${entitlementStatus(s, now)}, ${s.productId}, ${s.store}, ${s.periodType}, ${s.environment},
            ${d(s.expiresAt)}, ${d(s.graceExpiresAt)}, ${s.willRenew}, ${d(s.billingIssueAt)}, ${d(s.refundedAt)}, ${s.lastEventMs}, ${source}, now())
    on conflict (user_id, entitlement) do update set
      is_active = excluded.is_active, status = excluded.status, product_id = excluded.product_id, store = excluded.store, period_type = excluded.period_type,
      environment = excluded.environment, expires_at = excluded.expires_at, grace_expires_at = excluded.grace_expires_at, will_renew = excluded.will_renew,
      billing_issue_at = excluded.billing_issue_at, refunded_at = excluded.refunded_at, last_event_ms = excluded.last_event_ms, source = excluded.source, updated_at = now()`;
}

/** Apply a verified RevenueCat event idempotently; called by the webhook function and by retries. */
export async function applyEvent(sql: Sql, event: RcEvent, defaultEntitlement: string): Promise<string[]> {
  const affected: string[] = [];
  const entitlements = eventEntitlements(event).length ? eventEntitlements(event) : [defaultEntitlement];
  if (event.type === 'TRANSFER') {
    for (const from of event.transferred_from ?? []) {
      if (!isUuid(from)) continue;
      for (const ent of entitlements) {
        const s = await loadState(sql, from, ent);
        await saveState(sql, { ...s, expiresAt: Math.min(s.expiresAt ?? 0, event.event_timestamp_ms), graceExpiresAt: null, willRenew: false, lastEventMs: event.event_timestamp_ms }, 'webhook');
      }
      affected.push(from);
    }
    // Recipients are reconciled from the REST API (the event itself does not carry their full state).
    for (const to of event.transferred_to ?? []) if (isUuid(to)) affected.push(to);
    return affected;
  }
  const userId = event.app_user_id;
  if (!isUuid(userId)) return affected; // anonymous RevenueCat ids are never trusted for entitlements
  for (const ent of entitlements) {
    const s = await loadState(sql, userId, ent);
    const { state, applied } = applyRevenueCatEvent(s, event);
    if (applied) await saveState(sql, state, 'webhook');
  }
  affected.push(userId);
  return affected;
}

/** Authoritative reconciliation from GET /v1/subscribers/{id} (handles delayed and out-of-order events). */
export const reconcileEntitlement: JobHandler = async (payload, ctx) => {
  const userId = String(payload.user_id ?? '');
  if (!ctx.integrations.revenuecat || !isUuid(userId)) return;
  const body = (await ctx.integrations.revenuecat.getSubscriber(userId)) as RcSubscriberResponse;
  const ent = ctx.env.PREMIUM_ENTITLEMENT_ID;
  await saveState(ctx.sql, entitlementFromSubscriber(userId, ent, body, Date.now()), 'reconciliation');
};

export function revenueCatRestClient(secretKey: string, fetchImpl: typeof fetch = fetch) {
  const base = 'https://api.revenuecat.com/v1/subscribers/';
  return {
    async getSubscriber(appUserId: string) {
      const res = await fetchImpl(base + encodeURIComponent(appUserId), { headers: { Authorization: `Bearer ${secretKey}` } });
      if (!res.ok) throw new Error(`revenuecat ${res.status}`);
      return res.json();
    },
    async deleteSubscriber(appUserId: string) {
      const res = await fetchImpl(base + encodeURIComponent(appUserId), { method: 'DELETE', headers: { Authorization: `Bearer ${secretKey}` } });
      if (!res.ok && res.status !== 404) throw new Error(`revenuecat delete ${res.status}`);
    }
  };
}
