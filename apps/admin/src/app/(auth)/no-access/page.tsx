import type { Metadata } from 'next';
import Link from 'next/link';
import { isRole, ROLE_LABEL } from '@/lib/roles';
import { signOut } from '../actions';

export const metadata: Metadata = { title: 'Staff only' };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const needed = role && isRole(role) ? ROLE_LABEL[role] : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="type-title">Staff only</h1>
        <p className="type-body text-muted">
          {needed
            ? `This page needs the ${needed} role. Ask an admin to grant it from Staff.`
            : 'Your account has no staff role. Ask an admin to grant one from Staff.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {needed ? <Link href="/overview" className="type-label text-primary hover:underline">Back to overview</Link> : null}
        <form action={signOut}>
          <button type="submit" className="type-label text-primary hover:underline">Sign out</button>
        </form>
      </div>
    </>
  );
}
