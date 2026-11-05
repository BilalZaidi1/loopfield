import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { pgArray, serverSecret, type Sql } from '../../../supabase/functions/_shared/clients.ts';
import { ConfigError, requireKeys, readEnv } from '../../../supabase/functions/_shared/env.ts';
import { HttpError, toResponse } from '../../../supabase/functions/_shared/http.ts';
import { runBatch } from '../../../supabase/functions/_shared/jobs/registry.ts';
import { DB_URL, makeCtx } from './helpers.ts';

/** Behaviour that only shows up on a fresh runtime — the situation of every edge-function cold start. */
describe('edge runtime cold start', () => {
  it('claims jobs on the very first query of a fresh connection', async () => {
    // Regression: sql.array() sent "a,b" (not {a,b}) before postgres.js had fetched array types.
    const fresh = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} }) as unknown as Sql;
    try {
      const ctx = { ...makeCtx(1), sql: fresh };
      await expect(runBatch(ctx, 'cold-start-test', undefined, 1)).resolves.toMatchObject({ failed: 0 });
    } finally {
      await (fresh as unknown as { end(): Promise<void> }).end();
    }
  });

  it('round-trips arrays with quotes, backslashes and commas as one bind parameter', async () => {
    const fresh = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} }) as unknown as Sql;
    try {
      const values = ['plain', 'with,comma', 'quote"inside', 'back\\slash', '{braces}', ''];
      const [row] = await fresh`select ${pgArray(values)}::text[] as v, ${pgArray([])}::uuid[] as empty, ${pgArray([1n, 2n])}::bigint[] as n`;
      expect(row!.v).toEqual(values);
      expect(row!.empty).toEqual([]);
      expect(row!.n.map(String)).toEqual(['1', '2']);
    } finally {
      await (fresh as unknown as { end(): Promise<void> }).end();
    }
  });
});

describe('edge function error mapping', () => {
  it('reports a missing integration as 503 not_configured, never as a generic failure', async () => {
    const env = readEnv((k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SECRET_KEY: 'k', SUPABASE_DB_URL: 'postgres://x' })[k]);
    let thrown: unknown;
    try {
      requireKeys(env, ['RESEND_API_KEY']);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    const reported: unknown[] = [];
    const res = toResponse(thrown, (e) => reported.push(e));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
    expect(reported).toHaveLength(1);
  });

  it('maps HTTP errors and database rejections without leaking internals', async () => {
    expect(toResponse(new HttpError(401, 'unauthenticated')).status).toBe(401);
    expect(toResponse({ code: 'P0429', message: 'slow down' }).status).toBe(429);
    const internal = toResponse(new Error('connection to 10.0.0.1 failed for user x@example.com'), () => {});
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ error: 'internal_error' });
  });
});

describe('hosted configuration', () => {
  it('reads the new JSON API key sets that hosted Edge Functions receive', () => {
    const env = readEnv((k) => ({
      SUPABASE_URL: 'https://ref.supabase.co',
      SUPABASE_DB_URL: 'postgres://x',
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_example' }),
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_example' })
    })[k]);
    expect(env.SUPABASE_SERVICE_KEY).toBe('sb_secret_example');
    expect(env.SUPABASE_ANON_KEY).toBe('sb_publishable_example');
    const legacy = readEnv((k) => ({ SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_DB_URL: 'postgres://x', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service' })[k]);
    expect(legacy.SUPABASE_SERVICE_KEY).toBe('legacy-service');
    expect(() => readEnv((k) => ({ SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_DB_URL: 'postgres://x' })[k])).toThrow(ConfigError);
  });

  it('takes server secrets from the environment first, then from Vault, else reports not configured', async () => {
    const sql = postgres(DB_URL, { max: 1, prepare: false, onnotice: () => {} }) as unknown as Sql;
    try {
      // Stand-in for Supabase Vault's decrypted view (plain PostgreSQL has no Vault).
      await sql`create schema if not exists vault`;
      await sql`create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text)`;
      await sql`insert into vault.decrypted_secrets values ('test_runtime_secret', 'from-vault') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`;
      expect(await serverSecret(sql, 'from-env', 'test_runtime_secret')).toBe('from-env');
      expect(await serverSecret(sql, undefined, 'test_runtime_secret')).toBe('from-vault');
      await expect(serverSecret(sql, undefined, 'test_missing_secret')).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await sql`drop schema if exists vault cascade`;
      await (sql as unknown as { end(): Promise<void> }).end();
    }
  });
});
