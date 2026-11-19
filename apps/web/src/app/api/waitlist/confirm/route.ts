import { NextResponse, type NextRequest } from 'next/server';
import { addWaitlistContact, waitlistConfig } from '@/lib/resend';
import { createRateLimiter, verifyConfirmToken } from '@/lib/waitlist';

const limit = createRateLimiter(20, 10 * 60 * 1000);

/**
 * Step two: the confirm page posts the signed token here (a POST, so link scanners that open every URL in an
 * email can't confirm on someone's behalf). Only now does the person become a contact.
 */
export async function POST(request: NextRequest) {
  const back = (state: 'confirmed' | 'expired') => NextResponse.redirect(new URL(`/?waitlist=${state}#download`, request.url), 303);
  const config = waitlistConfig();
  if (!config) return back('expired');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!limit(ip)) return back('expired');

  const form = await request.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string') return back('expired');
  const payload = await verifyConfirmToken(token, config.secret);
  if (!payload) return back('expired');

  const ok = await addWaitlistContact(config, payload).catch(() => false);
  return back(ok ? 'confirmed' : 'expired');
}
