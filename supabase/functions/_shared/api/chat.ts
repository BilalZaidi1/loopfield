import { dmChannelId, SOCIAL_RULES } from '../core/index.ts';
import type { Sql } from '../clients.ts';
import type { ServerEnv } from '../env.ts';
import { HttpError, isUuid } from '../http.ts';
import { syncGroupChannelWith } from '../stream.ts';

/** Server-side Stream operations used by the chat endpoint; injected for tests. */
export interface ChatServer {
  apiKey: string;
  upsertUser(user: { id: string; name: string }): Promise<void>;
  createToken(userId: string, ttlSeconds: number): { token: string; expiresAt: number };
  createChannel(channelId: string, creator: string, other: string): Promise<void>;
  getMessage(messageId: string): Promise<{ id: string; text: string; user_id: string; channel_id: string; created_at: string } | null>;
  getContext(channelId: string, messageId: string, around: number): Promise<Array<{ id: string; text: string; user_id: string; created_at: string }>>;
  /** Creates the group channel if needed and sets its members (backend-managed). */
  syncGroup(channelId: string, name: string, members: { id: string; name: string }[]): Promise<void>;
}

/** Stream channel id for a group (kept in step with stream.ts). */
export const groupChannel = (clubId: string) => `grp-${clubId}`;

/** Opens a group's chat for one of its active members (the channel follows the group's membership). */
export async function openGroupChat(sql: Sql, chat: ChatServer, userId: string, clubId: string) {
  if (!isUuid(clubId)) throw new HttpError(400, 'invalid_group');
  if (!(await messagingEnabled(sql))) throw new HttpError(503, 'messaging_suspended');
  const [c] = await sql`
    select c.name, c.kind, c.status, m.state from public.clubs c
      left join public.club_memberships m on m.club_id = c.id and m.user_id = ${userId}
     where c.id = ${clubId}`;
  if (!c || c.kind !== 'group' || c.status !== 'active' || c.state !== 'active') throw new HttpError(403, 'forbidden');
  const members = await sql`
    select p.id, p.display_name from public.club_memberships m join public.profiles p on p.id = m.user_id
     where m.club_id = ${clubId} and m.state = 'active' and p.status = 'active' order by m.created_at`;
  await chat.syncGroup(groupChannel(clubId), c.name as string, members.map((m) => ({ id: m.id as string, name: m.display_name as string })));
  return { channelId: groupChannel(clubId), name: c.name as string };
}

async function messagingEnabled(sql: Sql): Promise<boolean> {
  const [r] = await sql`select coalesce((select value::text::boolean from public.app_config where key = 'messaging_enabled'), true) as v`;
  return Boolean(r?.v);
}

/** Expiring Stream token minted only after the Supabase session was verified by the caller. */
export async function chatToken(sql: Sql, chat: ChatServer, userId: string) {
  if (!(await messagingEnabled(sql))) throw new HttpError(503, 'messaging_suspended');
  const [p] = await sql`select display_name, status from public.profiles where id = ${userId}`;
  if (!p || p.status !== 'active') throw new HttpError(403, 'forbidden');
  await chat.upsertUser({ id: userId, name: p.display_name });
  const { token, expiresAt } = chat.createToken(userId, SOCIAL_RULES.chatTokenTtlSeconds.value);
  return { apiKey: chat.apiKey, userId, token, expiresAt };
}

/** Enforces the recipient policy server-side (default mutual followers); blocks always win. */
export async function canMessage(sql: Sql, sender: string, recipient: string): Promise<{ allowed: boolean; reason: string }> {
  if (sender === recipient) return { allowed: false, reason: 'self' };
  const [r] = await sql`
    select authz.is_blocked(${sender}::uuid, ${recipient}::uuid) as blocked,
           authz.follows(${sender}::uuid, ${recipient}::uuid) as s_follows,
           authz.follows(${recipient}::uuid, ${sender}::uuid) as r_follows,
           (select messages_from from public.user_settings where user_id = ${recipient}) as setting,
           (select status from public.profiles where id = ${recipient}) as status`;
  if (!r || r.status !== 'active') return { allowed: false, reason: 'unavailable' };
  if (r.blocked) return { allowed: false, reason: 'blocked' };
  const allowed = r.setting === 'nobody' ? false : r.setting === 'followers' ? r.s_follows : r.s_follows && r.r_follows;
  return { allowed: Boolean(allowed), reason: allowed ? 'ok' : 'not_allowed' };
}

export async function startConversation(sql: Sql, chat: ChatServer, userId: string, targetId: string) {
  if (!isUuid(targetId)) throw new HttpError(400, 'invalid_target');
  if (!(await messagingEnabled(sql))) throw new HttpError(503, 'messaging_suspended');
  const [a, b] = [userId, targetId].sort();
  const [existing] = await sql`select id, channel_id, frozen from public.conversations where member_a = ${a!} and member_b = ${b!}`;
  if (existing) {
    if (existing.frozen) throw new HttpError(403, 'blocked');
    return { conversationId: existing.id as string, channelId: existing.channel_id as string, created: false };
  }
  const check = await canMessage(sql, userId, targetId);
  if (!check.allowed) throw new HttpError(403, check.reason);
  const [rl] = await sql`select internal.check_rate_limit(${userId}, 'conversation_start', 20, 86400) as allowed`;
  if (!rl?.allowed) throw new HttpError(429, 'rate_limited');
  const channelId = dmChannelId(userId, targetId);
  const people = await sql`select id, display_name from public.profiles where id in (${userId}, ${targetId})`;
  for (const p of people) await chat.upsertUser({ id: p.id, name: p.display_name });
  await chat.createChannel(channelId, userId, targetId);
  const [conv] = await sql`
    insert into public.conversations (channel_id, member_a, member_b, created_by) values (${channelId}, ${a!}, ${b!}, ${userId})
    on conflict (member_a, member_b) do update set channel_id = excluded.channel_id returning id`;
  return { conversationId: conv!.id as string, channelId, created: true };
}

/**
 * Report a message: a restricted case receives the reported message and minimal surrounding context
 * only — reporting never exposes the whole inbox (PRD §11).
 */
export async function reportMessage(sql: Sql, chat: ChatServer, userId: string, req: { channelId: string; messageId: string; category: string; details?: string }) {
  const [conv] = await sql`select id, member_a, member_b from public.conversations where channel_id = ${req.channelId}`;
  const groupId = /^grp-([0-9a-f-]{36})$/.exec(req.channelId)?.[1] ?? null;
  if (conv) {
    if (conv.member_a !== userId && conv.member_b !== userId) throw new HttpError(403, 'forbidden');
  } else if (groupId) {
    const [m] = await sql`select 1 as ok from public.club_memberships m join public.clubs c on c.id = m.club_id
                           where m.club_id = ${groupId} and m.user_id = ${userId} and m.state = 'active' and c.kind = 'group'`;
    if (!m) throw new HttpError(403, 'forbidden');
  } else throw new HttpError(403, 'forbidden');
  const [rl] = await sql`select internal.check_rate_limit(${userId}, 'report', 20, 86400) as allowed`;
  if (!rl?.allowed) throw new HttpError(429, 'rate_limited');
  const message = await chat.getMessage(req.messageId);
  if (!message || message.channel_id !== req.channelId) throw new HttpError(404, 'message_not_found');
  const other = conv ? (conv.member_a === userId ? conv.member_b : conv.member_a) : message.user_id;
  if (!other || other === userId || message.user_id !== other) throw new HttpError(400, 'can_only_report_received_messages');
  const context = await chat.getContext(req.channelId, req.messageId, 2);
  const [caseRow] = await sql`select internal.open_moderation_case('message', ${req.messageId}, ${req.category}, ${other}::uuid) as id`;
  await sql`insert into internal.moderation_evidence (case_id, evidence) values (${caseRow!.id}, ${sql.json({ reported: message, context, channel_id: req.channelId } as never)})`;
  const [report] = await sql`
    insert into public.reports (reporter_id, object_type, object_id, category, details, case_id)
    values (${userId}, 'message', ${req.messageId}, ${req.category}, ${req.details?.slice(0, 1000) ?? null}, ${caseRow!.id}) returning id`;
  return { reportId: report!.id as string };
}

export function streamChatServer(env: ServerEnv, server: import('stream-chat').StreamChat, channelType: string): ChatServer {
  return {
    apiKey: env.STREAM_API_KEY!,
    async upsertUser(u) {
      await server.upsertUser({ id: u.id, name: u.name } as never);
    },
    createToken(userId, ttl) {
      const now = Math.floor(Date.now() / 1000);
      return { token: server.createToken(userId, now + ttl, now - 5), expiresAt: now + ttl };
    },
    async createChannel(channelId, creator, other) {
      await server.channel(channelType, channelId, { members: [creator, other], created_by_id: creator } as never).create();
    },
    async getMessage(id) {
      const r = (await server.getMessage(id)) as unknown as { message?: { id: string; text?: string; user?: { id: string }; cid?: string; created_at?: string } };
      const m = r.message;
      if (!m) return null;
      return { id: m.id, text: m.text ?? '', user_id: m.user?.id ?? '', channel_id: (m.cid ?? '').split(':')[1] ?? '', created_at: m.created_at ?? '' };
    },
    async syncGroup(channelId, name, members) {
      await syncGroupChannelWith(server, channelId, name, members);
    },
    async getContext(channelId, messageId, around) {
      const ch = server.channel(channelType, channelId);
      const before = (await ch.query({ messages: { limit: around, id_lt: messageId } } as never)) as unknown as { messages: Array<{ id: string; text?: string; user?: { id: string }; created_at?: string }> };
      const after = (await ch.query({ messages: { limit: around, id_gt: messageId } } as never)) as unknown as { messages: Array<{ id: string; text?: string; user?: { id: string }; created_at?: string }> };
      return [...before.messages, ...after.messages].map((m) => ({ id: m.id, text: m.text ?? '', user_id: m.user?.id ?? '', created_at: m.created_at ?? '' }));
    }
  };
}
