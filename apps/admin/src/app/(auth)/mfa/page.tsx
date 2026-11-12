import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClaims } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/next-path';
import { signOut } from '../actions';
import { MfaEnroll, MfaVerify } from './mfa-forms';

export const metadata: Metadata = { title: 'Verify' };

/** Every console session is MFA-verified (aal2). First visit enrols an authenticator app. */
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const claims = await getClaims();
  if (!claims) redirect('/sign-in');
  if (claims.aal === 'aal2') redirect(safeNext(next) ?? '/overview');
  const sb = await supabaseServer();
  const { data } = await sb.auth.mfa.listFactors();
  const verified = data?.totp?.find((f) => f.status === 'verified') ?? null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="type-title">{verified ? 'Enter your code' : 'Set up two-step sign-in'}</h1>
        <p className="type-body text-muted">
          {verified
            ? 'Open your authenticator app and enter the 6-digit code for Loopfield Console.'
            : 'The console needs an authenticator app (for example 1Password, Google Authenticator or Authy) on top of your password.'}
        </p>
      </div>
      {verified ? <MfaVerify factorId={verified.id} next={safeNext(next)} /> : <MfaEnroll next={safeNext(next)} />}
      <form action={signOut}>
        <button type="submit" className="type-label text-primary hover:underline">Use a different account</button>
      </form>
    </>
  );
}
