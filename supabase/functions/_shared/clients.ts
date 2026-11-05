import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { ConfigError, type ServerEnv } from './env.ts';
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

/**
 * Array bind parameter as a Postgres array literal, for use with an explicit cast: `${pgArray(ids)}::uuid[]`.
 * postgres.js's sql.array() looks up array type OIDs that it only fetches once a connection is open, so on the
 * first query of a fresh connection (every edge-function cold start) it sends "a,b" instead of {a,b} and the
 * cast fails. A quoted literal parsed by the cast does not depend on that state.
 */
export function pgArray(values: readonly (string | number | bigint)[]): string {
  return `{${values.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

const vaultCache = new Map<string, string>();

/**
 * Server-only secret: the environment value when set, otherwise the named Supabase Vault entry. Vault
 * entries are generated inside the database (see scripts/setup-supabase.sh vault), so nobody has to
 * copy them between systems. Throws ConfigError (HTTP 503 not_configured) when neither exists.
 */
export async function serverSecret(sql: Sql, envValue: string | undefined, vaultName: string): Promise<string> {
  if (envValue) return envValue;
  const cached = vaultCache.get(vaultName);
  if (cached) return cached;
  let value: string | undefined;
  try {
    const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = ${vaultName}`;
    value = (rows[0]?.decrypted_secret as string | undefined) ?? undefined;
  } catch {
    value = undefined; // no Vault (plain PostgreSQL): fall through to the configuration error
  }
  if (!value) throw new ConfigError(`Integration not configured: missing ${vaultName}`);
  vaultCache.set(vaultName, value);
  return value;
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
