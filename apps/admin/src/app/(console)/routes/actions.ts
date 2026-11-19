'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export async function reviewRoute(proposalId: string, approve: boolean, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_review_route', { p_proposal: proposalId, p_approve: approve, p_reason: reason });
    revalidatePath('/routes');
  }, approve ? 'Route approved and published as a course' : 'Route declined');
}
