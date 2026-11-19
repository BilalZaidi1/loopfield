'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { runAction, type ActionResult } from '@/lib/errors';
import type { RuleFamily } from '@/lib/types';

const done = () => {
  revalidatePath('/rules');
  revalidatePath('/overview');
};

/** Saves the values as a rule version (reusing an identical one) that the next season starts with. */
export async function saveRules(family: RuleFamily, values: Record<string, number>, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const r = await rpc<{ version: string }>('ops_save_rules', { p_family: family, p_values: values, p_reason: reason });
    done();
    return r;
  }, 'Saved. The next season starts with these rules.');
}

/** Saves and moves running seasons to the new version straight away. */
export async function saveAndApplyRules(family: RuleFamily, values: Record<string, number>, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const r = await rpc<{ version: string }>('ops_save_rules', { p_family: family, p_values: values, p_reason: reason });
    await rpc<number>('ops_apply_rules_now', { p_family: family, p_version: r.version, p_reason: reason });
    done();
  }, 'Saved and applied. Runs started from now on use these rules.');
}

export async function setNextRules(family: RuleFamily, version: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_set_next_rules', { p_family: family, p_version: version, p_reason: reason });
    done();
  }, 'The next season will start with this version.');
}

export async function applyRulesNow(family: RuleFamily, version: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc<number>('ops_apply_rules_now', { p_family: family, p_version: version, p_reason: reason });
    done();
  }, 'Applied to running seasons.');
}
