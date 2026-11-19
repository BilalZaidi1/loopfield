import { afterEach, describe, expect, it, vi } from 'vitest';
import { addWaitlistContact } from './resend';

vi.mock('server-only', () => ({}));

const config = { apiKey: 're_test', segmentId: 'seg_123', from: 'Loopfield <hello@example.com>', secret: 'a-test-secret-that-is-long-enough-123' };

describe('waitlist contact', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Resend fails the whole call on a custom property that was never created, and wants segments as { id } objects.
  it('sends only the email, in the waitlist segment', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await addWaitlistContact(config, 'runner@example.com')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.resend.com/contacts');
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'runner@example.com', unsubscribed: false, segments: [{ id: 'seg_123' }] });
  });

  it('reports a refused contact as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('{}', { status: 422 })));
    expect(await addWaitlistContact(config, 'runner@example.com')).toBe(false);
  });
});
