'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export type ModerationAction = 'remove_content' | 'restore_content' | 'warn' | 'suspend_account' | 'reinstate_account' | 'dismiss';

const DONE: Record<ModerationAction, string> = {
  remove_content: 'Content removed',
  restore_content: 'Content restored',
  warn: 'Warning recorded',
  suspend_account: 'Account suspended',
  reinstate_account: 'Account reinstated',
  dismiss: 'Case dismissed'
};

export async function moderate(caseId: string, action: ModerationAction, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_moderate', { p_case: caseId, p_action: action, p_reason: reason });
    revalidatePath('/moderation');
    revalidatePath(`/moderation/${caseId}`);
  }, DONE[action]);
}
