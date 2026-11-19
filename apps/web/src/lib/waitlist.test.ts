import { describe, expect, it } from 'vitest';
import { createRateLimiter, signConfirmToken, verifyConfirmToken, waitlistInput } from './waitlist';

const secret = 'a-test-secret-that-is-long-enough-123';
const payload = { email: 'runner@example.com', city: 'Lisbon', country: 'PT', source: 'final', iat: 1_000_000 };

describe('confirmation tokens', () => {
  it('round-trip', async () => {
    const token = await signConfirmToken(payload, secret);
    expect(await verifyConfirmToken(token, secret, 1_000_500)).toEqual(payload);
  });
  it('reject a changed payload, a wrong secret or an old token', async () => {
    const token = await signConfirmToken(payload, secret);
    const [, sig] = token.split('.');
    const forged = `${btoa(JSON.stringify({ ...payload, email: 'x@example.com' })).replace(/=+$/, '')}.${sig}`;
    expect(await verifyConfirmToken(forged, secret, 1_000_500)).toBeNull();
    expect(await verifyConfirmToken(token, 'another-secret-that-is-long-enough-456', 1_000_500)).toBeNull();
    expect(await verifyConfirmToken(token, secret, 1_000_000 + 8 * 24 * 3600 * 1000)).toBeNull();
    expect(await verifyConfirmToken('garbage', secret)).toBeNull();
  });
  it('refuse a short secret', async () => {
    await expect(signConfirmToken(payload, 'short')).rejects.toThrow();
  });
});

describe('waitlist input', () => {
  it('needs an email and consent, and an empty honeypot', () => {
    expect(waitlistInput.safeParse({ email: 'runner@example.com', consent: true }).success).toBe(true);
    expect(waitlistInput.safeParse({ email: 'nope', consent: true }).success).toBe(false);
    expect(waitlistInput.safeParse({ email: 'runner@example.com', consent: false }).success).toBe(false);
    expect(waitlistInput.safeParse({ email: 'runner@example.com', consent: true, website: 'spam' }).success).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows the limit per window', () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 10)).toBe(true);
    expect(allow('a', 20)).toBe(false);
    expect(allow('b', 20)).toBe(true);
    expect(allow('a', 1001)).toBe(true);
  });
});
