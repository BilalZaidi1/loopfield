import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { rpc } from '@/lib/rpc';
import { fixturesEnabled } from '@/lib/fixtures';
import { hasPermission, type Permission } from '@/lib/roles';

export interface StaffContext {
  userId: string;
  email: string | null;
  handle: string;
  displayName: string;
  roles: string[];
  roleLabels: string[];
  permissions: Permission[];
  requireMfa: boolean;
}

interface WhoAmI {
  user_id: string;
  handle: string;
  display_name: string;
  status: string;
  roles: string[];
  role_labels?: string[];
  permissions?: Permission[];
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
    roleLabels: who.role_labels ?? who.roles,
    permissions: who.permissions ?? [],
    requireMfa: who.require_mfa
  };
});

/** Page-level permission gate; staff without it see a clear explanation instead of an error. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!hasPermission(ctx.permissions, permission)) redirect(`/no-access?permission=${permission}`);
  return ctx;
}

/** Whether the signed-in staff member holds a permission (the database checks again on every call). */
export function can(ctx: StaffContext, permission: Permission): boolean {
  return hasPermission(ctx.permissions, permission);
}
