import { StreamChat, type EventHook } from 'stream-chat';
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
    anonymous: [],
    guest: [],
    user: [],
    channel_member: ['read-channel', 'read-channel-members', 'create-message', 'update-message-owner', 'delete-message-owner', 'add-links', 'mute-channel', 'flag-message']
  }
} as const;

/**
 * App-level settings the privacy model depends on. Auth and permission checks must stay on (Stream lets
 * development apps disable them); only `message.new` webhooks are delivered, to the backend's safe
 * notification path.
 */
export const STREAM_APP_REQUIREMENTS = {
  disable_auth_checks: false,
  disable_permissions_checks: false,
  webhook_events: ['message.new']
} as const;

export interface StreamSetupReport {
  channelTypeChanges: string[];
  appChanges: Record<string, unknown>;
  warnings: string[];
  applied: boolean;
  /** Differences still present after applying (empty when Stream stored exactly what was asked). */
  remaining: string[];
}

const sameSet = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

function channelTypeDiff(current: Record<string, unknown> | null): string[] {
  if (!current) return ['channel type does not exist yet'];
  const { name: _n, grants, ...flags } = DM_CHANNEL_TYPE_CONFIG;
  const out: string[] = [];
  for (const [k, v] of Object.entries(flags)) if (current[k] !== v) out.push(`${k}: ${String(current[k])} -> ${String(v)}`);
  const currentGrants = (current.grants ?? {}) as Record<string, string[]>;
  for (const [role, perms] of Object.entries(grants)) {
    if (!sameSet(currentGrants[role], perms)) out.push(`grants.${role}: [${(currentGrants[role] ?? []).join(', ')}] -> [${perms.join(', ')}]`);
  }
  return out;
}

/**
 * Brings the Stream app to the configuration the privacy model depends on, then reads it back. Used by
 * scripts/setup-stream.ts (dry run by default) and by the `configure_stream` job, which runs server-side
 * with the function secrets so the keys never need to be copied anywhere else.
 */
export async function ensureStreamConfiguration(client: StreamChat, opts: { apply: boolean; webhookUrl?: string }): Promise<StreamSetupReport> {
  const { name: _n, grants, ...flags } = DM_CHANNEL_TYPE_CONFIG;
  const warnings: string[] = [];
  const catalogue = new Set(((await client.listPermissions()).permissions ?? []).map((p) => p.id).filter(Boolean) as string[]);
  const unknown = [...new Set(Object.values(grants).flat().filter((p) => !catalogue.has(p)))];
  if (unknown.length) throw new Error(`Unknown Stream permission id(s): ${unknown.join(', ')}; nothing was changed`);

  let current: Record<string, unknown> | null = null;
  try {
    current = (await client.getChannelType(DM_CHANNEL_TYPE)) as unknown as Record<string, unknown>;
  } catch (err) {
    if (!/not.?found|does not exist|404/i.test(String((err as Error).message))) throw err;
  }
  const channelTypeChanges = channelTypeDiff(current);

  const app = ((await client.getAppSettings()).app ?? {}) as Record<string, unknown>;
  const appChanges: Record<string, unknown> = {};
  if (app.disable_auth_checks !== STREAM_APP_REQUIREMENTS.disable_auth_checks) appChanges.disable_auth_checks = false;
  if (app.disable_permissions_checks !== STREAM_APP_REQUIREMENTS.disable_permissions_checks) appChanges.disable_permissions_checks = false;
  const events = [...STREAM_APP_REQUIREMENTS.webhook_events];
  if (app.use_hook_v2 === true || Array.isArray(app.event_hooks)) {
    // Newer Stream apps configure webhooks as event hooks; other hooks on the app are kept as they are.
    const hooks = (app.event_hooks as EventHook[] | undefined) ?? [];
    const ours = opts.webhookUrl ? hooks.find((h) => h.hook_type === 'webhook' && h.webhook_url === opts.webhookUrl) : undefined;
    if (opts.webhookUrl && (!ours || ours.enabled !== true || !sameSet(ours.event_types ?? [], events))) {
      appChanges.event_hooks = [...hooks.filter((h) => h !== ours), { ...(ours?.id ? { id: ours.id } : {}), hook_type: 'webhook', enabled: true, webhook_url: opts.webhookUrl, event_types: events }];
    }
    if (!opts.webhookUrl && !hooks.some((h) => h.hook_type === 'webhook' && h.enabled)) warnings.push('No webhook configured: message notifications will not reach the backend.');
  } else {
    if (!sameSet((app.webhook_events as string[] | undefined) ?? [], events)) appChanges.webhook_events = events;
    if (opts.webhookUrl && app.webhook_url !== opts.webhookUrl) appChanges.webhook_url = opts.webhookUrl;
    if (!opts.webhookUrl && !app.webhook_url) warnings.push('No webhook URL configured: message notifications will not reach the backend.');
  }
  if (app.permission_version && app.permission_version !== 'v2') warnings.push(`App uses permission ${String(app.permission_version)}; grants require permissions v2.`);

  let remaining: string[] = [];
  if (opts.apply) {
    const grantMap = grants as unknown as Record<string, string[]>;
    if (!current) await client.createChannelType({ ...DM_CHANNEL_TYPE_CONFIG, grants: grantMap } as never);
    else if (channelTypeChanges.length) await client.updateChannelType(DM_CHANNEL_TYPE, { ...flags, grants: grantMap } as never);
    if (Object.keys(appChanges).length) await client.updateAppSettings(appChanges as never);
    remaining = channelTypeDiff((await client.getChannelType(DM_CHANNEL_TYPE)) as unknown as Record<string, unknown>);
  }
  return { channelTypeChanges, appChanges, warnings, applied: opts.apply, remaining };
}

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
