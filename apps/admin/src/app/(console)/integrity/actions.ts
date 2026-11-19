'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export type Resolution = 'upheld' | 'overturned' | 'invalidated' | 'no_action';

export async function setHold(caseId: string, hold: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_set_hold', { p_case: caseId, p_hold: hold });
    revalidatePath('/integrity');
    revalidatePath(`/integrity/${caseId}`);
  }, hold ? 'Held from competition' : 'Released back into competition');
}

export async function resolveCase(caseId: string, resolution: Resolution, notes: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_resolve_integrity', { p_case: caseId, p_resolution: resolution, p_notes: notes });
    revalidatePath('/integrity');
    revalidatePath(`/integrity/${caseId}`);
    revalidatePath('/appeals');
  }, 'Case resolved');
}
