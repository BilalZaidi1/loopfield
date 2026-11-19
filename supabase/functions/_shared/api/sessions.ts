import { SEASON_RULES, SPEED_RULES_VERSION, TERRITORY_RULES_VERSION, signTicket, type SessionTicketClaims } from '../core/index.ts';
import { serverSecret, type Sql } from '../clients.ts';
import type { ServerEnv } from '../env.ts';
import { HttpError, isUuid } from '../http.ts';

export interface TicketRequest {
  mode: 'territory' | 'speed' | 'territory_speed';
  competitionId: string;
  courseVersionId?: string | null;
}

/**
 * Issue a signed competitive-session ticket (PRD §6/§17). Requires explicit, current consent for each
 * enabled mode; a speed ticket pins the course version. Private runs never need a ticket.
 */
export async function issueTicket(sql: Sql, env: ServerEnv, userId: string, req: TicketRequest, now = Date.now()) {
  const TICKET_SIGNING_SECRET = await serverSecret(sql, env.TICKET_SIGNING_SECRET, 'ticket_signing_secret');
  if (!['territory', 'speed', 'territory_speed'].includes(req.mode)) throw new HttpError(400, 'invalid_mode');
  if (!isUuid(req.competitionId)) throw new HttpError(400, 'invalid_competition');
  const modes = { territory: req.mode !== 'speed', speed: req.mode !== 'territory' };
  if (modes.speed && !isUuid(req.courseVersionId ?? '')) throw new HttpError(400, 'course_required');

  const [ok] = await sql`select internal.check_rate_limit(${userId}, 'ticket', 12, 3600) as allowed`;
  if (!ok?.allowed) throw new HttpError(429, 'rate_limited');

  const [settings] = await sql`
    select us.territory_competition_enabled, us.speed_competition_enabled, us.full_private_mode, p.status
      from public.user_settings us join public.profiles p on p.id = us.user_id where us.user_id = ${userId}`;
  if (!settings || settings.status !== 'active') throw new HttpError(403, 'account_inactive');
  if (settings.full_private_mode) throw new HttpError(409, 'full_private_mode');
  if (modes.territory && !settings.territory_competition_enabled) throw new HttpError(409, 'territory_consent_required');
  if (modes.speed && !settings.speed_competition_enabled) throw new HttpError(409, 'speed_consent_required');

  const [comp] = await sql`
    select c.id, c.kind, c.status, r.status as region_status
      from public.competitions c join public.regions r on r.id = c.region_id
     where c.id = ${req.competitionId}
       and (c.kind = 'public' or exists (select 1 from public.club_memberships m where m.club_id = c.club_id and m.user_id = ${userId} and m.state = 'active'))`;
  if (!comp || comp.status !== 'active') throw new HttpError(404, 'competition_unavailable');
  const [season] = await sql`select id, starts_at, ends_at, territory_rules_version, speed_rules_version from public.seasons where competition_id = ${req.competitionId} and starts_at <= now() and ends_at > now() and status = 'active'`;
  if (!season) throw new HttpError(409, 'no_active_season');

  const switches = Object.fromEntries((await sql`select key, value from public.app_config where key in ('territory_capture_enabled', 'speed_titles_enabled')`).map((r) => [r.key, r.value]));
  if (modes.territory && switches.territory_capture_enabled === false) throw new HttpError(503, 'capture_suspended');
  if (modes.speed) {
    if (switches.speed_titles_enabled === false) throw new HttpError(503, 'speed_suspended');
    const [cv] = await sql`select cv.status, c.status as course_status from public.course_versions cv join public.courses c on c.id = cv.course_id where cv.id = ${req.courseVersionId!}`;
    if (!cv || cv.status !== 'active' || cv.course_status !== 'active') throw new HttpError(409, 'course_unavailable');
  }

  const startBy = Math.min(now + SEASON_RULES.ticketStartWindowHours.value * 3_600_000, new Date(season.ends_at).getTime());
  const claims: SessionTicketClaims = {
    ticketId: crypto.randomUUID(),
    userId,
    modes,
    competitionId: req.competitionId,
    seasonId: season.id,
    courseVersionId: modes.speed ? req.courseVersionId! : null,
    // The season's pinned rule versions (set from the back office); the built-in ones if it has none.
    territoryRulesVersion: season.territory_rules_version ?? TERRITORY_RULES_VERSION,
    speedRulesVersion: season.speed_rules_version ?? SPEED_RULES_VERSION,
    issuedAt: now,
    startBy
  };
  const signature = await signTicket(claims, TICKET_SIGNING_SECRET);
  await sql`
    insert into internal.recording_sessions (ticket_id, user_id, modes, competition_id, season_id, course_version_id, territory_rules_version, speed_rules_version, issued_at, start_by, signature)
    values (${claims.ticketId}, ${userId}, ${sql.json(modes)}, ${claims.competitionId}, ${claims.seasonId}, ${claims.courseVersionId}, ${claims.territoryRulesVersion},
            ${claims.speedRulesVersion}, ${new Date(now)}, ${new Date(startBy)}, ${signature})`;
  return { claims, signature, season: { id: season.id, startsAt: season.starts_at, endsAt: season.ends_at } };
}
