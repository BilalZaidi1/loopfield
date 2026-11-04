import type { ServerEnv } from './env.ts';

/**
 * Expo push delivery (APNs/FCM through Expo's push service). This is the single delivery path for
 * app and chat notifications, so a message never triggers two pushes.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** Category/thread for grouping; no content. */
  categoryId?: string;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** Token is no longer valid and must be disabled. */
  invalidToken: boolean;
  error?: string;
}

export async function sendExpoPush(env: ServerEnv, messages: PushMessage[], fetchImpl: typeof fetch = fetch): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {})
      },
      body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default', priority: 'high', categoryId: m.categoryId })))
    });
    if (!res.ok) throw new Error(`expo push http ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ status: 'ok' | 'error'; message?: string; details?: { error?: string } }> };
    (json.data ?? []).forEach((ticket, idx) => {
      const token = batch[idx]!.to;
      results.push({
        token,
        ok: ticket.status === 'ok',
        invalidToken: ticket.details?.error === 'DeviceNotRegistered',
        error: ticket.status === 'error' ? ticket.details?.error ?? 'error' : undefined
      });
    });
  }
  return results;
}
