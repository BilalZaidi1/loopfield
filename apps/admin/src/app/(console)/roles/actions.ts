'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export interface RoleInput {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}

export async function saveRole(input: RoleInput, reason: string): Promise<ActionResult> {
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(key)) return { ok: false, error: 'Use 3–32 letters, numbers or underscores for the key, starting with a letter.' };
  return runAction(async () => {
    await rpc('ops_save_role', { p_key: key, p_label: input.label.trim(), p_description: input.description.trim(), p_permissions: input.permissions, p_reason: reason });
    revalidatePath('/roles');
    revalidatePath('/staff');
  }, 'Role saved');
}

export async function deleteRole(key: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_delete_role', { p_key: key, p_reason: reason });
    revalidatePath('/roles');
  }, 'Role deleted');
}
