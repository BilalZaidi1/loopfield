import { StreamChat } from 'stream-chat';
import { requireKeys, type ServerEnv } from './env.ts';

/**
 * Stream Chat server integration. Channels are created only here (server-side); clients hold
 * short-lived user tokens and the channel type grants them no channel-creation or membership rights.
 */
export const DM_CHANNEL_TYPE = 'loopfield_dm';

/** Channel-type configuration applied by scripts/setup-stream.ts (privacy defaults from PRD §9). */
export const DM_CHANNEL_TYPE_CONFIG = {
  name: DM_CHANNEL_TYPE,
  read_events: false, // no read receipts
  delivery_events: false, // delivery receipts would reveal device presence
  typing_events: false,
  connect_events: false, // no online presence
  url_enrichment: false, // no link previews that could copy private content
  uploads: false, // text and permitted content links only
  reactions: false,
  replies: false,
  quotes: false,
  polls: false,
  shared_locations: false, // no live location in this release
  search: false,
  custom_events: false,
  mutes: true,
  push_notifications: false, // the backend delivers safe pushes; avoids duplicate notifications
  reminders: false,
  max_message_length: 2000,
  // Members may read, send, edit/delete their own messages, mute and flag. No role may create channels or
  // change membership from a client; channels are created server-side. Frozen channels (blocks) reject sends.
  // Permission IDs follow Stream's permission catalogue; scripts/setup-stream.ts verifies them on apply.
  grants: {
    user: [],
    channel_member: ['read-channel', 'read-channel-members', 'create-message', 'update-message-owner', 'delete-message-owner', 'add-links', 'mute-channel', 'flag-message']
  }
} as const;

let client: StreamChat | null = null;

export function streamServer(env: ServerEnv): StreamChat {
  const cfg = requireKeys(env, ['STREAM_API_KEY', 'STREAM_API_SECRET']);
  if (!client) client = StreamChat.getInstance(cfg.STREAM_API_KEY, cfg.STREAM_API_SECRET, { timeout: 8000 });
  return client;
}

/** Expiring user token minted only after the Supabase session was verified. */
export function mintUserToken(env: ServerEnv, userId: string, ttlSeconds: number, now = Math.floor(Date.now() / 1000)): { token: string; expiresAt: number } {
  const exp = now + ttlSeconds;
  return { token: streamServer(env).createToken(userId, exp, now - 5), expiresAt: exp };
}

/** Upserts the minimal public identity (pseudonym only — no email, no location). */
export async function upsertStreamUser(env: ServerEnv, user: { id: string; name: string; image?: string | null }): Promise<void> {
  await streamServer(env).upsertUser({ id: user.id, name: user.name, ...(user.image ? { image: user.image } : {}) } as never);
}

export async function createDmChannel(env: ServerEnv, channelId: string, creator: string, other: string): Promise<void> {
  const ch = streamServer(env).channel(DM_CHANNEL_TYPE, channelId, { members: [creator, other], created_by_id: creator } as never);
  await ch.create();
}

export async function setChannelFrozen(env: ServerEnv, channelId: string, frozen: boolean): Promise<void> {
  const ch = streamServer(env).channel(DM_CHANNEL_TYPE, channelId);
  await ch.updatePartial({ set: { frozen } } as never);
}
