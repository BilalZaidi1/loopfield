'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';
import type { SupportPriority, SupportStatus } from '@/lib/types';

const done = (id: string) => {
  revalidatePath(`/support/${id}`);
  revalidatePath('/support');
};

/** A reply the runner sees (they are notified), or an internal note only staff see. */
export async function replyToTicket(id: string, body: string, internal: boolean, status: SupportStatus | null): Promise<ActionResult> {
  if (!body.trim()) return { ok: false, error: 'Write a message first.' };
  return runAction(async () => {
    await rpc('ops_support_reply', { p_ticket: id, p_body: body, p_internal: internal, p_status: status });
    done(id);
  }, internal ? 'Note added' : 'Reply sent. The runner gets a notification.');
}

export async function updateTicket(id: string, change: { status?: SupportStatus; priority?: SupportPriority; assignee?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_support_update', {
      p_ticket: id,
      p_status: change.status ?? null,
      p_priority: change.priority ?? null,
      p_assignee: change.assignee ?? null,
      p_unassign: change.assignee === null
    });
    done(id);
  }, 'Updated');
}
