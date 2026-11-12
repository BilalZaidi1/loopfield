import type { Threshold } from './config.ts';

/**
 * Applies a rule version's overrides (saved from the back office into `internal.rule_versions`) to the
 * built-in rules. Only keys that exist in the base with a finite numeric value are replaced; anything
 * else is ignored, so a malformed row can never switch a check off. Bounds are enforced when the
 * version is saved (`ops_save_rules`), so they are not repeated here.
 */
export function withRuleOverrides<T extends { readonly version: string }>(base: T, overrides: unknown, version: string): T {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return { ...base, version };
  const out: Record<string, unknown> = { ...base, version };
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const current = (base as Record<string, unknown>)[key] as Threshold<unknown> | undefined;
    if (!current || typeof current !== 'object' || typeof current.value !== 'number') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = { ...current, value };
  }
  return out as T;
}

/** Replaces one numeric threshold, keeping its status and source. */
export function withThreshold<T, K extends keyof T>(rules: T, key: K, value: number | null | undefined): T {
  const current = rules[key] as Threshold<unknown> | undefined;
  if (value == null || !Number.isFinite(value) || !current || typeof current.value !== 'number') return rules;
  return { ...rules, [key]: { ...current, value } };
}
