import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { rpc } from '@/lib/rpc';
import { fixturesEnabled } from '@/lib/fixtures';
import { hasRole, type Role } from '@/lib/roles';

export interface StaffContext {
  userId: string;
  email: string | null;
  handle: string;
  displayName: string;
  roles: Role[];
  requireMfa: boolean;
}

interface WhoAmI {
  user_id: string;
  handle: string;
  display_name: string;
  status: string;
  roles: Role[];
  require_mfa: boolean;
}

/** Verified JWT claims for this request, or null when signed out. */
export const getClaims = cache(async () => {
  if (fixturesEnabled) return { aal: 'aal2', email: 'staff@example.test', sub: 'fixture' } as const;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  return data?.claims ?? null;
});

/**
 * Gate for every console page: signed in, MFA-verified in this session (aal2) and holding at least one
 * staff role. The database checks roles again on every call; this only decides what to render.
 */
export const requireStaff = cache(async (): Promise<StaffContext> => {
  const claims = await getClaims();
  if (!claims) redirect('/sign-in');
  if (claims.aal !== 'aal2') redirect('/mfa');
  const who = await rpc<WhoAmI | null>('ops_whoami');
  if (!who || who.status !== 'active' || who.roles.length === 0) redirect('/no-access');
  return {
    userId: who.user_id,
    email: typeof claims.email === 'string' ? claims.email : null,
    handle: who.handle,
    displayName: who.display_name,
    roles: who.roles,
    requireMfa: who.require_mfa
  };
});

/** Page-level role gate; staff without the role see a clear explanation instead of an error. */
export async function requireRole(role: Role): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!hasRole(ctx.roles, role)) redirect(`/no-access?role=${role}`);
  return ctx;
}
