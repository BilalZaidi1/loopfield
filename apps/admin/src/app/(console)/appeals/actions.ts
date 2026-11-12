'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export async function decideAppeal(appealId: string, kind: 'content' | 'account', overturn: boolean, response: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc(kind === 'account' ? 'ops_decide_account_appeal' : 'ops_decide_content_appeal', {
      p_appeal: appealId,
      p_overturn: overturn,
      p_response: response
    });
    revalidatePath('/appeals');
  }, overturn ? 'Appeal accepted' : 'Appeal declined');
}
