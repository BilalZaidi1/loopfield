import { env } from '@/config/env';
import type { Database } from './database.types';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  forbidden: 'You do not have access to that.',
  unauthenticated: 'Please sign in again.',
  rate_limited: 'Too many requests. Please try again shortly.',
  zoom_in: 'Zoom in to load territory for this area.',
  temporarily_unavailable: 'This feature is temporarily unavailable.',
  not_configured: 'This service has not been configured yet.',
  territory_consent_required: 'Turn on territory competition in Privacy settings first.',
  speed_consent_required: 'Turn on speed titles in Privacy settings first.',
  full_private_mode: 'Full private mode is on, so competitive runs are unavailable.',
  no_active_season: 'There is no active season for this competition right now.',
  course_unavailable: 'That route is not accepting attempts.',
  capture_suspended: 'Land capture is temporarily suspended. You can still record privately.',
  speed_suspended: 'Speed titles are temporarily suspended. You can still record privately.',
  messaging_suspended: 'Messaging is temporarily unavailable.',
  not_allowed: 'This runner is not accepting messages from you.',
  blocked: 'Messaging is unavailable with this runner.',
  network: 'You appear to be offline.',
  insufficient_points: 'You do not have enough movement points for that. Every verified kilometre adds 10.',
  nothing_to_reclaim: 'None of those cells can be reclaimed any more. They may have changed hands.',
  season_closed: 'This season is closed, so ground can no longer be reclaimed.',
  not_participating: 'Turn on territory competition in Privacy settings to reclaim ground.',
  reclaim_suspended: 'Reclaiming is temporarily unavailable.',
  region_suspended: 'Competition in this area is suspended.',
  too_many_cells: 'Choose at most 200 cells at a time.',
  reclaim_conflict: 'The map changed while you were reclaiming. Nothing was charged; please try again.',
  set_city: 'Set your city in your profile to see regional rankings.',
  no_country: 'Country rankings are not available for your area yet.'
};

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? FRIENDLY[err.message] ?? err.message;
  const e = err as { code?: string; message?: string };
  if (e?.code === '42501') return FRIENDLY.forbidden!;
  if (e?.code === 'P0429') return FRIENDLY.rate_limited!;
  if (e?.code === 'P0413') return FRIENDLY.zoom_in!;
  if (e?.message && /network|fetch failed|Network request failed/i.test(e.message)) return FRIENDLY.network!;
  return e?.message && e.message.length < 160 ? e.message : 'Something went wrong. Please try again.';
}

export type RpcName = keyof Database['public']['Functions'];

/**
 * RPC call. The function name is checked against the generated schema types; the result type is the
 * caller's view of the returned JSON. Authorization is enforced server-side by RLS and SECURITY DEFINER checks.
 */
export async function rpc<T>(fn: RpcName, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args as never);
  if (error) {
    const err = new ApiError(error.code ?? 'rpc_error', error.message);
    (err as unknown as { code: string }).code = error.code ?? 'rpc_error';
    throw err;
  }
  return data as T;
}

/** Edge function call with the current session; never sends secrets from the client. */
export async function callFunction<T>(path: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('unauthenticated', 'Please sign in again.', 401);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${env.supabaseUrl}/functions/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: env.supabaseAnonKey ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new ApiError(json.error ?? `http_${res.status}`, json.message ?? json.error ?? `Request failed (${res.status})`, res.status);
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network', 'You appear to be offline.');
  } finally {
    clearTimeout(timer);
  }
}
