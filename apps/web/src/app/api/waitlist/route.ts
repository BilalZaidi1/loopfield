import { NextResponse, type NextRequest } from 'next/server';
import { site } from '@/config/site';
import { sendConfirmEmail, waitlistConfig } from '@/lib/resend';
import { createRateLimiter, signConfirmToken, waitlistInput } from '@/lib/waitlist';

const limit = createRateLimiter(5, 10 * 60 * 1000);

/** Step one of the double opt-in: validate, rate-limit, email a signed link. Nothing is stored yet. */
export async function POST(request: NextRequest) {
  const config = waitlistConfig();
  if (!config) return NextResponse.json({ error: 'closed' }, { status: 503 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  if (!limit(ip)) return NextResponse.json({ error: 'slow down' }, { status: 429 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  // The honeypot: bots fill in the hidden field and are told it worked.
  if (raw && typeof raw === 'object' && 'website' in raw && typeof raw.website === 'string' && raw.website.length > 0) {
    return NextResponse.json({ ok: true });
  }
  const parsed = waitlistInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { email, city, country, source } = parsed.data;
  const token = await signConfirmToken({ email, city, country, source, iat: Date.now() }, config.secret);
  const link = `${site.url}/waitlist/confirm?token=${encodeURIComponent(token)}`;
  const sent = await sendConfirmEmail(config, email, link).catch(() => false);
  if (!sent) return NextResponse.json({ error: 'failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
