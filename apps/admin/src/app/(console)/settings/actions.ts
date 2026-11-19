'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';

/** Changes one app_config value through ops_set_config (role check, validation, history, audit). */
export async function setConfig(key: string, value: unknown, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_set_config', { p_key: key, p_value: value, p_reason: reason });
    revalidatePath('/settings');
    revalidatePath('/overview');
  }, 'Setting saved');
}
