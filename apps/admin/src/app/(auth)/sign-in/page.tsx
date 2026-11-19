import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getClaims } from '@/lib/auth';
import { safeNext } from '@/lib/next-path';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const claims = await getClaims();
  if (claims) redirect(claims.aal === 'aal2' ? safeNext(next) ?? '/overview' : `/mfa${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="type-title">Sign in</h1>
        <p className="type-body text-muted">Use the email and password from your Loopfield account.</p>
      </div>
      <SignInForm next={safeNext(next)} />
    </>
  );
}
