'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

export async function retryJob(id: number): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_retry_job', { p_job: id });
    revalidatePath('/jobs');
  }, 'Job queued again');
}

export async function retryDeadJobs(queue: string | null): Promise<ActionResult> {
  try {
    const n = await rpc<number>('ops_retry_dead_jobs', { p_queue: queue });
    revalidatePath('/jobs');
    return { ok: true, message: n ? `${n} job${n === 1 ? '' : 's'} queued again` : 'Nothing to retry (duplicates are already queued)' };
  } catch (e) {
    return runAction(() => Promise.reject(e));
  }
}
