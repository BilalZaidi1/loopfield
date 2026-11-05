import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { pgArray, type Sql } from '../../../supabase/functions/_shared/clients.ts';
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
