import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import { OpsError } from '@/lib/errors';
import { fixture, fixturesEnabled } from '@/lib/fixtures';

/** Calls a Postgres RPC as the signed-in staff member. Throws OpsError with the database error code. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (fixturesEnabled) return fixture(fn) as T;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new OpsError(error.message, error.code);
  return data as T;
}
