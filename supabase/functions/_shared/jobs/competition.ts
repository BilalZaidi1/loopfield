import {
  buildCourse,
  canonicalSamples,
  decide,
  encodePolyline,
  evaluateLoop,
  evaluateMovement,
  evaluateSpeedAttempt,
  integrityRulesWith,
  isDuplicateCourse,
  isUsable,
  SPEED_RULES,
  simplify,
  summarizeActivity,
  MOVEMENT_RULES,
  TERRITORY_RULES,
  withRuleOverrides,
  withThreshold,
  type CourseGeometry,
  type IntegrityRules,
  type LatLng,
  type ReasonCode
} from '../core/index.ts';
import { candidateCells, cellRecords, visitedCells } from '../h3cells.ts';
import { loadEvidence, type Evidence } from './evidence.ts';
import { NonRetryableError, type JobContext, type JobHandler } from './context.ts';
import { pgArray } from '../clients.ts';

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new NonRetryableError(`payload.${name} missing`);
  return v;
};

/**
 * Movement points from server-verified distance (public or private runs alike). The database awards
 * each run once and applies the daily cap; mocked evidence verifies 0 m and earns nothing.
 */
/** Integrity thresholds with the backend's overrides (`app_config.integrity_overrides`) applied. */
async function integrityRules(ctx: JobContext): Promise<IntegrityRules> {
  const [row] = await ctx.sql`select value from public.app_config where key = 'integrity_overrides'`;
  return integrityRulesWith(row?.value ?? null);
}

/**
 * The rules a run is judged by: the built-in rules with the overrides saved for its pinned version
 * (back office → Game rules). Runs keep the version from their recording ticket, so changing the
 * rules never re-judges a run that was already recorded.
 */
async function rulesFor<T extends { readonly version: string }>(ctx: JobContext, family: 'territory' | 'speed', base: T, version: string | null | undefined): Promise<T> {
  if (!version || version === base.version) return base;
  const [row] = await ctx.sql`select overrides from internal.rule_versions where version = ${version} and family = ${family}`;
  return row ? withRuleOverrides(base, row.overrides, version) : base;
}

/** Speed rules of the running season race (the public competition), for route proposals, which have no ticket. */
async function currentSpeedRules(ctx: JobContext): Promise<typeof SPEED_RULES> {
  const [s] = await ctx.sql`
    select s.speed_rules_version from public.seasons s join public.competitions c on c.id = s.competition_id
     where c.kind = 'public' and s.status = 'active' order by s.starts_at desc limit 1`;
  return rulesFor(ctx, 'speed', SPEED_RULES, s?.speed_rules_version);
}

/** Reasons that put a run on the integrity review trail, whatever the final decision. */
const SPEED_SIGNALS: readonly ReasonCode[] = ['suspicious_speed', 'implausible_speed', 'no_running_steps'];

async function awardMovement(ctx: JobContext, ev: Evidence) {
  const integrity = await integrityRules(ctx);
  const [cfg] = await ctx.sql`select value from public.app_config where key = 'movement_min_distance_m'`;
  const movement = withThreshold(MOVEMENT_RULES, 'minVerifiedDistanceMeters', typeof cfg?.value === 'number' ? cfg.value : null);
  const m = evaluateMovement(ev.samples, ev.events, movement, integrity);
  // Any run (public or private) moving unlike a runner is marked and kept on the review trail.
  const flags = m.reasons.filter((r) => SPEED_SIGNALS.includes(r));
  await ctx.sql`select internal.flag_activity(${ev.activityId}::uuid, ${pgArray(flags)}::text[], ${ctx.sql.json({ rule_version: integrity.version, excluded_m: m.excludedDistanceM } as never)}::jsonb)`;
  await ctx.sql`select internal.award_movement_points(${ev.activityId}::uuid, ${m.verifiedDistanceM}, ${m.ruleVersion}, ${pgArray(m.reasons)}::text[])`;
  ctx.log('movement evaluated', { activityId: ev.activityId, decision: m.decision, verifiedM: m.verifiedDistanceM, reasons: m.reasons });
}

/** Backfill for runs recorded before movement points existed (skips runs without evidence). */
export const awardMovementJob: JobHandler = async (payload, ctx) => {
  const activityId = str(payload.activity_id, 'activity_id');
  const [a] = await ctx.sql`select status, deleted_at, raw_evidence_purged_at from public.activities where id = ${activityId}`;
  if (!a || a.deleted_at || a.raw_evidence_purged_at || a.status !== 'processed') return;
  await awardMovement(ctx, await loadEvidence(ctx, activityId));
};

/** Canonical server summary + private exploration (independent of competitive outcomes). */
export const reconcileActivity: JobHandler = async (payload, ctx) => {
  const ev = await loadEvidence(ctx, str(payload.activity_id, 'activity_id'));
  const summary = summarizeActivity(ev.samples, ev.events);
  const usable = ev.samples.filter((s) => isUsable(s));
  const route = usable.length > 1 ? encodePolyline(simplify(usable, 5)) : null;
  await ctx.sql`
    update public.activities set
      distance_m = ${summary.distanceM}, elapsed_ms = ${summary.elapsedMs}, moving_ms = ${summary.movingMs}, paused_ms = ${summary.pausedMs},
      avg_pace_s_per_km = ${summary.avgPaceSecPerKm}, elevation_gain_m = ${summary.elevationGainM},
      splits = ${ctx.sql.json(summary.splits as never)}, gaps = ${ctx.sql.json(summary.gaps as never)},
      sample_count = ${summary.sampleCount}, usable_sample_count = ${summary.usableSampleCount},
      personal_route = ${route}, summary_source = 'server', status = 'processed'
    where id = ${ev.activityId} and deleted_at is null`;
  if (usable.length) {
    const cells = visitedCells(usable, TERRITORY_RULES.explorationResolution.value);
    await ctx.sql`select internal.record_exploration(${ev.activityId}::uuid, ${ev.userId}::uuid, ${pgArray(cells)}::bigint[], ${ev.startedAt})`;
  }
  await awardMovement(ctx, ev);
};

async function setClaimOutcome(ctx: JobContext, claimId: string, status: string, reasons: ReasonCode[], extra: { completedAt?: number | null; lengthM?: number } = {}) {
  await ctx.sql`
    update public.loop_claims set status = ${status}, reasons = ${pgArray(reasons)}::text[], validated_at = now(),
           completed_at = coalesce(${extra.completedAt ? new Date(extra.completedAt) : null}, completed_at),
           length_m = coalesce(${extra.lengthM ?? null}, length_m)
     where id = ${claimId} and status = 'processing'`;
}

/**
 * Territory branch: pre-validation, H3 candidates, PostGIS evaluation, transactional apply.
 * One run's loop is evaluated once and decided for each layer it counts in: its race claim (the
 * primary, which carries the review trail) and the claims derived from it (the all-time map, territory
 * events), each against its own season window. `reviewed` re-evaluates after a reviewer cleared the
 * movement signals of a held run.
 */
export const evaluateLoopJob: JobHandler = async (payload, ctx) => {
  const requested = str(payload.claim_id, 'claim_id');
  const reviewed = payload.reviewed === true;
  const claims = await ctx.sql`
    with root as (select coalesce(parent_claim_id, id) as id from public.loop_claims where id = ${requested})
    select lc.id, lc.parent_claim_id, lc.activity_id, lc.status, lc.season_id, s.grid_resolution, s.starts_at, s.ends_at,
           coalesce(rs.territory_rules_version, s.territory_rules_version) as territory_rules_version
      from public.loop_claims lc join root on lc.id = root.id or lc.parent_claim_id = root.id
      left join public.seasons s on s.id = lc.season_id
      left join public.activities a on a.id = lc.activity_id
      left join internal.recording_sessions rs on rs.ticket_id = a.ticket_id
     order by lc.parent_claim_id nulls first, lc.id`;
  const primary = claims.find((c) => !c.parent_claim_id);
  const pending = claims.filter((c) => c.status === 'processing');
  if (!primary || !pending.length) return; // idempotent
  const ev = await loadEvidence(ctx, primary.activity_id);
  const integrity = await integrityRules(ctx);
  const territory = await rulesFor(ctx, 'territory', TERRITORY_RULES, primary.territory_rules_version);
  const result = evaluateLoop(ev.samples, ev.events, territory, integrity);
  const base = reviewed ? result.reasons.filter((r) => !SPEED_SIGNALS.includes(r)) : [...result.reasons];
  const ring = result.ring.map((p) => [p.lng, p.lat]);
  const cellsByResolution = new Map<number, string[]>();
  const candidatesFor = async (resolution: number): Promise<string[]> => {
    const known = cellsByResolution.get(resolution);
    if (known) return known;
    const records = cellRecords(candidateCells(result.ring, resolution, TERRITORY_RULES.maxCandidateCells.value), resolution);
    const decIds = records.map((r) => r.cell);
    const existing = new Set<string>(
      (await ctx.sql`select cell::text as cell from internal.territory_cells where cell = any(${pgArray(decIds)}::bigint[])`).map((r) => r.cell as string)
    );
    const missing = records.filter((r) => !existing.has(r.cell));
    for (let i = 0; i < missing.length; i += 1500) {
      await ctx.sql`select internal.upsert_cells(${ctx.sql.json(missing.slice(i, i + 1500) as never)}::jsonb)`;
    }
    cellsByResolution.set(resolution, decIds);
    return decIds;
  };

  for (const claim of pending) {
    const isPrimary = !claim.parent_claim_id;
    const reasons = [...base];
    if (result.completedAt && result.startedAt && claim.starts_at && claim.ends_at) {
      const inSeason = (t: number) => t >= new Date(claim.starts_at).getTime() && t < new Date(claim.ends_at).getTime();
      if (!inSeason(result.startedAt) || !inSeason(result.completedAt)) reasons.push('season_boundary');
    }
    const decision = decide(reasons);
    if (decision !== 'eligible') {
      await setClaimOutcome(ctx, claim.id, decision, reasons, { completedAt: result.completedAt, lengthM: result.lengthM });
      const signals = reasons.filter((r) => SPEED_SIGNALS.includes(r));
      if (isPrimary && (decision === 'pending_review' || signals.length)) {
        // Audit trail on the race claim (its layers follow it): every loop held for review, and every loop
        // that moved unlike a runner even when other problems already stop it from counting.
        await ctx.sql`insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by, hold_from_competition, signals)
                      values ('loop_claim', ${claim.id}, ${ev.userId}, 'system', ${decision === 'pending_review'},
                              ${ctx.sql.json({ reasons, rule_version: integrity.version } as never)}::jsonb)`;
      }
      ctx.log('loop not eligible', { claimId: claim.id, layer: isPrimary ? 'race' : 'derived', reasons });
      continue;
    }
    await ctx.sql`update public.loop_claims set completed_at = ${new Date(result.completedAt!)}, length_m = ${result.lengthM}, algorithm_version = ${result.ruleVersion} where id = ${claim.id}`;
    const decIds = await candidatesFor(Number(claim.grid_resolution ?? TERRITORY_RULES.gridResolution.value));
    const [evaluated] = await ctx.sql`select status from internal.evaluate_claim_geometry(${claim.id}::uuid, ${ctx.sql.json(ring as never)}::jsonb, ${pgArray(decIds)}::bigint[])`;
    if (evaluated?.status === 'eligible') await ctx.sql`select internal.apply_claim(${claim.id}::uuid)`;
    ctx.log('loop evaluated', { claimId: claim.id, layer: isPrimary ? 'race' : 'derived', status: evaluated?.status, candidates: decIds.length });
  }
};

export async function loadCourse(ctx: JobContext, courseVersionId: string): Promise<{ geometry: CourseGeometry; status: string; courseStatus: string } | null> {
  const [cv] = await ctx.sql`
    select cv.status, c.status as course_status, cv.length_m, cv.corridor_m, cv.checkpoints, cv.start_bearing, cv.finish_bearing,
           extensions.st_asgeojson(cv.path)::jsonb as path, extensions.st_asgeojson(cv.start_gate)::jsonb as sg, extensions.st_asgeojson(cv.finish_gate)::jsonb as fg
      from public.course_versions cv join public.courses c on c.id = cv.course_id where cv.id = ${courseVersionId}`;
  if (!cv) return null;
  const toLL = (c: [number, number]): LatLng => ({ lat: c[1], lng: c[0] });
  const gate = (g: { coordinates: [number, number][] }, bearing: number) => ({ a: toLL(g.coordinates[0]!), b: toLL(g.coordinates[1]!), bearing });
  return {
    status: cv.status,
    courseStatus: cv.course_status,
    geometry: {
      path: (cv.path.coordinates as [number, number][]).map(toLL),
      startGate: gate(cv.sg, cv.start_bearing),
      finishGate: gate(cv.fg, cv.finish_bearing),
      checkpoints: (cv.checkpoints as Array<{ lat: number; lng: number; radius_m: number }>).map((c) => ({ point: { lat: c.lat, lng: c.lng }, radiusM: c.radius_m })),
      corridorM: cv.corridor_m,
      lengthM: cv.length_m
    }
  };
}

/** Speed branch: same-course matching on the immutable version; titles replay in SQL. Never touches land. */
export const evaluateAttemptJob: JobHandler = async (payload, ctx) => {
  const attemptId = str(payload.attempt_id, 'attempt_id');
  const [att] = await ctx.sql`
    select sa.id, sa.activity_id, sa.status, sa.course_version_id, sa.competition_id, sa.season_id, s.starts_at, s.ends_at,
           coalesce(rs.speed_rules_version, s.speed_rules_version) as speed_rules_version, coalesce(s.publication_delay_minutes, 30) as publication_delay_minutes
      from public.speed_attempts sa left join public.seasons s on s.id = sa.season_id
      left join public.activities a on a.id = sa.activity_id
      left join internal.recording_sessions rs on rs.ticket_id = a.ticket_id
     where sa.id = ${attemptId}`;
  if (!att || att.status !== 'processing') return;
  const ev = await loadEvidence(ctx, att.activity_id);
  const course = await loadCourse(ctx, att.course_version_id);
  const reasons: ReasonCode[] = [];
  let result = null as ReturnType<typeof evaluateSpeedAttempt> | null;
  const [cfg] = await ctx.sql`select coalesce((select value::text::boolean from public.app_config where key = 'speed_titles_enabled'), true) as enabled`;
  if (!cfg?.enabled) reasons.push('speed_suspended');
  if (!course) reasons.push('course_unavailable');
  else if (course.status !== 'active' || course.courseStatus !== 'active') reasons.push('course_suspended');
  if (course) {
    result = evaluateSpeedAttempt(ev.samples, ev.events, course.geometry, await rulesFor(ctx, 'speed', SPEED_RULES, att.speed_rules_version));
    reasons.push(...result.reasons);
    if (result.startCrossingT && result.finishCrossingT && att.starts_at) {
      const inSeason = (t: number) => t >= new Date(att.starts_at).getTime() && t < new Date(att.ends_at).getTime();
      if (!inSeason(result.startCrossingT) || !inSeason(result.finishCrossingT)) reasons.push('season_boundary');
    }
  }
  const decision = decide(reasons);
  await ctx.sql`
    update public.speed_attempts set status = ${decision}, reasons = ${pgArray(reasons)}::text[], validated_at = now(),
           algorithm_version = ${result?.ruleVersion ?? SPEED_RULES.version},
           start_crossing_at = ${result?.startCrossingT ? new Date(result.startCrossingT) : null},
           completed_at = ${result?.finishCrossingT ? new Date(result.finishCrossingT) : null},
           elapsed_ms = ${result?.elapsedMs ?? null}, uncertainty_ms = ${result?.uncertaintyMs ?? null}, coverage = ${result?.coverage ?? null},
           publish_after = greatest(coalesce(${result?.finishCrossingT ? new Date(result.finishCrossingT) : null}::timestamptz, now()) + make_interval(mins => ${Number(att.publication_delay_minutes)}::integer), now())
     where id = ${attemptId} and status = 'processing'`;
  if (decision === 'pending_review') {
    await ctx.sql`insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by, hold_from_competition) values ('speed_attempt', ${attemptId}, ${ev.userId}, 'system', true)`;
  }
  if (att.season_id) await ctx.sql`select internal.refresh_title(${att.course_version_id}::uuid, ${att.competition_id}::uuid, ${att.season_id}::uuid, 'attempt')`;
};

const toGeoLine = (pts: LatLng[]) => ({ type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) });

/** Builds a proposed course from validated evidence; clients never supply route geometry. */
export const buildRouteProposal: JobHandler = async (payload, ctx) => {
  const proposalId = str(payload.proposal_id, 'proposal_id');
  const [p] = await ctx.sql`select id, source_activity_id, creator_id, status from public.route_proposals where id = ${proposalId}`;
  if (!p || p.status !== 'processing') return;
  const decline = async (reason: string) => {
    await ctx.sql`update public.route_proposals set status = 'declined', decision_reason = ${reason}, decided_at = now() where id = ${proposalId}`;
    await ctx.sql`select internal.notify(${p.creator_id}::uuid, 'system', 'route_decided', null, 'route_proposal', ${proposalId}, '{"approved": false}'::jsonb, ${'route:' + proposalId})`;
  };
  const ev = await loadEvidence(ctx, p.source_activity_id);
  const loop = evaluateLoop(ev.samples, ev.events);
  const blocking = loop.reasons.filter((r) => !['no_eligible_cells', 'eligibility_data_unavailable', 'outside_season', 'season_boundary', 'late_upload', 'no_ticket', 'gps_spike_ignored'].includes(r));
  if (!loop.interval || blocking.length) return decline(`source loop not suitable: ${blocking.join(', ') || 'no capture interval'}`);
  const trace = canonicalSamples(ev.samples).filter((s) => s.t >= loop.interval!.startT && s.t <= loop.interval!.endT && isUsable(s));
  const course = buildCourse(trace, { closed: true });
  const speed = await currentSpeedRules(ctx);
  if (course.lengthM < speed.minCourseLengthMeters.value || course.lengthM > speed.maxCourseLengthMeters.value) {
    return decline(`course length ${course.lengthM} m is outside the ${speed.minCourseLengthMeters.value / 1000}–${speed.maxCourseLengthMeters.value / 1000} km range`);
  }
  const path = toGeoLine(course.path);
  const [mask] = await ctx.sql`
    select exists (select 1 from public.protected_areas pa where pa.user_id = ${p.creator_id}
                    and extensions.st_dwithin(pa.geom, extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(path)}), 4326)::extensions.geography, 50)) as hit`;
  if (mask?.hit) return decline('route touches one of your protected areas; it was not shared');
  const [region] = await ctx.sql`
    select r.id from public.regions r
     where extensions.st_coveredby(extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(path)}), 4326)::extensions.geography, r.geom) limit 1`;
  if (!region) return decline('route is outside a supported competition region');
  // Duplicate detection against nearby active courses (materially equivalent geometry and direction).
  const nearby = await ctx.sql`
    select c.id as course_id, cv.id as version_id from public.courses c join public.course_versions cv on cv.id = c.current_version_id
     where c.status = 'active' and extensions.st_dwithin(cv.path::extensions.geography, extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(path)}), 4326)::extensions.geography, 100)`;
  for (const n of nearby) {
    const other = await loadCourse(ctx, n.version_id);
    if (other && isDuplicateCourse(course, other.geometry, speed)) {
      await ctx.sql`update public.route_proposals set status = 'duplicate_linked', canonical_course_id = ${n.course_id}, decided_at = now(),
                    decision_reason = 'matches an existing published route' where id = ${proposalId}`;
      return;
    }
  }
  const geometry = {
    start_gate: toGeoLine([course.startGate.a, course.startGate.b]),
    finish_gate: toGeoLine([course.finishGate.a, course.finishGate.b]),
    start_bearing: course.startGate.bearing,
    finish_bearing: course.finishGate.bearing,
    checkpoints: course.checkpoints.map((c) => ({ lat: c.point.lat, lng: c.point.lng, radius_m: c.radiusM })),
    corridor_m: course.corridorM
  };
  await ctx.sql`
    update public.route_proposals set status = 'pending_review', region_id = ${region.id}, closed = true, length_m = ${course.lengthM},
           path = extensions.st_setsrid(extensions.st_geomfromgeojson(${JSON.stringify(path)}), 4326), course_geometry = ${ctx.sql.json(geometry as never)}
     where id = ${proposalId}`;
};

/**
 * Founding run (PRD §6): scored only if the original session carried speed consent and the original
 * evidence shows the published gates crossed under the identical rules; otherwise no champion yet.
 */
export const evaluateFoundingAttempt: JobHandler = async (payload, ctx) => {
  const proposalId = str(payload.proposal_id, 'proposal_id');
  const courseVersionId = str(payload.course_version_id, 'course_version_id');
  const [p] = await ctx.sql`
    select rp.source_activity_id, rp.creator_id, a.ticket_id, a.competition_id, a.season_id, a.received_at, a.ended_at, rs.modes
      from public.route_proposals rp join public.activities a on a.id = rp.source_activity_id
      left join internal.recording_sessions rs on rs.ticket_id = a.ticket_id
     where rp.id = ${proposalId}`;
  if (!p || !p.ticket_id || !p.modes?.speed || !p.season_id) {
    ctx.log('founding run not eligible (no speed consent on the original ticket)', { proposalId });
    return;
  }
  if (new Date(p.received_at).getTime() - new Date(p.ended_at).getTime() > 24 * 3600_000) return;
  const ev = await loadEvidence(ctx, p.source_activity_id);
  const course = await loadCourse(ctx, courseVersionId);
  if (!course) return;
  const startEvt = ev.events.find((e) => e.kind === 'capture_start' || e.kind === 'speed_start');
  if (!startEvt) return;
  const events = [...ev.events, { ...startEvt, kind: 'speed_start' as const }];
  const r = evaluateSpeedAttempt(ev.samples, events, course.geometry);
  const [att] = await ctx.sql`
    insert into public.speed_attempts (activity_id, user_id, course_version_id, competition_id, season_id, status, reasons, rule_version, algorithm_version,
                                      start_crossing_at, completed_at, elapsed_ms, uncertainty_ms, coverage, is_founding, received_at, validated_at, publish_after)
    values (${p.source_activity_id}, ${p.creator_id}, ${courseVersionId}, ${p.competition_id}, ${p.season_id}, ${r.decision}, ${pgArray(r.reasons)}::text[],
            ${SPEED_RULES.version}, ${r.ruleVersion}, ${r.startCrossingT ? new Date(r.startCrossingT) : null}, ${r.finishCrossingT ? new Date(r.finishCrossingT) : null},
            ${r.elapsedMs}, ${r.uncertaintyMs}, ${r.coverage}, true, ${p.received_at}, now(), now())
    on conflict (activity_id, course_version_id) do nothing returning id`;
  if (att) await ctx.sql`select internal.refresh_title(${courseVersionId}::uuid, ${p.competition_id}::uuid, ${p.season_id}::uuid, 'attempt')`;
};
