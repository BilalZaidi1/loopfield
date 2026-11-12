'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';
import { roleLabel } from '@/lib/roles';

/** Grant or revoke a role. The database refuses anything beyond the granter's own permissions. */
export async function setStaffRole(userId: string, role: string, grant: boolean): Promise<ActionResult> {
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(role)) return { ok: false, error: 'Unknown role.' };
  return runAction(async () => {
    await rpc('ops_grant_role', { p_user: userId, p_role: role, p_grant: grant });
    revalidatePath('/staff');
    revalidatePath('/roles');
  }, `${roleLabel(role)} ${grant ? 'granted' : 'removed'}`);
}
