'use server';

import { revalidatePath } from 'next/cache';
import { rpc } from '@/lib/rpc';
import { friendlyError, runAction, type ActionResult } from '@/lib/errors';
import type { SqlResult } from '@/lib/types';

/** Runs one read-only query as the curated-views reader. Every run is audited in the database. */
export async function runSql(sql: string, limit: number): Promise<{ ok: true; result: SqlResult } | { ok: false; error: string }> {
  try {
    const result = await rpc<SqlResult>('ops_sql_run', { p_sql: sql, p_limit: limit });
    revalidatePath('/sql');
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function saveQuery(id: string | null, name: string, sql: string, shared: boolean): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: 'Name the query first.' };
  return runAction(async () => {
    await rpc('ops_sql_save', { p_id: id, p_name: name.trim().slice(0, 80), p_sql: sql, p_shared: shared });
    revalidatePath('/sql');
  }, 'Query saved');
}

export async function deleteQuery(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await rpc('ops_sql_delete', { p_id: id });
    revalidatePath('/sql');
  }, 'Query deleted');
}
