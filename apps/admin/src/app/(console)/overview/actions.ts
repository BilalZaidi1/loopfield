'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';
import { WIDGETS } from '@/lib/widgets';

export async function saveOverviewWidgets(ids: string[]): Promise<ActionResult> {
  const known = ids.filter((id) => WIDGETS.some((w) => w.id === id)).slice(0, 40);
  const result = await runAction(() => rpc('ops_set_preference', { p_key: 'overview_widgets', p_value: known }), 'Overview saved');
  revalidatePath('/overview');
  return result;
}

export async function resetOverviewWidgets(): Promise<ActionResult> {
  const result = await runAction(() => rpc('ops_set_preference', { p_key: 'overview_widgets', p_value: null }), 'Back to the default layout');
  revalidatePath('/overview');
  return result;
}
