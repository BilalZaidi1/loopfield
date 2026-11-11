import type { Sql } from '../clients.ts';

export const UNSUBSCRIBE_CATEGORIES = ['runs', 'territory', 'clubs', 'events'] as const;
export type UnsubscribeCategory = (typeof UNSUBSCRIBE_CATEGORIES)[number];

/**
 * One-click unsubscribe from one optional email category. The random per-person token in the link is the
 * only authorization (no session, so it works from any mail app); account and security email cannot be
 * turned off this way. Returns false for an unknown token or category.
 */
export async function unsubscribe(sql: Sql, token: string | null, category: string | null): Promise<boolean> {
  if (!token || token.length < 16 || token.length > 64 || !category || !(UNSUBSCRIBE_CATEGORIES as readonly string[]).includes(category)) return false;
  const [r] = await sql`select internal.email_unsubscribe(${token}, ${category}) as ok`;
  return Boolean(r?.ok);
}
