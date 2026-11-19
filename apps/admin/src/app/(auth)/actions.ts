'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/errors';
import { safeNext } from '@/lib/next-path';

export type FormState = { error: string | null };

const signInSchema = z.object({ email: z.email(), password: z.string().min(1) });

/** Staff sign in with the same email and password they use in the app, then verify with TOTP. */
export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: String(form.get('email') ?? '').trim(), password: form.get('password') });
  if (!parsed.success) return { error: 'Enter your email address and password.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: /invalid login credentials/i.test(error.message) ? 'That email and password do not match.' : friendlyError(error) };
  }
  const next = safeNext(form.get('next'));
  redirect(next ? `/mfa?next=${encodeURIComponent(next)}` : '/mfa');
}

export type Enrollment = { ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string };

/** Starts TOTP enrolment, discarding any earlier unfinished attempt. */
export async function startEnrollment(): Promise<Enrollment> {
  const sb = await supabaseServer();
  const { data: claims } = await sb.auth.getClaims();
  if (!claims?.claims) return { ok: false, error: 'Your session expired. Sign in again.' };
  const { data: factors } = await sb.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Loopfield Console', issuer: 'Loopfield Console' });
  if (error || !data) return { ok: false, error: friendlyError(error) };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifies a 6-digit code; on success the session is raised to aal2 and the console opens. */
export async function verifyCode(factorId: string, code: string, next?: string | null): Promise<{ ok: false; error: string }> {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: 'Enter the 6-digit code from your authenticator app.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) {
    return { ok: false, error: /invalid|expired/i.test(error.message) ? 'That code did not match. Wait for a fresh code and try again.' : friendlyError(error) };
  }
  redirect(safeNext(next) ?? '/overview');
}

export async function signOut(): Promise<void> {
  const sb = await supabaseServer();
  await sb.auth.signOut({ scope: 'local' });
  redirect('/sign-in');
}
