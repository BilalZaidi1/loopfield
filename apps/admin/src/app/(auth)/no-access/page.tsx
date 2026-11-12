import type { Metadata } from 'next';
import Link from 'next/link';
import { isPermission, PERMISSION_LABEL } from '@/lib/roles';
import { signOut } from '../actions';

export const metadata: Metadata = { title: 'Staff only' };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ permission?: string }> }) {
  const { permission } = await searchParams;
  const needed = permission && isPermission(permission) ? PERMISSION_LABEL[permission] : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="type-title">Staff only</h1>
        <p className="type-body text-muted">
          {needed
            ? `This page needs the “${needed}” permission. Ask an admin to give you a role that includes it (Staff, or Roles and permissions).`
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
