/**
 * Applies and verifies the Stream Chat configuration the app depends on (PRD §9 messaging defaults):
 *   • channel type `loopfield_dm`: no read receipts, delivery receipts, typing or presence events, no uploads,
 *     link previews, reactions, threads or Stream-sent push (the backend sends the only, text-free push);
 *   • grants: channel members may read, send, edit/delete their own messages, mute and flag — nothing else.
 *     No client role may create channels or change membership; frozen channels reject sends;
 *   • app settings: auth and permission checks on; only `message.new` webhooks, to STREAM_WEBHOOK_URL.
 *
 * The same routine runs server-side as the `configure_stream` job (no keys leave the backend):
 *   select internal.enqueue_job('chat', 'configure_stream', '{}', 'configure-stream');
 *
 * From a machine instead — dry run by default; nothing is modified without --apply:
 *   STREAM_API_KEY=… STREAM_API_SECRET=… \
 *   STREAM_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/stream-webhook \
 *   npx tsx scripts/setup-stream.ts [--apply]
 * Credentials are read from the environment only and are never written to disk or printed.
 */
import { StreamChat } from 'stream-chat';
import { DM_CHANNEL_TYPE, ensureStreamConfiguration } from '../supabase/functions/_shared/stream.ts';

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

ensureStreamConfiguration(StreamChat.getInstance(key, secret, { timeout: 15000 }), { apply, ...(webhookUrl ? { webhookUrl } : {}) })
  .then((r) => {
    console.log(`Channel type ${DM_CHANNEL_TYPE}: ${r.channelTypeChanges.length ? `\n  ${r.channelTypeChanges.join('\n  ')}` : 'up to date'}`);
    const app = Object.entries(r.appChanges);
    console.log(`App settings: ${app.length ? `\n  ${app.map(([k, v]) => `${k} -> ${JSON.stringify(v)}`).join('\n  ')}` : 'up to date'}`);
    for (const w of r.warnings) console.warn(`WARNING: ${w}`);
    if (!apply) {
      if (r.channelTypeChanges.length || app.length) console.log('\nDry run only. Re-run with --apply to make these changes.');
      return;
    }
    if (r.remaining.length) {
      console.error(`Channel type still differs after apply:\n  ${r.remaining.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`Applied and verified ${DM_CHANNEL_TYPE}.`);
  })
  .catch((err) => {
    console.error(`Stream setup failed: ${(err as Error).message}`);
    process.exit(1);
  });
