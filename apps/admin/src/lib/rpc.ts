import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { friendlyError, OpsError } from '@/lib/errors';
import { fixture, fixturesEnabled } from '@/lib/fixtures';

/** In fixture mode, CONSOLE_FIXTURES_FAIL=ops_metrics,ops_overview makes those calls fail, to check how pages degrade. */
const failing = fixturesEnabled ? (process.env.CONSOLE_FIXTURES_FAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];

/** Calls a Postgres RPC as the signed-in staff member. Throws OpsError with the database error code. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (failing.includes(fn)) throw new OpsError('UPDATE requires a WHERE clause', '21000');
  if (fixturesEnabled) return fixture(fn) as T;
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) throw new OpsError(error.message, error.code);
  return data as T;
}

/** One section's data, or the sentence to show where it would have been. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Awaits one section of a page without letting it fail the rest: the error is logged on the server (Vercel
 * logs) and shown in place. Next.js control flow (redirects, not found, dynamic rendering) still propagates.
 */
export async function settle<T>(load: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await load };
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    return { ok: false, error: friendlyError(error) };
  }
}
