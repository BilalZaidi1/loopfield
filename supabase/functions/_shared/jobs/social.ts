import { BUCKETS } from '../blobs.ts';
import { dmChannelId, inQuietHours, jpegDimensions, safePushPreview, SOCIAL_RULES, stripJpegMetadata, UnsupportedImageError, type NotificationPrefs } from '../core/index.ts';
import { clubInvitationEmail, sha256Hex } from '../email.ts';
import { NonRetryableError, type JobHandler } from './context.ts';
import { pgArray } from '../clients.ts';

/** Strip metadata, validate and publish processed derivatives; originals never reach viewers (FR39). */
export const processPostMedia: JobHandler = async (payload, ctx) => {
  const postId = String(payload.post_id ?? '');
  const media = await ctx.sql`select id, upload_path, status from public.post_media where post_id = ${postId} and status in ('processing', 'uploaded') order by position`;
  for (const m of media) {
    const original = await ctx.blobs.get(BUCKETS.uploads, m.upload_path);
    if (!original) {
      await ctx.sql`update public.post_media set status = 'rejected', reject_reason = 'upload missing' where id = ${m.id}`;
      continue;
    }
    try {
      if (original.byteLength > SOCIAL_RULES.maxOriginalImageBytes.value) throw new UnsupportedImageError('image larger than 10 MB');
      const { bytes } = stripJpegMetadata(original);
      const dims = jpegDimensions(bytes);
      if (!dims || dims.width > 4096 || dims.height > 4096) throw new UnsupportedImageError('image dimensions unsupported');
      const derivative = `${postId}/${m.id}.jpg`;
      await ctx.blobs.put(BUCKETS.media, derivative, bytes, 'image/jpeg');
      await ctx.sql`update public.post_media set status = 'ready', derivative_path = ${derivative}, width = ${dims.width}, height = ${dims.height}, bytes = ${bytes.byteLength} where id = ${m.id}`;
    } catch (e) {
      if (!(e instanceof UnsupportedImageError)) throw e;
      await ctx.sql`update public.post_media set status = 'rejected', reject_reason = ${e.message} where id = ${m.id}`;
    }
    await ctx.blobs.remove(BUCKETS.uploads, [m.upload_path]);
  }
  // A failed upload never creates a false published state: publish only with content that survived.
  const [state] = await ctx.sql`
    select p.body, p.shared_summary, p.route_course_id, p.status,
           count(*) filter (where m.status = 'ready') as ready, count(*) filter (where m.status in ('uploaded', 'processing')) as pending
      from public.posts p left join public.post_media m on m.post_id = p.id where p.id = ${postId} group by p.id`;
  if (!state || state.status !== 'processing' || Number(state.pending) > 0) return;
  const hasContent = Number(state.ready) > 0 || state.body || state.shared_summary || state.route_course_id;
  await ctx.sql`update public.posts set status = ${hasContent ? 'published' : 'deleted'}, published_at = case when ${!!hasContent} then now() end where id = ${postId}`;
  if (hasContent) await ctx.sql`select internal.notify_post_mentions(${postId}::uuid)`;
};

export const deletePostMedia: JobHandler = async (payload, ctx) => {
  const postId = String(payload.post_id ?? '');
  const media = await ctx.sql`select id, upload_path, derivative_path from public.post_media where post_id = ${postId}`;
  const derivatives = media.map((m) => m.derivative_path).filter(Boolean) as string[];
  if (derivatives.length) await ctx.blobs.remove(BUCKETS.media, derivatives);
  await ctx.blobs.remove(BUCKETS.uploads, media.map((m) => m.upload_path as string));
  await ctx.sql`delete from public.post_media where post_id = ${postId}`;
};

function prefsFromRow(r: Record<string, unknown> | undefined): NotificationPrefs {
  return {
    social: (r?.social as boolean) ?? true,
    messages: (r?.messages as boolean) ?? true,
    clubs: (r?.clubs as boolean) ?? true,
    competitiveDigest: (r?.competitive_digest as boolean) ?? true,
    territoryLoss: (r?.territory_loss as boolean) ?? true,
    marketing: false,
    quietStart: (r?.quiet_start as string | null)?.slice(0, 5) ?? null,
    quietEnd: (r?.quiet_end as string | null)?.slice(0, 5) ?? null,
    timezone: (r?.timezone as string) ?? 'UTC'
  };
}

/** Deliver pending in-app notifications as safe pushes (no message text, health or route detail). */
export const pushPending: JobHandler = async (payload, ctx) => {
  const userId = String(payload.user_id ?? '');
  const [prefRow] = await ctx.sql`select * from public.notification_prefs where user_id = ${userId}`;
  const prefs = prefsFromRow(prefRow);
  const pending = await ctx.sql`
    select n.id, n.category, n.kind, n.data, n.actor_id, a.display_name as actor_name
      from public.notifications n left join public.profiles a on a.id = n.actor_id and a.status = 'active'
     where n.user_id = ${userId} and n.push_state = 'pending' order by n.created_at limit 50`;
  if (!pending.length) return;
  if (inQuietHours(prefs, new Date())) {
    // Deferred, not dropped: retry after quiet hours (re-enqueued with the same dedupe key).
    await ctx.sql`select internal.enqueue_job('notifications', 'push_pending', ${ctx.sql.json({ user_id: userId })}::jsonb, ${'push-quiet:' + userId}, now() + interval '30 minutes')`;
    return;
  }
  const mutedConversations = new Set(
    (await ctx.sql`select c.channel_id from public.conversation_prefs cp join public.conversations c on c.id = cp.conversation_id where cp.user_id = ${userId} and cp.muted`).map((r) => r.channel_id as string)
  );
  const tokens = await ctx.sql`select token from public.push_tokens where user_id = ${userId} and disabled_at is null`;
  const send: Array<{ id: string; title: string; body: string; data: Record<string, string> }> = [];
  const suppressed: string[] = [];
  for (const n of pending) {
    const category = n.category as 'social' | 'message' | 'club' | 'competitive' | 'system';
    const enabled = category === 'social' ? prefs.social : category === 'message' ? prefs.messages : category === 'club' ? prefs.clubs : category === 'competitive' ? prefs.competitiveDigest : true;
    const channel = (n.data as Record<string, string>)?.channel_id;
    if (!enabled || (channel && mutedConversations.has(channel)) || tokens.length === 0) {
      suppressed.push(n.id);
      continue;
    }
    const preview = safePushPreview(n.kind, n.actor_name ?? null);
    send.push({ id: n.id, ...preview, data: { notification_id: n.id, kind: n.kind, ...(channel ? { channel_id: channel } : {}) } });
  }
  if (suppressed.length) await ctx.sql`update public.notifications set push_state = 'suppressed' where id = any(${pgArray(suppressed)}::uuid[])`;
  if (!send.length) return;
  const messages = send.flatMap((s) => tokens.map((t) => ({ to: t.token as string, title: s.title, body: s.body, data: s.data })));
  const results = await ctx.integrations.sendPush(messages);
  const invalid = results.filter((r) => r.invalidToken).map((r) => r.token);
  if (invalid.length) await ctx.sql`update public.push_tokens set disabled_at = now() where token = any(${pgArray(invalid)}::text[])`;
  await ctx.sql`update public.notifications set push_state = ${results.some((r) => r.ok) ? 'sent' : 'failed'} where id = any(${pgArray(send.map((s) => s.id))}::uuid[])`;
};

/** One aggregated competitive update per user per local day (PRD §7), sent at the user's digest hour. */
export const dispatchDigests: JobHandler = async (_payload, ctx) => {
  const users = await ctx.sql`
    select d.user_id, np.timezone, np.competitive_digest, np.territory_loss,
           count(*) filter (where d.kind like 'territory%') as territory_items,
           count(*) filter (where d.kind like 'title%') as title_items,
           count(*) filter (where d.kind = 'territory_lost') as lost_items
      from internal.digest_items d left join public.notification_prefs np on np.user_id = d.user_id
     where d.digested_at is null group by d.user_id, np.timezone, np.competitive_digest, np.territory_loss limit 1000`;
  for (const u of users) {
    const tz = (u.timezone as string) ?? 'UTC';
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (localHour < SOCIAL_RULES.dailyDigestHourLocal.value) continue;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    if (u.competitive_digest !== false) {
      const onlyLoss = Number(u.territory_items) === Number(u.lost_items) && Number(u.title_items) === 0;
      if (!(onlyLoss && u.territory_loss === false)) {
        if (Number(u.territory_items) > 0) {
          await ctx.sql`select internal.notify(${u.user_id}::uuid, 'competitive', 'territory_digest', null, 'digest', ${day}, ${ctx.sql.json({ items: Number(u.territory_items) })}::jsonb, ${'digest-territory:' + day})`;
        }
        if (Number(u.title_items) > 0) {
          await ctx.sql`select internal.notify(${u.user_id}::uuid, 'competitive', 'title_digest', null, 'digest', ${day}, ${ctx.sql.json({ items: Number(u.title_items) })}::jsonb, ${'digest-title:' + day})`;
        }
      }
    }
    await ctx.sql`update internal.digest_items set digested_at = now() where user_id = ${u.user_id} and digested_at is null`;
  }
};

/** Club invitation email: the raw address and token exist only in the job payload and are wiped after sending. */
export const clubInvitationEmailJob: JobHandler = async (payload, ctx, job) => {
  const to = String(payload.to ?? '');
  const token = String(payload.token ?? '');
  if (!to || !token) return; // already sent and scrubbed
  const toHash = await sha256Hex(to.toLowerCase());
  const [suppressed] = await ctx.sql`select 1 from internal.email_suppressions where email_hash = ${toHash}`;
  if (!suppressed) {
    const [info] = await ctx.sql`select c.name, p.display_name from public.clubs c left join public.profiles p on p.id = ${String(payload.inviter_id)} where c.id = ${String(payload.club_id)}`;
    if (!info) throw new NonRetryableError('club not found');
    const url = `${ctx.env.APP_LINK_BASE}club-invite?token=${encodeURIComponent(token)}`;
    const mail = clubInvitationEmail(ctx.env.APP_NAME, info.name, info.display_name ?? 'A runner', url);
    const { id } = await ctx.integrations.sendEmail({ to, ...mail, tag: 'club_invitation', idempotencyKey: `club-invite-${await sha256Hex(token)}` });
    await ctx.sql`insert into internal.email_log (to_hash, template, provider_id, status) values (${toHash}, 'club_invitation', ${id}, 'sent')`;
  } else {
    await ctx.sql`insert into internal.email_log (to_hash, template, status) values (${toHash}, 'club_invitation', 'suppressed')`;
  }
  await ctx.sql`update internal.jobs set payload = payload - 'to' - 'token' where id = ${job.id}`;
};

/** Block/unblock: freeze or unfreeze the DM channel server-side (blocks stop new delivery, FR41). */
export const syncBlock: JobHandler = async (payload, ctx) => {
  const a = String(payload.a);
  const b = String(payload.b);
  const [conv] = await ctx.sql`select id, channel_id, frozen, frozen_reason from public.conversations where member_a = least(${a}::uuid, ${b}::uuid) and member_b = greatest(${a}::uuid, ${b}::uuid)`;
  if (!conv) return;
  const [blocked] = await ctx.sql`select authz.is_blocked(${a}::uuid, ${b}::uuid) as v`;
  const shouldFreeze = Boolean(blocked?.v);
  if (shouldFreeze === conv.frozen) return;
  if (!ctx.integrations.chat) throw new Error('chat integration not configured');
  await ctx.integrations.chat.setFrozen(conv.channel_id ?? dmChannelId(a, b), shouldFreeze);
  await ctx.sql`update public.conversations set frozen = ${shouldFreeze}, frozen_reason = ${shouldFreeze ? 'block' : null} where id = ${conv.id}`;
};

export const deactivateChatUser: JobHandler = async (payload, ctx) => {
  if (!ctx.integrations.chat) throw new Error('chat integration not configured');
  await ctx.integrations.chat.deactivateUser(String(payload.user_id));
};

export const moderateMessage: JobHandler = async (payload, ctx) => {
  if (!ctx.integrations.chat) throw new Error('chat integration not configured');
  await ctx.integrations.chat.deleteMessage(String(payload.message_id));
};
