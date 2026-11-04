import { describe, expect, it } from 'vitest';
import { sanitizeEvent, areaBucket, isForbiddenKey } from '../src/analytics/events.ts';
import { scrubSentryEvent, scrubText } from '../src/observability/scrub.ts';
import {
  hmacSha256Hex,
  signStandardWebhook,
  verifyRevenueCatAuthorization,
  verifyStandardWebhook,
  verifyStreamWebhook
} from '../src/webhooks/verify.ts';
import { checkTicketTiming, signTicket, verifyTicket } from '../src/tickets.ts';
import { applyRevenueCatEvent, emptyEntitlement, entitlementFromSubscriber, entitlementStatus, isEntitled, type RcEvent } from '../src/billing/revenuecat.ts';
import { jpegDimensions, stripJpegMetadata, UnsupportedImageError } from '../src/media/jpeg.ts';
import { canStartConversation, canViewPost, dmChannelId, extractContentLinks, extractMentions } from '../src/social/policy.ts';
import { DEFAULT_PREFS, inQuietHours, safePushPreview } from '../src/notifications/policy.ts';
import type { SessionTicketClaims } from '../src/recording/types.ts';

describe('analytics allowlist (PRD §13, FR52)', () => {
  it('drops unknown, sensitive and malformed properties', () => {
    const r = sanitizeEvent('run_saved', {
      activity_id: 'act_12345678',
      mode: 'territory',
      duration_bucket: '30-60m',
      distance_bucket: '5-10km',
      had_gap: false,
      lat: 24.86,
      heart_rate: 150,
      note: 'my secret route'
    } as Record<string, unknown>);
    expect(r.properties).toEqual({ activity_id: 'act_12345678', mode: 'territory', duration_bucket: '30-60m', distance_bucket: '5-10km', had_gap: false });
    expect(r.dropped.sort()).toEqual(['heart_rate', 'lat', 'note']);
  });

  it('rejects values that are not in the declared buckets', () => {
    const r = sanitizeEvent('loop_evaluated', { claim_id: 'claim_123456', area_bucket: '0.37 km2' } as Record<string, unknown>);
    expect(r.properties).toEqual({ claim_id: 'claim_123456' });
  });

  it('never accepts health readings for health_viewed', () => {
    const r = sanitizeEvent('health_viewed', { screen: 'dashboard', session_count: 3, resting_hr: 52 } as Record<string, unknown>);
    expect(r.properties).toEqual({ screen: 'dashboard', session_count: 3 });
    expect(isForbiddenKey('resting_hr')).toBe(true);
    expect(areaBucket(0)).toBe('0');
  });

  it('throws on undeclared events', () => {
    expect(() => sanitizeEvent('raw_gps_dump' as never, {})).toThrow();
  });
});

describe('crash/log scrubbing', () => {
  it('redacts tokens, emails and coordinates in text', () => {
    const s = scrubText('user a@b.com at 24.860712, 67.001123 with Bearer abc.def.ghi and key sk_live_ABCDEFGHIJKLMNOP');
    expect(s).not.toMatch(/a@b\.com|24\.860712|abc\.def|sk_live/);
  });

  it('removes sensitive keys, request bodies and user details from events', () => {
    const e = scrubSentryEvent({
      message: 'failed for x@y.io',
      user: { id: 'u1', email: 'x@y.io', ip_address: '1.2.3.4' },
      request: { url: 'https://api/x?token=abc', method: 'POST', data: '{"lat":1}' },
      extra: { samples: [{ lat: 1, lng: 2 }], heart_rate: 140, body: 'hello', ok: 'fine' },
      breadcrumbs: [{ category: 'fetch', data: { url: 'https://x/y?access_token=zzz', request_body: 'secret' } }]
    });
    expect(e.user).toEqual({ id: 'u1' });
    expect(e.request).toEqual({ method: 'POST', url: 'https://api/x' });
    expect(e.extra).toEqual({ samples: '[redacted]', heart_rate: '[redacted]', body: '[redacted]', ok: 'fine' });
    expect(JSON.stringify(e.breadcrumbs)).not.toContain('secret');
    expect(JSON.stringify(e.breadcrumbs)).not.toContain('zzz');
    expect(e.message).toBe('failed for [email]');
  });
});

describe('webhook authentication schemes', () => {
  it('verifies Stream signatures over the raw body with the API key', async () => {
    const body = '{"type":"message.new"}';
    const sig = await hmacSha256Hex('stream-secret', body);
    expect(await verifyStreamWebhook(body, { signature: sig, apiKey: 'key' }, { apiKey: 'key', apiSecret: 'stream-secret' })).toBe(true);
    expect(await verifyStreamWebhook(body + ' ', { signature: sig, apiKey: 'key' }, { apiKey: 'key', apiSecret: 'stream-secret' })).toBe(false);
    expect(await verifyStreamWebhook(body, { signature: sig, apiKey: 'other' }, { apiKey: 'key', apiSecret: 'stream-secret' })).toBe(false);
  });

  it('verifies RevenueCat authorization header exactly', () => {
    expect(verifyRevenueCatAuthorization('Bearer s3cr3t', 'Bearer s3cr3t')).toBe(true);
    expect(verifyRevenueCatAuthorization('Bearer s3cr3', 'Bearer s3cr3t')).toBe(false);
    expect(verifyRevenueCatAuthorization(null, 'Bearer s3cr3t')).toBe(false);
  });

  it('verifies Standard Webhooks / Svix signatures with timestamp tolerance', async () => {
    const secret = 'whsec_' + btoa('0123456789abcdef0123456789abcdef');
    const body = '{"user":{"id":"x"}}';
    const ts = 1_800_000_000;
    const signature = await signStandardWebhook(body, 'msg_1', ts, secret);
    expect(await verifyStandardWebhook(body, { id: 'msg_1', timestamp: String(ts), signature }, secret, ts + 10)).toBe(true);
    expect(await verifyStandardWebhook(body, { id: 'msg_1', timestamp: String(ts), signature }, `v1,${secret}`, ts + 10)).toBe(true);
    expect(await verifyStandardWebhook(body, { id: 'msg_1', timestamp: String(ts), signature }, secret, ts + 1000)).toBe(false);
    expect(await verifyStandardWebhook(body, { id: 'msg_2', timestamp: String(ts), signature }, secret, ts + 10)).toBe(false);
  });
});

describe('session tickets', () => {
  const claims: SessionTicketClaims = {
    ticketId: 't1',
    userId: 'u1',
    modes: { territory: true, speed: false },
    competitionId: 'c1',
    seasonId: 's1',
    courseVersionId: null,
    territoryRulesVersion: 'territory-x',
    speedRulesVersion: 'speed-x',
    issuedAt: 1000,
    startBy: 1000 + 6 * 3_600_000
  };
  const secret = 'x'.repeat(40);

  it('signs canonically and detects tampering', async () => {
    const sig = await signTicket(claims, secret);
    expect(await verifyTicket({ ...claims }, sig, secret)).toBe(true);
    expect(await verifyTicket({ ...claims, modes: { territory: true, speed: true } }, sig, secret)).toBe(false);
  });

  it('rejects intervals that start before issue or after the start window', () => {
    expect(checkTicketTiming(claims, 500, 0)).toEqual({ ok: false, reason: 'ticket_invalid' });
    expect(checkTicketTiming(claims, claims.startBy + 1, 0)).toEqual({ ok: false, reason: 'ticket_expired' });
    expect(checkTicketTiming(claims, 2000, 0)).toEqual({ ok: true });
  });
});

describe('RevenueCat entitlements (FR28)', () => {
  const day = 86_400_000;
  const base = (over: Partial<RcEvent>): RcEvent => ({ id: 'e', type: 'INITIAL_PURCHASE', app_user_id: 'u1', event_timestamp_ms: 1, ...over });

  it('ignores duplicate/older events and applies newer ones', () => {
    let s = emptyEntitlement('u1', 'premium');
    s = applyRevenueCatEvent(s, base({ id: 'e1', event_timestamp_ms: 10 * day, expiration_at_ms: 40 * day })).state;
    const renewal = base({ id: 'e3', type: 'RENEWAL', event_timestamp_ms: 40 * day, expiration_at_ms: 70 * day });
    const expiration = base({ id: 'e2', type: 'EXPIRATION', event_timestamp_ms: 39 * day, expiration_at_ms: 40 * day });
    s = applyRevenueCatEvent(s, renewal).state;
    const late = applyRevenueCatEvent(s, expiration);
    expect(late.applied).toBe(false);
    expect(isEntitled(late.state, 50 * day)).toBe(true);
  });

  it('keeps access during a billing grace period then expires', () => {
    let s = emptyEntitlement('u1', 'premium');
    s = applyRevenueCatEvent(s, base({ event_timestamp_ms: day, expiration_at_ms: 31 * day })).state;
    s = applyRevenueCatEvent(s, base({ type: 'BILLING_ISSUE', event_timestamp_ms: 31 * day, grace_period_expiration_at_ms: 37 * day })).state;
    expect(entitlementStatus(s, 33 * day)).toBe('grace');
    expect(isEntitled(s, 36 * day)).toBe(true);
    expect(isEntitled(s, 38 * day)).toBe(false);
  });

  it('revokes immediately on refund and keeps access until expiry on ordinary cancellation', () => {
    let s = emptyEntitlement('u1', 'premium');
    s = applyRevenueCatEvent(s, base({ event_timestamp_ms: day, expiration_at_ms: 31 * day })).state;
    const cancelled = applyRevenueCatEvent(s, base({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: 5 * day, expiration_at_ms: 31 * day })).state;
    expect(entitlementStatus(cancelled, 10 * day)).toBe('cancelled_active');
    const refunded = applyRevenueCatEvent(s, base({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: 5 * day, expiration_at_ms: 5 * day })).state;
    expect(isEntitled(refunded, 10 * day)).toBe(false);
    expect(entitlementStatus(refunded, 10 * day)).toBe('refunded');
  });

  it('derives state from the REST subscriber object', () => {
    const s = entitlementFromSubscriber(
      'u1',
      'premium',
      {
        subscriber: {
          entitlements: { premium: { expires_date: '2026-12-01T00:00:00Z', product_identifier: 'monthly', purchase_date: '2026-11-01T00:00:00Z' } },
          subscriptions: { monthly: { expires_date: '2026-12-01T00:00:00Z', unsubscribe_detected_at: null, billing_issues_detected_at: null, store: 'app_store', period_type: 'normal', is_sandbox: true } }
        }
      },
      Date.parse('2026-11-04T00:00:00Z')
    );
    expect(isEntitled(s, Date.parse('2026-11-20T00:00:00Z'))).toBe(true);
    expect(s.environment).toBe('SANDBOX');
  });
});

const includesBytes = (hay: Uint8Array, needle: number[]) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

describe('JPEG metadata stripping', () => {
  // Minimal JPEG: SOI, APP0, APP1(Exif with "GPS"), COM, DQT, SOF0 (2x3), SOS, data, EOI.
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53, 1, 2, 3]),
    ...seg(0xfe, [0x68, 0x69]),
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),
    ...seg(0xc0, [8, 0, 3, 0, 2, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0x34, 0xff, 0x00, 0x56,
    0xff, 0xd9
  ]);

  it('removes EXIF/XMP and comments but keeps image data', () => {
    const { bytes, removedSegments } = stripJpegMetadata(jpeg);
    expect(removedSegments).toEqual(['APP1', 'COM']);
    expect(includesBytes(bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false);
    expect(includesBytes(bytes, [0x12, 0x34, 0xff, 0x00, 0x56])).toBe(true);
    expect(jpegDimensions(bytes)).toEqual({ width: 2, height: 3 });
  });

  it('rejects non-JPEG uploads', () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toThrow(UnsupportedImageError);
  });
});

describe('social policy matrix (FR37–FR41)', () => {
  const rel = { viewerFollowsAuthor: false, authorFollowsViewer: false, blockedEitherWay: false, viewerIsClubMember: false };
  const post = { audience: 'followers' as const, authorId: 'a', status: 'published' };

  it('enforces audiences and blocks', () => {
    expect(canViewPost(post, 'v', rel)).toBe(false);
    expect(canViewPost(post, 'v', { ...rel, viewerFollowsAuthor: true })).toBe(true);
    expect(canViewPost({ ...post, audience: 'public' }, 'v', { ...rel, blockedEitherWay: true })).toBe(false);
    expect(canViewPost({ ...post, audience: 'club' }, 'v', { ...rel, viewerFollowsAuthor: true })).toBe(false);
    expect(canViewPost({ ...post, audience: 'only_me' }, 'a', rel)).toBe(true);
  });

  it('defaults messaging to mutual followers and lets blocks win', () => {
    const r = { senderFollowsRecipient: true, recipientFollowsSender: false, blockedEitherWay: false, senderIsRecipient: false };
    expect(canStartConversation('mutual', r).allowed).toBe(false);
    expect(canStartConversation('mutual', { ...r, recipientFollowsSender: true }).allowed).toBe(true);
    expect(canStartConversation('followers', r).allowed).toBe(true);
    expect(canStartConversation('mutual', { ...r, recipientFollowsSender: true, blockedEitherWay: true }).reason).toBe('blocked');
    expect(canStartConversation('nobody', { ...r, recipientFollowsSender: true }).allowed).toBe(false);
  });

  it('parses mentions and internal links without granting access', () => {
    expect(extractMentions('hi @Sara_run and @ali ok @sara_run')).toEqual(['sara_run', 'ali']);
    expect(extractContentLinks('see loopfield://post/0b6f6d5e-3b1a-4f0e-9a43-6c2e6e0d2d11 now')).toEqual([{ kind: 'post', id: '0b6f6d5e-3b1a-4f0e-9a43-6c2e6e0d2d11' }]);
    expect(dmChannelId('b-1', 'a-2')).toBe(dmChannelId('a-2', 'b-1'));
  });
});

describe('notification policy (FR25, FR45)', () => {
  it('applies quiet hours in the user’s time zone, across midnight', () => {
    const prefs = { ...DEFAULT_PREFS, timezone: 'Asia/Karachi' };
    expect(inQuietHours(prefs, new Date('2026-11-04T18:30:00Z'))).toBe(true); // 23:30 PKT
    expect(inQuietHours(prefs, new Date('2026-11-04T06:00:00Z'))).toBe(false); // 11:00 PKT
  });

  it('never includes message text in previews', () => {
    expect(safePushPreview('message', 'Sara')).toEqual({ title: 'New message', body: 'Sara sent you a message' });
  });
});
