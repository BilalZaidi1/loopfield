import type { Gear } from '@/features/gear/api';
import { fetchAppConfig } from '@/lib/appConfig';
import { queryClient } from '@/lib/query';

/**
 * Whether a just-recorded run counts towards a pair of shoes, for `run_saved` (R4): shoes switched on and a pair
 * set for new runs, as far as this phone knows. Only yes or no is sent, never which pair or its distance.
 */
export async function countsTowardsShoes(): Promise<boolean> {
  try {
    if (!(await fetchAppConfig()).enabled.gear_enabled) return false;
  } catch {
    // settings unreadable: judge by the pairs this phone has seen
  }
  return queryClient.getQueriesData<Gear[]>({ queryKey: ['gear'] }).some(([, list]) => Array.isArray(list) && list.some((g) => g.is_default && !g.retired_at));
}
