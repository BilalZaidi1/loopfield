import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamChat, type Channel, type LocalMessage } from 'stream-chat';
import { callFunction } from '@/lib/api';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';

/**
 * Stream Chat for one-to-one messages only. Tokens are minted by the backend after verifying the
 * Supabase session and expire; the user connects invisible (no presence). Read receipts, typing
 * events and Stream push are disabled on the channel type server-side; the backend sends one safe
 * push per message. Channels are created only by the backend, which enforces the recipient policy.
 */
interface ChatToken {
  apiKey: string;
  userId: string;
  token: string;
  expiresAt: number;
}

export const DM_CHANNEL_TYPE = 'loopfield_dm';

let client: StreamChat | null = null;
let connecting: Promise<StreamChat> | null = null;

export async function getChat(userId: string): Promise<StreamChat> {
  if (client && client.userID === userId) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    if (client) await disconnectChat();
    const first = await callFunction<ChatToken>('chat/token', {});
    const c = new StreamChat(first.apiKey, { timeout: 10_000 });
    let initial: string | null = first.token;
    await c.connectUser({ id: userId, invisible: true } as never, async () => {
      if (initial) {
        const t = initial;
        initial = null;
        return t;
      }
      return (await callFunction<ChatToken>('chat/token', {})).token;
    });
    client = c;
    return c;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

export async function disconnectChat(): Promise<void> {
  const c = client;
  client = null;
  if (c) await c.disconnectUser().catch(() => {});
}

export async function startConversation(targetId: string): Promise<{ conversationId: string; channelId: string; created: boolean }> {
  try {
    const r = await callFunction<{ conversationId: string; channelId: string; created: boolean }>('chat/conversations', { targetId });
    if (r.created) track('message_action', { action: 'conversation_started', outcome: 'ok' });
    return r;
  } catch (e) {
    track('message_action', { action: 'conversation_started', outcome: 'not_allowed' });
    throw e;
  }
}

export async function reportMessage(channelId: string, messageId: string, category: string, details?: string): Promise<void> {
  await callFunction('chat/report', { channelId, messageId, category, details });
  track('message_action', { action: 'reported', outcome: 'ok' });
}

export type SendState = 'sending' | 'sent' | 'failed';
export interface UiMessage {
  id: string;
  text: string;
  mine: boolean;
  createdAt: Date;
  deleted: boolean;
  state: SendState;
}

const toUi = (m: LocalMessage, me: string): UiMessage => ({
  id: m.id,
  text: m.type === 'deleted' ? '' : m.text ?? '',
  mine: m.user?.id === me,
  createdAt: m.created_at instanceof Date ? m.created_at : new Date(m.created_at as unknown as string),
  deleted: m.type === 'deleted',
  state: m.status === 'failed' ? 'failed' : m.status === 'sending' ? 'sending' : 'sent'
});

/** Watches one DM channel; exposes messages, send with status, deletion of own messages and paging. */
export function useConversation(userId: string | null, channelId: string) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [error, setError] = useState<unknown>(null);
  const [frozen, setFrozen] = useState(false);
  const channelRef = useRef<Channel | null>(null);

  const refresh = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !userId) return;
    setMessages(ch.state.messages.map((m) => toUi(m, userId)));
    setFrozen(Boolean((ch.data as { frozen?: boolean } | undefined)?.frozen));
  }, [userId]);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const c = await getChat(userId);
        const ch = c.channel(DM_CHANNEL_TYPE, channelId);
        await ch.watch({ presence: false, messages: { limit: 30 } });
        if (!active) return;
        channelRef.current = ch;
        setMessages(ch.state.messages.map((m) => toUi(m, userId)));
        setFrozen(Boolean((ch.data as { frozen?: boolean } | undefined)?.frozen));
        setStatus('ready');
      } catch (e) {
        if (!active) return;
        log.warn(`chat connect failed: ${String(e)}`);
        setError(e);
        setStatus('error');
      }
    })();
    return () => {
      active = false;
      void channelRef.current?.stopWatching().catch(() => {});
      channelRef.current = null;
    };
  }, [userId, channelId, attempt]);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || status !== 'ready') return;
    const subs = ['message.new', 'message.updated', 'message.deleted', 'channel.updated'].map((e) => ch.on(e as never, refresh));
    return () => subs.forEach((s) => s.unsubscribe());
  }, [status, refresh]);

  const send = useCallback(async (text: string) => {
    const ch = channelRef.current;
    const body = text.trim();
    if (!ch || !body) return;
    try {
      const p = ch.sendMessage({ text: body });
      refresh();
      await p;
      track('message_action', { action: 'message_sent', outcome: 'ok' });
    } catch (e) {
      track('message_action', { action: 'message_sent', outcome: 'failed' });
      throw e;
    } finally {
      refresh();
    }
  }, [refresh]);

  const remove = useCallback(async (messageId: string) => {
    if (!client) return;
    await client.deleteMessage(messageId);
    track('message_action', { action: 'message_deleted', outcome: 'ok' });
    refresh();
  }, [refresh]);

  const loadOlder = useCallback(async () => {
    const ch = channelRef.current;
    const oldest = ch?.state.messages[0];
    if (!ch || !oldest) return false;
    const res = await ch.query({ messages: { limit: 30, id_lt: oldest.id } });
    refresh();
    return (res.messages?.length ?? 0) > 0;
  }, [refresh]);

  const retry = useCallback(() => {
    setStatus('connecting');
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { messages, status, error, frozen, send, remove, loadOlder, retry };
}
