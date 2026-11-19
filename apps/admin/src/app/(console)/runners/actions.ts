'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

const done = (id: string) => {
  revalidatePath(`/runners/${id}`);
  revalidatePath('/runners');
};

export async function setRunnerStatus(id: string, status: 'active' | 'suspended', signOut: boolean, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_set_user_status', { p_user: id, p_status: status, p_reason: reason, p_sign_out: signOut });
    done(id);
  }, status === 'suspended' ? 'Runner suspended' : 'Runner reinstated');
}

export async function signOutRunner(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc<number>('ops_sign_out_user', { p_user: id, p_reason: reason });
    done(id);
  }, 'Signed out on every device. Open sessions end within the hour.');
}

export async function resetRunnerProfile(id: string, fields: string[], reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_reset_profile', { p_user: id, p_fields: fields, p_reason: reason });
    done(id);
  }, 'Profile fields reset');
}
