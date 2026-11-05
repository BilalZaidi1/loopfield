/**
 * Applies and verifies the Stream Chat configuration the app depends on (PRD §9 messaging defaults):
 *   • channel type `loopfield_dm`: no read receipts, delivery receipts, typing or presence events, no uploads,
 *     link previews, reactions, threads or Stream-sent push (the backend sends the only, text-free push);
 *   • grants: channel members may read, send, edit/delete their own messages, mute and flag — nothing else.
 *     No client role may create channels or change membership; frozen channels reject sends;
 *   • app settings: auth and permission checks on; only `message.new` webhooks, to STREAM_WEBHOOK_URL.
 *
 * Dry run by default: prints the current state and what would change. Nothing is modified without --apply.
 *   STREAM_API_KEY=… STREAM_API_SECRET=… \
 *   STREAM_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/stream-webhook \
 *   npx tsx scripts/setup-stream.ts [--apply]
 * Credentials are read from the environment only and are never written to disk or printed.
 */
import { StreamChat } from 'stream-chat';
import { DM_CHANNEL_TYPE, DM_CHANNEL_TYPE_CONFIG, STREAM_APP_REQUIREMENTS } from '../supabase/functions/_shared/stream.ts';

type Flags = Record<string, boolean | number>;

const apply = process.argv.includes('--apply');
const key = process.env.STREAM_API_KEY?.trim();
const secret = process.env.STREAM_API_SECRET?.trim();
const webhookUrl = process.env.STREAM_WEBHOOK_URL?.trim();
if (!key || !secret) {
  console.error('Set STREAM_API_KEY and STREAM_API_SECRET (server credentials from the Stream dashboard) in the environment.');
  process.exit(2);
}
if (webhookUrl && !/^https:\/\/[^\s]+\/stream-webhook$/.test(webhookUrl)) {
  console.error('STREAM_WEBHOOK_URL must be the HTTPS URL of the stream-webhook edge function.');
  process.exit(2);
}

const client = StreamChat.getInstance(key, secret, { timeout: 15000 });
const { name: _name, grants, ...flags } = DM_CHANNEL_TYPE_CONFIG;
const desiredFlags = flags as unknown as Flags;
const problems: string[] = [];

function sameSet(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}

function diffChannelType(current: Record<string, unknown> | null): string[] {
  if (!current) return ['channel type does not exist yet'];
  const out: string[] = [];
  for (const [k, v] of Object.entries(desiredFlags)) if (current[k] !== v) out.push(`${k}: ${String(current[k])} -> ${String(v)}`);
  const currentGrants = (current.grants ?? {}) as Record<string, string[]>;
  for (const [role, perms] of Object.entries(grants)) {
    if (!sameSet(currentGrants[role], perms)) out.push(`grants.${role}: [${(currentGrants[role] ?? []).join(', ')}] -> [${perms.join(', ')}]`);
  }
  return out;
}

async function main(): Promise<void> {
  // 1. Every granted permission id must exist in this app's catalogue (fail before changing anything).
  const catalogue = new Set(((await client.listPermissions()).permissions ?? []).map((p) => p.id).filter(Boolean) as string[]);
  const unknown = Object.values(grants).flat().filter((p) => !catalogue.has(p));
  if (unknown.length) {
    console.error(`Unknown Stream permission id(s): ${[...new Set(unknown)].join(', ')}. Update DM_CHANNEL_TYPE_CONFIG.grants; nothing was changed.`);
    process.exit(1);
  }

  // 2. Channel type.
  let current: Record<string, unknown> | null = null;
  try {
    current = (await client.getChannelType(DM_CHANNEL_TYPE)) as unknown as Record<string, unknown>;
  } catch (err) {
    if (!/not.?found|does not exist|404/i.test(String((err as Error).message))) throw err;
  }
  const typeChanges = diffChannelType(current);

  // 3. App settings.
  const app = ((await client.getAppSettings()).app ?? {}) as Record<string, unknown>;
  const appChanges: Record<string, unknown> = {};
  if (app.disable_auth_checks !== STREAM_APP_REQUIREMENTS.disable_auth_checks) appChanges.disable_auth_checks = false;
  if (app.disable_permissions_checks !== STREAM_APP_REQUIREMENTS.disable_permissions_checks) appChanges.disable_permissions_checks = false;
  if (!sameSet((app.webhook_events as string[] | undefined) ?? [], STREAM_APP_REQUIREMENTS.webhook_events)) appChanges.webhook_events = [...STREAM_APP_REQUIREMENTS.webhook_events];
  if (webhookUrl && app.webhook_url !== webhookUrl) appChanges.webhook_url = webhookUrl;
  if (!webhookUrl && !app.webhook_url) problems.push('No webhook URL configured: set STREAM_WEBHOOK_URL so message notifications reach the backend.');
  if (app.permission_version && app.permission_version !== 'v2') problems.push(`App uses permission ${String(app.permission_version)}; grants require permissions v2.`);

  console.log(`Channel type ${DM_CHANNEL_TYPE}: ${typeChanges.length ? `\n  ${typeChanges.join('\n  ')}` : 'up to date'}`);
  console.log(`App settings: ${Object.keys(appChanges).length ? `\n  ${Object.entries(appChanges).map(([k, v]) => `${k} -> ${JSON.stringify(v)}`).join('\n  ')}` : 'up to date'}`);

  if (!apply) {
    if (typeChanges.length || Object.keys(appChanges).length) console.log('\nDry run only. Re-run with --apply to make these changes.');
  } else {
    if (!current) await client.createChannelType({ ...DM_CHANNEL_TYPE_CONFIG, grants: grants as unknown as Record<string, string[]> } as never);
    else if (typeChanges.length) await client.updateChannelType(DM_CHANNEL_TYPE, { ...desiredFlags, grants: grants as unknown as Record<string, string[]> } as never);
    if (Object.keys(appChanges).length) await client.updateAppSettings(appChanges as never);
    // Verify what Stream actually stored rather than trusting the write.
    const after = (await client.getChannelType(DM_CHANNEL_TYPE)) as unknown as Record<string, unknown>;
    const remaining = diffChannelType(after);
    if (remaining.length) problems.push(`Channel type still differs after apply:\n  ${remaining.join('\n  ')}`);
    console.log(remaining.length ? '' : `Applied and verified ${DM_CHANNEL_TYPE}.`);
  }

  for (const p of problems) console.warn(`WARNING: ${p}`);
  if (apply && problems.some((p) => p.startsWith('Channel type still differs'))) process.exit(1);
}

main().catch((err) => {
  console.error(`Stream setup failed: ${(err as Error).message}`);
  process.exit(1);
});
