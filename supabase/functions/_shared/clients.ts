import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import type { ServerEnv } from './env.ts';
import { HttpError } from './http.ts';

export type Sql = ReturnType<typeof postgres>;

let sqlSingleton: Sql | null = null;

/** Direct database connection for transactional engine calls (service context only). */
export function getSql(env: ServerEnv, max = 3): Sql {
  if (!sqlSingleton) {
    sqlSingleton = postgres(env.SUPABASE_DB_URL, {
      max,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { application_name: 'loopfield-server' },
      onnotice: () => {}
    });
  }
  return sqlSingleton;
}

export async function closeSql(): Promise<void> {
  if (sqlSingleton) {
    await sqlSingleton.end({ timeout: 5 });
    sqlSingleton = null;
  }
}

export function serviceClient(env: ServerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Client acting as the calling user, so RLS and RPC authorization apply exactly as on device. */
export function userClient(env: ServerEnv, jwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
}

/** Verifies the Supabase session server-side (never trusts client-asserted ids). */
export async function requireUser(req: Request, env: ServerEnv): Promise<{ userId: string; jwt: string }> {
  const header = req.headers.get('authorization') ?? '';
  const jwt = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!jwt) throw new HttpError(401, 'unauthenticated');
  const { data, error } = await serviceClient(env).auth.getUser(jwt);
  if (error || !data?.user) throw new HttpError(401, 'unauthenticated');
  if (data.user.is_anonymous) throw new HttpError(403, 'forbidden');
  return { userId: data.user.id, jwt };
}
