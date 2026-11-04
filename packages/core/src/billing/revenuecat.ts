/**
 * RevenueCat entitlement state (FR28). Webhooks are applied idempotently (by event id) and
 * monotonically (by event timestamp) so duplicate and out-of-order deliveries cannot regress state.
 * When a RevenueCat secret API key is configured, the backend additionally reconciles from the
 * REST subscriber endpoint, which is authoritative.
 */

export type RcEventType =
  | 'TEST'
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'NON_RENEWING_PURCHASE'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'TRANSFER'
  | 'SUBSCRIPTION_EXTENDED'
  | 'TEMPORARY_ENTITLEMENT_GRANT'
  | 'REFUND_REVERSED'
  | string;

export interface RcEvent {
  id: string;
  type: RcEventType;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string | null;
  entitlement_ids?: string[] | null;
  entitlement_id?: string | null;
  period_type?: string | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  event_timestamp_ms: number;
  store?: string | null;
  environment?: 'SANDBOX' | 'PRODUCTION' | string;
  cancel_reason?: string | null;
  expiration_reason?: string | null;
  transferred_from?: string[];
  transferred_to?: string[];
}

export interface EntitlementState {
  userId: string;
  entitlement: string;
  productId: string | null;
  store: string | null;
  periodType: string | null;
  environment: string | null;
  expiresAt: number | null;
  graceExpiresAt: number | null;
  willRenew: boolean;
  billingIssueAt: number | null;
  refundedAt: number | null;
  lifetime: boolean;
  lastEventMs: number;
}

export type EntitlementStatus = 'active' | 'grace' | 'billing_issue' | 'cancelled_active' | 'expired' | 'refunded' | 'none';

export function emptyEntitlement(userId: string, entitlement: string): EntitlementState {
  return {
    userId,
    entitlement,
    productId: null,
    store: null,
    periodType: null,
    environment: null,
    expiresAt: null,
    graceExpiresAt: null,
    willRenew: false,
    billingIssueAt: null,
    refundedAt: null,
    lifetime: false,
    lastEventMs: 0
  };
}

export function isEntitled(s: EntitlementState, now: number): boolean {
  if (s.refundedAt !== null) return false;
  if (s.lifetime) return true;
  if (s.expiresAt !== null && s.expiresAt > now) return true;
  return s.graceExpiresAt !== null && s.graceExpiresAt > now;
}

export function entitlementStatus(s: EntitlementState, now: number): EntitlementStatus {
  if (s.refundedAt !== null) return 'refunded';
  if (s.lastEventMs === 0 && !s.lifetime) return 'none';
  if (s.lifetime) return 'active';
  if (s.expiresAt !== null && s.expiresAt > now) {
    if (s.billingIssueAt) return 'billing_issue';
    return s.willRenew ? 'active' : 'cancelled_active';
  }
  if (s.graceExpiresAt !== null && s.graceExpiresAt > now) return 'grace';
  return 'expired';
}

export function eventEntitlements(e: RcEvent): string[] {
  if (e.entitlement_ids && e.entitlement_ids.length) return e.entitlement_ids;
  if (e.entitlement_id) return [e.entitlement_id];
  return [];
}

/**
 * Apply one event to the state for one (user, entitlement). Older events are ignored for state
 * (but still recorded by the caller for audit).
 */
export function applyRevenueCatEvent(state: EntitlementState, e: RcEvent): { state: EntitlementState; applied: boolean } {
  if (e.type === 'TEST') return { state, applied: false };
  if (e.event_timestamp_ms < state.lastEventMs) return { state, applied: false };
  const s: EntitlementState = { ...state, lastEventMs: e.event_timestamp_ms };
  const set = () => {
    s.productId = e.product_id ?? s.productId;
    s.store = e.store ?? s.store;
    s.periodType = e.period_type ?? s.periodType;
    s.environment = e.environment ?? s.environment;
  };
  switch (e.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
    case 'REFUND_REVERSED':
      set();
      s.expiresAt = e.expiration_at_ms ?? s.expiresAt;
      s.graceExpiresAt = null;
      s.billingIssueAt = null;
      s.refundedAt = null;
      s.willRenew = e.type !== 'TEMPORARY_ENTITLEMENT_GRANT';
      s.lifetime = false;
      break;
    case 'NON_RENEWING_PURCHASE':
      set();
      s.expiresAt = e.expiration_at_ms ?? null;
      s.lifetime = e.expiration_at_ms == null;
      s.willRenew = false;
      s.refundedAt = null;
      break;
    case 'CANCELLATION':
      set();
      s.willRenew = false;
      if (e.cancel_reason === 'CUSTOMER_SUPPORT') {
        // Refund: access ends immediately regardless of the remaining period.
        s.refundedAt = e.event_timestamp_ms;
        s.expiresAt = Math.min(s.expiresAt ?? e.event_timestamp_ms, e.expiration_at_ms ?? e.event_timestamp_ms);
        s.graceExpiresAt = null;
      } else if (e.expiration_at_ms != null) {
        s.expiresAt = e.expiration_at_ms;
      }
      break;
    case 'BILLING_ISSUE':
      set();
      s.billingIssueAt = e.event_timestamp_ms;
      s.graceExpiresAt = e.grace_period_expiration_at_ms ?? null;
      break;
    case 'SUBSCRIPTION_PAUSED':
      set();
      s.willRenew = false;
      break;
    case 'EXPIRATION':
      set();
      s.expiresAt = e.expiration_at_ms ?? e.event_timestamp_ms;
      s.graceExpiresAt = null;
      s.willRenew = false;
      break;
    default:
      return { state, applied: false };
  }
  return { state: s, applied: true };
}

/** Subset of GET /v1/subscribers/{app_user_id} used for reconciliation. */
export interface RcSubscriberResponse {
  subscriber: {
    entitlements: Record<string, { expires_date: string | null; grace_period_expires_date?: string | null; product_identifier: string; purchase_date: string }>;
    subscriptions: Record<
      string,
      {
        expires_date: string | null;
        unsubscribe_detected_at: string | null;
        billing_issues_detected_at: string | null;
        refunded_at?: string | null;
        store: string;
        period_type: string;
        is_sandbox?: boolean;
        grace_period_expires_date?: string | null;
      }
    >;
    non_subscriptions?: Record<string, Array<{ purchase_date: string; store: string }>>;
  };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** Derive authoritative state from the REST subscriber object. */
export function entitlementFromSubscriber(userId: string, entitlement: string, body: RcSubscriberResponse, now: number): EntitlementState {
  const s = emptyEntitlement(userId, entitlement);
  s.lastEventMs = now;
  const ent = body.subscriber.entitlements[entitlement];
  if (!ent) return s;
  const sub = body.subscriber.subscriptions[ent.product_identifier];
  s.productId = ent.product_identifier;
  s.expiresAt = ms(ent.expires_date);
  s.lifetime = ent.expires_date === null && !sub;
  s.graceExpiresAt = ms(ent.grace_period_expires_date ?? sub?.grace_period_expires_date ?? null);
  if (sub) {
    s.store = sub.store;
    s.periodType = sub.period_type;
    s.environment = sub.is_sandbox ? 'SANDBOX' : 'PRODUCTION';
    s.willRenew = sub.unsubscribe_detected_at === null;
    s.billingIssueAt = ms(sub.billing_issues_detected_at);
    s.refundedAt = ms(sub.refunded_at ?? null);
  }
  return s;
}
