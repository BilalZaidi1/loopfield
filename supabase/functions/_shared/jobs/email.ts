import { DEFAULT_EMAIL_PREFS, EMAIL_CATEGORY, emailAllowed, type EmailPrefs, type EmailTemplate } from '../core/index.ts';
import {
  clubApprovedEmail,
  clubClosedEmail,
  clubInviteEmail,
  clubOwnershipEmail,
  EmailSendError,
  eventRegisteredEmail,
  eventReminderEmail,
  eventResultsEmail,
  runSummaryEmail,
  seasonResultsEmail,
  sha256Hex,
  territoryDailyEmail,
  welcomeEmail,
  type EmailLinks,
  type RenderedEmail,
  type Units
} from '../email.ts';
import { ConfigError } from '../env.ts';
import type { JobHandler } from './context.ts';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const kindOf = (v: unknown): 'community' | 'group' => (v === 'group' ? 'group' : 'community');

/** Skips are final (recorded once); `reason` never contains the address. */
class Skip extends Error {}

/**
 * Sends one queued email (internal.email_outbox). The address is read from auth at send time and never
 * stored with the job; preferences and suppressions are re-checked here, so turning an email off or a
 * bounce stops it even after it was queued. Failures Resend will not accept again are recorded and not
 * retried; transient ones retry with the job's backoff.
 */
export const sendEmailJob: JobHandler = async (payload, ctx, job) => {
  const key = String(payload.key ?? '');
  const [row] = await ctx.sql`select dedupe_key, user_id, template, data, status from internal.email_outbox where dedupe_key = ${key}`;
  if (!row || row.status !== 'queued') return;
  const template = row.template as EmailTemplate;
  const userId = String(row.user_id);
  const data = (row.data ?? {}) as Row;
  const finish = async (status: 'sent' | 'skipped' | 'failed', reason: string | null, providerId: string | null = null) => {
    await ctx.sql`update internal.email_outbox set status = ${status}, reason = ${reason}, provider_id = ${providerId}, sent_at = case when ${status} = 'sent' then now() else sent_at end
                   where dedupe_key = ${key}`;
  };
  try {
    const [u] = await ctx.sql`
      select p.status, coalesce(us.units, 'metric') as units, np.timezone, np.email_runs, np.email_territory, np.email_clubs, np.email_events
        from public.profiles p left join public.user_settings us on us.user_id = p.id left join public.notification_prefs np on np.user_id = p.id
       where p.id = ${userId}`;
    if (!u || u.status !== 'active') throw new Skip('inactive');
    const prefs: EmailPrefs = {
      runs: (u.email_runs as boolean | null) ?? DEFAULT_EMAIL_PREFS.runs,
      territory: (u.email_territory as boolean | null) ?? DEFAULT_EMAIL_PREFS.territory,
      clubs: (u.email_clubs as boolean | null) ?? DEFAULT_EMAIL_PREFS.clubs,
      events: (u.email_events as boolean | null) ?? DEFAULT_EMAIL_PREFS.events
    };
    if (!emailAllowed(prefs, template)) throw new Skip('preference');
    const to = await ctx.integrations.auth.getEmail(userId);
    if (!to) throw new Skip('no_address');
    const toHash = await sha256Hex(to.toLowerCase());
    const [suppressed] = await ctx.sql`select reason from internal.email_suppressions where email_hash = ${toHash}`;
    if (suppressed) {
      await ctx.sql`insert into internal.email_log (to_hash, template, status) values (${toHash}, ${template}, 'suppressed')`;
      throw new Skip(`suppressed_${suppressed.reason}`);
    }

    const category = EMAIL_CATEGORY[template];
    const web = ctx.env.APP_WEB_URL;
    const token = category === 'account' ? null : String((await ctx.sql`select internal.email_token(${userId}) as t`)[0]!.t);
    const links = (path: string): EmailLinks => ({
      open: `${web}${path}`,
      settings: `${web}/settings/notifications`,
      unsubscribe: token ? `${web}/unsubscribe?t=${encodeURIComponent(token)}&c=${category}` : undefined
    });
    const units = (u.units === 'imperial' ? 'imperial' : 'metric') as Units;
    const tz = (u.timezone as string | null) ?? 'UTC';
    const app = ctx.env.APP_NAME;
    const mail = await render(ctx, template, data, { app, units, tz, links, userId });

    const headers = token
      ? {
          'List-Unsubscribe': `<${ctx.env.SUPABASE_URL}/functions/v1/email/unsubscribe?t=${encodeURIComponent(token)}&c=${category}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      : undefined;
    try {
      const { id } = await ctx.integrations.sendEmail({ to, ...mail, tag: template, idempotencyKey: `mail-${await sha256Hex(key)}`, headers });
      await ctx.sql`insert into internal.email_log (to_hash, template, provider_id, status) values (${toHash}, ${template}, ${id}, 'sent') on conflict do nothing`;
      await finish('sent', null, id);
    } catch (err) {
      if (err instanceof EmailSendError && !err.retryable) {
        await ctx.sql`insert into internal.email_log (to_hash, template, status) values (${toHash}, ${template}, 'failed')`;
        await finish('failed', `resend_${err.status}`);
        return;
      }
      if (err instanceof ConfigError) {
        await finish('failed', 'not_configured');
        return;
      }
      // claim_jobs counts the current attempt, so this is the last one when attempts reach the maximum.
      if (job.attempts >= job.max_attempts) await finish('failed', 'retries_exhausted');
      throw err;
    }
  } catch (err) {
    if (err instanceof Skip) {
      await finish('skipped', err.message);
      return;
    }
    throw err;
  }
};

async function render(
  ctx: Parameters<JobHandler>[1],
  template: EmailTemplate,
  data: Row,
  o: { app: string; units: Units; tz: string; links: (path: string) => EmailLinks; userId: string }
): Promise<RenderedEmail> {
  const sql = ctx.sql;
  const objectId = str(data.object_id);
  const club = async (id: string | null) => {
    if (!id) throw new Skip('missing_club');
    const [c] = await sql`select name, kind, status from public.clubs where id = ${id}`;
    if (!c || c.status !== 'active') throw new Skip('club_gone');
    return { name: String(c.name), kind: kindOf(c.kind) };
  };
  const person = async (id: string | null) => {
    if (!id) return 'A runner';
    const [p] = await sql`select display_name from public.profiles where id = ${id} and status = 'active'`;
    return p ? String(p.display_name) : 'A runner';
  };
  switch (template) {
    case 'welcome':
      return welcomeEmail(o.app, o.links(''));
    case 'run_summary': {
      const activityId = str(data.activity_id);
      const [a] = await sql`select id, user_id, status, started_at, distance_m, elapsed_ms, moving_ms, avg_pace_s_per_km from public.activities where id = ${activityId}`;
      if (!a || a.status === 'deleted' || a.status === 'failed' || !num(a.distance_m)) throw new Skip('activity_gone');
      const [land] = await sql`
        select coalesce(sum(case when ec.new_controller = ${a.user_id} and ec.prior_controller is distinct from ec.new_controller then 1 end), 0)::int as cells,
               coalesce(sum(case when ec.new_controller = ${a.user_id} and ec.prior_controller is not null and ec.prior_controller <> ${a.user_id} then 1 end), 0)::int as taken,
               sum(case when ec.new_controller = ${a.user_id} and ec.prior_controller is distinct from ec.new_controller then tc.area_m2 end) as area
          from public.loop_claims root
          join public.loop_claims lc on coalesce(lc.parent_claim_id, lc.id) = root.id
          join public.competitions c on c.id = lc.competition_id and c.kind = 'permanent'
          join internal.territory_events te on te.claim_id = lc.id and te.kind = 'capture' and te.published_at is not null
          join internal.territory_event_cells ec on ec.event_id = te.id
          left join internal.territory_cells tc on tc.cell = ec.cell
         where root.activity_id = ${a.id}`;
      const date = new Intl.DateTimeFormat('en-GB', { timeZone: o.tz, day: 'numeric', month: 'short' }).format(new Date(String(a.started_at)));
      return runSummaryEmail(o.app, {
        date,
        distanceM: Number(a.distance_m),
        elapsedMs: Number(a.moving_ms ?? a.elapsed_ms ?? 0),
        paceSecPerKm: num(a.avg_pace_s_per_km),
        units: o.units,
        land: land && Number(land.cells) > 0 ? { cells: Number(land.cells), taken: Number(land.taken), areaM2: num(land.area) } : null,
        links: o.links(`/activities/${a.id}`)
      });
    }
    case 'territory_daily': {
      const gained = num(data.gained_cells) ?? 0;
      const lost = num(data.lost_cells) ?? 0;
      if (!gained && !lost) throw new Skip('nothing_to_say');
      return territoryDailyEmail(o.app, { gained, lost, links: o.links('/map') });
    }
    case 'club_invite': {
      const c = await club(objectId);
      const [m] = await sql`select state from public.club_memberships where club_id = ${objectId} and user_id = ${o.userId}`;
      if (m && m.state !== 'invited') throw new Skip('invite_answered');
      return clubInviteEmail(o.app, { clubName: c.name, kind: c.kind, inviter: await person(str(data.actor_id)), links: o.links(`/club/${objectId}`) });
    }
    case 'club_approved': {
      const c = await club(objectId);
      return clubApprovedEmail(o.app, { clubName: c.name, kind: c.kind, links: o.links(`/club/${objectId}`) });
    }
    case 'club_ownership': {
      const c = await club(objectId);
      return clubOwnershipEmail(o.app, { clubName: c.name, kind: c.kind, from: await person(str(data.actor_id)), links: o.links(`/club/${objectId}`) });
    }
    case 'club_closed':
      return clubClosedEmail(o.app, { clubName: str(data.club_name) ?? 'A community', kind: kindOf(data.kind), links: o.links('/clubs') });
    case 'event_registered':
    case 'event_reminder': {
      const eventId = str(data.event_id) ?? objectId;
      const [e] = await sql`
        select c.id, c.name, c.event_type, c.team_mode, c.target_m, c.starts_at, c.ends_at, c.status, c.cancelled_at, r.name as region_name, k.name as club_name
          from public.competitions c left join public.regions r on r.id = c.region_id
          left join public.clubs k on k.id = ${str(data.club_id)}
         where c.id = ${eventId} and c.kind = 'event'`;
      if (!e || e.status !== 'active' || e.cancelled_at) throw new Skip('event_gone');
      if (template === 'event_reminder') {
        if (new Date(String(e.starts_at)).getTime() <= Date.now()) throw new Skip('stale');
        return eventReminderEmail(o.app, { name: String(e.name), startsAt: String(e.starts_at), timeZone: o.tz, links: o.links(`/events/${e.id}`) });
      }
      const target = num(e.target_m);
      const scoring = e.event_type === 'territory'
        ? `Land you capture${e.region_name ? ` in ${e.region_name}` : ''} while it is on counts${e.team_mode === 'club' ? ' for your club' : ''}.`
        : `Every distance you run while it is on counts${target ? ` towards a goal of ${(target / 1000).toFixed(0)} km` : ''}${e.team_mode === 'club' ? ', added up for your club' : ''}.`;
      return eventRegisteredEmail(o.app, {
        name: String(e.name), startsAt: String(e.starts_at), endsAt: String(e.ends_at), timeZone: o.tz, scoring,
        clubName: e.club_name ? String(e.club_name) : null, links: o.links(`/events/${e.id}`)
      });
    }
    case 'event_results':
      return eventResultsEmail(o.app, { name: str(data.name) ?? 'The event', rank: num(data.rank), clubRank: num(data.club_rank), links: o.links(`/events/${objectId}`) });
    case 'season_results':
      return seasonResultsEmail(o.app, {
        name: str(data.name) ?? 'season', season: num(data.season) ?? 1, rank: num(data.rank) ?? 1, runners: num(data.runners) ?? 1,
        areaM2: num(data.area_m2) ?? 0, units: o.units, links: o.links('/seasons')
      });
  }
}
