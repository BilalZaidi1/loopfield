import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { assertSupabaseConfigured, env } from '@/lib/env';

/**
 * Supabase client bound to the signed-in staff member's session cookies. Every call runs with their own
 * JWT, so role checks and audit attribution stay in Postgres. The console never uses a secret key.
 */
export async function supabaseServer() {
  assertSupabaseConfigured();
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component render: the proxy refreshes the session instead.
        }
      }
    }
  });
}
