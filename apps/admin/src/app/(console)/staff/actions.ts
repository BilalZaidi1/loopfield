'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';
import { isRole, ROLE_LABEL } from '@/lib/roles';

export async function setStaffRole(userId: string, role: string, grant: boolean): Promise<ActionResult> {
  if (!isRole(role)) return { ok: false, error: 'Unknown role.' };
  return runAction(async () => {
    await rpc('ops_grant_role', { p_user: userId, p_role: role, p_grant: grant });
    revalidatePath('/staff');
  }, `${ROLE_LABEL[role]} ${grant ? 'granted' : 'revoked'}`);
}
