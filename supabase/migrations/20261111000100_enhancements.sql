-- 11 Nov enhancement release (requested after PRD v1.2). Sections are added in order:
--   1. Movement integrity: suspicious runs are marked, kept on the review trail, and thresholds are tunable.
--   2. The all-time map, season races and events: permanent ownership, separate season standings,
--      isolated event standings (derived claims), operator season dates.

-- ---------------------------------------------------------------------------------------------
-- 1. Movement integrity
-- ---------------------------------------------------------------------------------------------
-- Reasons from the server's movement check that mark a run (public or private) as moving unlike a runner.
alter table public.activities add column if not exists integrity_flags text[] not null default '{}';
-- What the system saw when it opened a case (reasons, rule version, distance left out), for reviewers.
alter table public.integrity_cases add column if not exists signals jsonb not null default '{}';

insert into public.app_config (key, value, description, is_public) values
  ('integrity_overrides', '{}'::jsonb,
   'Overrides for movement integrity thresholds (INTEGRITY_RULES keys, e.g. {"version": "v2", "stepsMinCadence": 90}). Unknown keys and out-of-range values are ignored; empty means the defaults.',
   true)
on conflict (key) do nothing;

-- Distance the movement check left out, kept so a reviewer who clears a GPS error can credit it back.
alter table public.activities add column if not exists integrity_excluded_m double precision not null default 0;
-- Set when a reviewer clears the flags (a GPS error); later re-evaluations never flag the run again.
alter table public.activities add column if not exists integrity_cleared_at timestamptz;

create or replace function internal.flag_activity(p_activity uuid, p_flags text[], p_signals jsonb default '{}')
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid;
  v_cleared timestamptz;
begin
  select user_id, integrity_cleared_at into v_user, v_cleared from public.activities where id = p_activity for update;
  if not found or v_cleared is not null then return; end if;
  update public.activities
     set integrity_flags = coalesce(p_flags, '{}'),
         integrity_excluded_m = case when coalesce(array_length(p_flags, 1), 0) > 0 then greatest(coalesce((p_signals ->> 'excluded_m')::double precision, 0), 0) else 0 end
   where id = p_activity;
  if coalesce(array_length(p_flags, 1), 0) > 0
     and not exists (select 1 from public.integrity_cases where kind = 'activity' and object_id = p_activity) then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by, hold_from_competition, signals)
    values ('activity', p_activity, v_user, 'system', false, coalesce(p_signals, '{}'::jsonb) || jsonb_build_object('reasons', to_jsonb(p_flags)));
  end if;
end $$;
revoke execute on function internal.flag_activity(uuid, text[], jsonb) from public, anon, authenticated;

/** A reviewer found the flagged movement was a GPS error: clear the flags and credit the left-out distance. */
create or replace function internal.clear_activity_flags(p_activity uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  a public.activities;
  v_points integer := 0;
begin
  select * into a from public.activities where id = p_activity for update;
  if not found or a.integrity_cleared_at is not null then return 0; end if;
  perform internal.lock_movement(a.user_id);
  update public.activities set integrity_flags = '{}', integrity_cleared_at = now() where id = p_activity;
  if a.deleted_at is null and a.integrity_excluded_m > 0
     and exists (select 1 from internal.movement_ledger where activity_id = p_activity and kind = 'run') then
    v_points := floor(a.integrity_excluded_m * internal.config_int('movement_points_per_km', 10) / 1000.0)::integer;
    if v_points > 0 then
      insert into internal.movement_ledger (user_id, kind, amount, activity_id, verified_distance_m, earned_on, note)
      values (a.user_id, 'reinstate', v_points, p_activity, a.integrity_excluded_m, (a.started_at at time zone 'UTC')::date, 'integrity_cleared');
      perform internal.add_to_balance(a.user_id, v_points, v_points, 0);
    end if;
  end if;
  perform internal.audit(p_actor, 'staff', 'activity_flags_cleared', 'activity', p_activity::text, jsonb_build_object('points', v_points));
  return v_points;
end $$;
revoke execute on function internal.clear_activity_flags(uuid, uuid) from public, anon, authenticated;

-- Runners can ask for a review of a run marked for unlike-running movement (for example a GPS error).
alter table public.appeals drop constraint if exists appeals_object_type_check;
alter table public.appeals add constraint appeals_object_type_check
  check (object_type in ('loop_claim', 'speed_attempt', 'post', 'comment', 'account_action', 'route_proposal', 'moderation_case', 'activity'));

create or replace function public.submit_appeal(p_object_type text, p_object_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_decided timestamptz;
  v_id uuid;
begin
  v_decided := case p_object_type
    when 'loop_claim' then (select coalesce(invalidated_at, validated_at) from public.loop_claims where id = p_object_id and user_id = v_user)
    when 'speed_attempt' then (select coalesce(validated_at, updated_at) from public.speed_attempts where id = p_object_id and user_id = v_user)
    when 'post' then (select updated_at from public.posts where id = p_object_id and author_id = v_user and status = 'removed')
    when 'comment' then (select coalesce(edited_at, created_at) from public.comments where id = p_object_id and author_id = v_user and status = 'removed')
    when 'route_proposal' then (select decided_at from public.route_proposals where id = p_object_id and creator_id = v_user)
    when 'moderation_case' then (select resolved_at from public.moderation_cases where id = p_object_id and subject_user_id = v_user)
    when 'activity' then (select updated_at from public.activities where id = p_object_id and user_id = v_user and deleted_at is null and cardinality(integrity_flags) > 0)
    else null end;
  if v_decided is null then raise exception 'nothing to appeal' using errcode = '42501'; end if;
  if v_decided < now() - interval '7 days' then raise exception 'the seven-day appeal window has closed'; end if;
  insert into public.appeals (user_id, object_type, object_id, reason) values (v_user, p_object_type, p_object_id, btrim(p_reason)) returning id into v_id;
  if p_object_type in ('loop_claim', 'speed_attempt', 'activity') then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by) values (p_object_type, p_object_id, v_user, 'appeal');
  end if;
  return v_id;
end $$;

create or replace function public.ops_resolve_integrity(p_case uuid, p_resolution text, p_notes text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('integrity_reviewer');
  ic public.integrity_cases;
begin
  select * into ic from public.integrity_cases where id = p_case for update;
  if not found or ic.status = 'resolved' then raise exception 'case not open'; end if;
  if p_resolution = 'invalidated' then
    if ic.kind = 'loop_claim' then perform internal.invalidate_claim(ic.object_id, 'invalid', 'staff_invalidated', v_actor);
    elsif ic.kind = 'speed_attempt' then perform internal.invalidate_attempt(ic.object_id, 'invalid', 'staff_invalidated', v_actor); end if;
  elsif p_resolution = 'overturned' then
    if ic.kind = 'loop_claim' then perform internal.restore_claim(ic.object_id, v_actor);
    elsif ic.kind = 'speed_attempt' then perform internal.restore_attempt(ic.object_id, v_actor);
    elsif ic.kind = 'activity' then perform internal.clear_activity_flags(ic.object_id, v_actor); end if;
  elsif p_resolution not in ('upheld', 'no_action') then raise exception 'invalid resolution';
  end if;
  update public.integrity_cases set status = 'resolved', resolution = p_resolution, notes = left(p_notes, 2000), resolved_at = now(), assigned_to = v_actor where id = p_case;
  update public.appeals set status = case when p_resolution = 'overturned' then 'overturned' else 'upheld' end, response = left(p_notes, 2000), decided_by = v_actor, decided_at = now()
   where object_id = ic.object_id and status in ('submitted', 'in_review');
  if ic.subject_user_id is not null then
    perform internal.notify(ic.subject_user_id, 'system', 'appeal_decided', null, 'integrity_case', p_case::text, jsonb_build_object('resolution', p_resolution), 'integrity:' || p_case);
  end if;
  perform internal.audit(v_actor, 'staff', 'integrity_' || p_resolution, ic.kind, ic.object_id::text, jsonb_build_object('case', p_case));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. The all-time map, season races and events
-- ---------------------------------------------------------------------------------------------
-- The map shows who holds each piece of ground now: land is kept until another runner's loop takes it,
-- whatever the season (a 'permanent' layer per region, with one season that never ends). Seasons stay
-- races with their own standings that start empty ('public'). Events are time-boxed contests with their
-- own standings ('event'); they never change the map or a season race. A run recorded for the public
-- race is evaluated once and counted in each layer it belongs to: its race claim is the primary claim,
-- and claims derived from it (parent_claim_id set, no activity of their own) carry the same loop into
-- the all-time map and into each territory event the runner has joined.

alter table public.competitions drop constraint if exists competitions_kind_check;
alter table public.competitions add constraint competitions_kind_check check (kind in ('public', 'club', 'permanent', 'event'));
alter table public.competitions alter column region_id drop not null;
alter table public.competitions
  add column if not exists event_type text check (event_type in ('territory', 'distance')),
  add column if not exists team_mode text not null default 'individual' check (team_mode in ('individual', 'club')),
  add column if not exists visibility text not null default 'public' check (visibility in ('public', 'members')),
  add column if not exists description text check (char_length(description) <= 1000),
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists target_m integer check (target_m is null or target_m between 1000 and 10000000),
  add column if not exists season_length_days integer not null default 28 check (season_length_days between 7 and 120),
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists host_club_id uuid references public.clubs (id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists cancelled_at timestamptz;
alter table public.competitions add constraint competitions_region_needed
  check (region_id is not null or (kind = 'event' and event_type = 'distance'));
alter table public.competitions add constraint competitions_event_shape
  check ((kind = 'event') = (event_type is not null and starts_at is not null and ends_at is not null));
alter table public.competitions add constraint competitions_event_window
  check (kind <> 'event' or (ends_at > starts_at and ends_at <= starts_at + interval '120 days'));
alter table public.competitions add constraint competitions_event_only_fields
  check (kind = 'event' or (team_mode = 'individual' and visibility = 'public' and host_club_id is null));
create unique index if not exists competitions_one_permanent_per_region on public.competitions (region_id) where kind = 'permanent';
create index if not exists competitions_events_idx on public.competitions (status, starts_at) where kind = 'event';
create index if not exists competitions_host_club_idx on public.competitions (host_club_id) where host_club_id is not null;

-- Claims derived from a run's race claim: one per layer, no activity of their own.
alter table public.loop_claims add column if not exists parent_claim_id uuid references public.loop_claims (id) on delete cascade;
create unique index if not exists loop_claims_one_per_layer on public.loop_claims (parent_claim_id, competition_id) where parent_claim_id is not null;
alter table public.loop_claims drop constraint if exists loop_claims_source_shape;
alter table public.loop_claims add constraint loop_claims_source_shape check (
  (source = 'loop' and (activity_id is not null) = (parent_claim_id is null) and points_spent is null)
  or (source = 'reclaim' and activity_id is null and parent_claim_id is null and points_spent is not null
      and reclaim_request_id is not null and undone_claim_id is not null and basis_claim_id is not null));

-- Points never buy land in an event: its standings are only what runners ran.
create or replace function internal.guard_reclaim_layer() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.source = 'reclaim' and exists (select 1 from public.competitions where id = new.competition_id and kind = 'event') then
    raise exception 'not_allowed' using errcode = '42501', detail = 'Points cannot reclaim land in an event.';
  end if;
  return new;
end $$;
drop trigger if exists loop_claims_guard_reclaim on public.loop_claims;
create trigger loop_claims_guard_reclaim before insert on public.loop_claims
  for each row when (new.source = 'reclaim') execute function internal.guard_reclaim_layer();

-- Who takes part in an event (and, for club events, which of their clubs they run for).
create table if not exists public.event_participants (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  reminded_at timestamptz,
  primary key (competition_id, user_id)
);
create index if not exists event_participants_user_idx on public.event_participants (user_id) where left_at is null;
alter table public.event_participants enable row level security;
grant select on public.event_participants to authenticated;
drop policy if exists event_participants_own_read on public.event_participants;
create policy event_participants_own_read on public.event_participants for select to authenticated using (user_id = (select auth.uid()));

-- Final standings kept when an event is archived (live standings are computed while it runs).
create table if not exists internal.event_results (
  competition_id uuid not null references public.competitions (id) on delete cascade,
  entrant_kind text not null check (entrant_kind in ('runner', 'club')),
  entrant_id uuid not null,
  rank integer not null,
  value double precision not null,
  members bigint,
  primary key (competition_id, entrant_kind, entrant_id)
);

-- Who may see a competition: public races, the all-time map and public events to every signed-in
-- runner; club races and club challenges to that club's members (and an event's own runners).
create or replace function public.can_access_competition(p_competition uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select exists (
    select 1 from public.competitions c
     where c.id = p_competition
       and (c.status <> 'archived' or c.kind = 'event')
       and (c.kind in ('public', 'permanent')
         or (c.kind = 'club' and authz.is_active_member(c.club_id, auth.uid()))
         or (c.kind = 'event' and (c.visibility = 'public'
                                   or authz.is_active_member(c.host_club_id, auth.uid())
                                   or exists (select 1 from public.event_participants ep where ep.competition_id = c.id and ep.user_id = auth.uid())))));
$$;

alter policy competitions_read on public.competitions using (
  kind in ('public', 'permanent')
  or (kind = 'club' and authz.is_active_member(club_id, (select auth.uid())))
  or (kind = 'event' and (visibility = 'public' or authz.is_active_member(host_club_id, (select auth.uid())))));
alter policy seasons_read on public.seasons using (exists (
  select 1 from public.competitions c
   where c.id = seasons.competition_id
     and (c.kind in ('public', 'permanent')
       or (c.kind = 'club' and authz.is_active_member(c.club_id, (select auth.uid())))
       or (c.kind = 'event' and (c.visibility = 'public' or authz.is_active_member(c.host_club_id, (select auth.uid())))))));

-- Region-wide distance events have no region, so the timezone falls back to UTC.
create or replace function public.current_season(p_competition uuid)
returns table (id uuid, number integer, starts_at timestamptz, ends_at timestamptz, status text, timezone text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.number, s.starts_at, s.ends_at, s.status, coalesce(r.timezone, 'UTC')
    from public.seasons s join public.competitions c on c.id = s.competition_id left join public.regions r on r.id = c.region_id
   where s.competition_id = p_competition and public.can_access_competition(p_competition)
     and s.starts_at <= now() and s.ends_at > now()
   limit 1;
$$;

/** The all-time map of each region with a public race: one permanent layer whose season never ends. */
create or replace function internal.ensure_permanent_layers() returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  r record;
  v_comp uuid;
  v_made integer := 0;
begin
  for r in
    select rg.id as region_id, rg.exclusion_review_status, rg.exclusion_set_version, pc.id as public_id
      from public.regions rg
      join public.competitions pc on pc.region_id = rg.id and pc.kind = 'public' and pc.status = 'active'
     where not exists (select 1 from public.competitions x where x.region_id = rg.id and x.kind = 'permanent')
  loop
    v_comp := null;
    insert into public.competitions (kind, region_id, name, status) values ('permanent', r.region_id, 'All-time map', 'active')
    on conflict (region_id) where kind = 'permanent' do nothing
    returning id into v_comp;
    if v_comp is null then continue; end if;
    -- Same grid and rules as the region's race.
    insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                                territory_rules_version, speed_rules_version, exclusion_set_version)
    select v_comp, 1, timestamptz '2020-01-01 00:00:00+00', timestamptz '9999-12-31 00:00:00+00', 'active',
           coalesce(s.grid_resolution, 11), coalesce(s.boundary_band_m, 10),
           coalesce(s.territory_rules_version, 'territory-2026.11.0-proposed'), coalesce(s.speed_rules_version, 'speed-2026.11.0-proposed'),
           case when r.exclusion_review_status = 'reviewed' then r.exclusion_set_version end
      from (select 1) as one
      left join lateral (select * from public.seasons s2 where s2.competition_id = r.public_id order by s2.number desc limit 1) s on true;
    v_made := v_made + 1;
  end loop;
  -- The map never ends, so it follows its region's reviewed exclusion set (a race freezes its own per season).
  update public.seasons s
     set exclusion_set_version = case when rg.exclusion_review_status = 'reviewed' then rg.exclusion_set_version end
    from public.competitions c join public.regions rg on rg.id = c.region_id
   where c.id = s.competition_id and c.kind = 'permanent'
     and s.exclusion_set_version is distinct from (case when rg.exclusion_review_status = 'reviewed' then rg.exclusion_set_version end);
  return v_made;
end $$;

/**
 * Carries a run recorded for a public race into the region's all-time map and into each territory
 * event its runner had joined when the run started. Club races stay inside their club.
 */
create or replace function internal.derive_layer_claims(p_claim uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  lc public.loop_claims;
  v_region uuid;
  v_started timestamptz;
  v_count integer;
begin
  select * into lc from public.loop_claims where id = p_claim;
  if not found or lc.parent_claim_id is not null or lc.source <> 'loop' or lc.status <> 'processing' then return 0; end if;
  select c.region_id into v_region from public.competitions c where c.id = lc.competition_id and c.kind = 'public';
  if v_region is null then return 0; end if;
  select started_at into v_started from public.activities where id = lc.activity_id;
  if v_started is null then return 0; end if;
  insert into public.loop_claims (user_id, competition_id, season_id, status, reasons, rule_version, received_at, parent_claim_id)
  select lc.user_id, c.id, s.id, 'processing', '{}', lc.rule_version, lc.received_at, lc.id
    from public.competitions c
    join lateral (select s2.id from public.seasons s2
                   where s2.competition_id = c.id and s2.status in ('active', 'settling')
                     and s2.starts_at <= v_started and s2.ends_at > v_started
                   order by s2.number desc limit 1) s on true
   where c.region_id = v_region and c.status = 'active'
     and (c.kind = 'permanent'
       or (c.kind = 'event' and c.event_type = 'territory' and c.cancelled_at is null
           and exists (select 1 from public.event_participants ep
                        where ep.competition_id = c.id and ep.user_id = lc.user_id and ep.left_at is null and ep.joined_at <= v_started)))
  on conflict (parent_claim_id, competition_id) where parent_claim_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Invalidate or withdraw one claim and recompute only its dependent cells (FR16). Repeating it is a
-- no-op, and a run's other layers (the all-time map, events) follow its race claim.
create or replace function internal.invalidate_claim(p_claim uuid, p_status text, p_reason text, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_claim public.loop_claims;
  v_cells bigint[];
  v_event uuid;
  v_child uuid;
begin
  if p_status not in ('invalid', 'withdrawn', 'unranked', 'pending_review') then raise exception 'bad status %', p_status; end if;
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found or v_claim.status = p_status then return null; end if;
  select array_agg(cell order by cell) into v_cells from internal.claim_cells where claim_id = p_claim;
  update public.loop_claims
     set status = p_status, reasons = array_append(reasons, p_reason), invalidated_at = now(), invalidation_reason = p_reason
   where id = p_claim;
  if v_claim.season_id is not null and v_cells is not null then
    v_event := internal.recompute_cells(v_claim.competition_id, v_claim.season_id, v_cells,
      case when p_status = 'withdrawn' then 'withdrawal' else 'invalidation' end, p_reason, p_actor, p_claim);
  end if;
  perform internal.audit(p_actor, case when p_actor is null then 'system' else 'staff' end, 'claim_' || p_status, 'loop_claim', p_claim::text, jsonb_build_object('reason', p_reason));
  for v_child in select id from public.loop_claims where parent_claim_id = p_claim and status in ('processing', 'eligible', 'pending_review') order by id loop
    perform internal.invalidate_claim(v_child, p_status, p_reason, p_actor);
  end loop;
  return v_event;
end $$;

/**
 * Restore a claim (appeal overturned, hold released) and recompute its cells. A claim held for review
 * before its land was worked out is evaluated again, without the movement signals the reviewer cleared.
 * The run's other layers that were held or invalidated with it follow.
 */
create or replace function internal.restore_claim(p_claim uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_claim public.loop_claims;
  v_cells bigint[];
  v_event uuid;
  v_child uuid;
  v_primary uuid;
begin
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found or v_claim.status in ('eligible', 'processing') then return null; end if;
  v_primary := coalesce(v_claim.parent_claim_id, v_claim.id);
  select array_agg(cell order by cell) into v_cells from internal.claim_cells where claim_id = p_claim;
  if v_cells is not null then
    update public.loop_claims set status = 'eligible', invalidated_at = null, invalidation_reason = null,
           reasons = array_append(reasons, 'appeal_overturned') where id = p_claim;
    v_event := internal.recompute_cells(v_claim.competition_id, v_claim.season_id, v_cells, 'correction', 'appeal_overturned', p_actor, p_claim);
  elsif v_claim.source = 'loop' and v_claim.validated_at is not null then
    update public.loop_claims set status = 'processing', invalidated_at = null, invalidation_reason = null,
           reasons = array_append(reasons, 'appeal_overturned') where id = p_claim;
    if v_claim.parent_claim_id is null and v_claim.status = 'invalid' then
      perform internal.reinstate_movement_points(v_claim.activity_id, 'appeal_overturned');
    end if;
    perform internal.enqueue_job('territory', 'evaluate_loop', jsonb_build_object('claim_id', v_primary, 'reviewed', true), 'loop:' || v_primary::text);
  else
    return null;
  end if;
  perform internal.audit(p_actor, 'staff', 'claim_restored', 'loop_claim', p_claim::text, '{}');
  if v_claim.parent_claim_id is null then
    for v_child in select id from public.loop_claims where parent_claim_id = p_claim and status = v_claim.status order by id loop
      perform internal.restore_claim(v_child, p_actor);
    end loop;
  end if;
  return v_event;
end $$;

-- Publication: land changes are announced once per run, from the all-time map (and club races, which
-- runs never leave). The season race and events update silently: they hold the same loops.
create or replace function internal.publish_event(p_event uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_event internal.territory_events;
  v_kind text;
begin
  select * into v_event from internal.territory_events where id = p_event and published_at is null and publish_after <= now() for update skip locked;
  if not found then return false; end if;
  select kind into v_kind from public.competitions where id = v_event.competition_id;
  with cells as (select cell from internal.territory_event_cells where event_id = v_event.id),
  desired as (
    select c.cell,
           x.status as excluded_status,
           w.user_id, w.claim_id
      from cells c
      left join internal.cell_control x on x.competition_id = v_event.competition_id and x.season_id = v_event.season_id and x.cell = c.cell and x.status = 'excluded'
      left join lateral (
        select lc.user_id, lc.id as claim_id from internal.claim_cells cc join public.loop_claims lc on lc.id = cc.claim_id
         where cc.cell = c.cell and lc.competition_id = v_event.competition_id and lc.season_id = v_event.season_id
           and lc.status = 'eligible' and lc.publish_after <= now()
         order by lc.completed_at desc, lc.id desc limit 1
      ) w on true
  ), removed as (
    delete from internal.cell_control_public p using desired d
     where p.competition_id = v_event.competition_id and p.season_id = v_event.season_id and p.cell = d.cell
       and d.excluded_status is null and d.claim_id is null
    returning p.cell
  )
  insert into internal.cell_control_public (competition_id, season_id, cell, controller_id, claim_id, status, published_at)
  select v_event.competition_id, v_event.season_id, d.cell,
         case when d.excluded_status is not null then null else d.user_id end,
         case when d.excluded_status is not null then null else d.claim_id end,
         coalesce(d.excluded_status, 'controlled'), now()
    from desired d where d.excluded_status is not null or d.claim_id is not null
  on conflict (competition_id, season_id, cell) do update
    set controller_id = excluded.controller_id, claim_id = excluded.claim_id, status = excluded.status, published_at = now();

  if v_kind in ('permanent', 'club') then
    -- Digest items for runners whose land changed (aggregated into one daily notification).
    insert into internal.digest_items (user_id, kind, payload)
    select prior_controller, case when v_event.kind = 'capture' then 'territory_lost' else 'territory_corrected' end,
           jsonb_build_object('competition_id', v_event.competition_id, 'season_id', v_event.season_id, 'cells', count(*))
      from internal.territory_event_cells where event_id = v_event.id and prior_controller is not null and prior_controller is distinct from new_controller
     group by prior_controller;
    insert into internal.digest_items (user_id, kind, payload)
    select new_controller, case when v_event.kind = 'capture' then 'territory_gained' else 'territory_corrected' end,
           jsonb_build_object('competition_id', v_event.competition_id, 'season_id', v_event.season_id, 'cells', count(*))
      from internal.territory_event_cells where event_id = v_event.id and new_controller is not null and prior_controller is distinct from new_controller
     group by new_controller;
  end if;

  update internal.territory_events set published_at = now() where id = v_event.id;
  update public.loop_claims set published_at = coalesce(published_at, now()) where id = v_event.claim_id;
  return true;
end $$;

-- My land changes: the all-time map and club races (one line per run, not one per layer).
create or replace function public.my_territory_events(p_limit integer default 30)
returns table (event_id uuid, kind text, competition_id uuid, season_id uuid, direction text, cells integer, area_m2 double precision,
               provisional boolean, reason text, occurred_on date, source text)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with mine as (
    -- One row per event, except reclaims: one row per reclaim request.
    select min(e.id::text)::uuid as id, e.kind, e.competition_id, e.season_id, min(e.reason) as reason,
           max(e.published_at) as published_at, min(e.created_at) as created_at,
           case when ec.new_controller = auth.uid() then 'gained' else 'lost' end as direction,
           count(*)::integer as cells, sum(tc.area_m2) as area, coalesce(lc.source, 'loop') as source,
           bool_or(e.published_at is null) as unpublished
      from internal.territory_events e
      join public.competitions comp on comp.id = e.competition_id and comp.kind in ('permanent', 'club')
      join internal.territory_event_cells ec on ec.event_id = e.id
      join internal.territory_cells tc on tc.cell = ec.cell
      left join public.loop_claims lc on lc.id = e.claim_id
     where (ec.new_controller = auth.uid() or ec.prior_controller = auth.uid())
       and ec.prior_controller is distinct from ec.new_controller
       and (e.published_at is not null or ec.new_controller = auth.uid())
     group by coalesce(lc.reclaim_request_id::text, e.id::text), e.kind, e.competition_id, e.season_id, direction, coalesce(lc.source, 'loop')
  )
  select id, kind, competition_id, season_id, direction, cells, round(area::numeric, 1)::double precision,
         unpublished, reason, (coalesce(published_at, created_at) at time zone 'UTC')::date, source
    from mine order by coalesce(published_at, created_at) desc limit least(p_limit, 100);
$$;

-- Achievements count each run once (its race claim) and season finishes only in races.
create or replace function internal.achievement_metrics(p_user uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with runs as (
    select activity_id, min(earned_on) as day, sum(verified_distance_m) as dist
      from internal.movement_ledger where user_id = p_user and kind in ('run', 'revoke', 'reinstate')
     group by activity_id
  ), weeks as (
    select distinct date_trunc('week', day)::date as wk from runs where dist >= 200
  ), islands as (
    select wk, wk - (row_number() over (order by wk) * 7)::integer as grp from weeks
  ), my_captures as (
    select ec.cell, ec.prior_controller
      from internal.territory_event_cells ec
      join internal.territory_events e on e.id = ec.event_id and e.kind = 'capture'
      join public.loop_claims lc on lc.id = e.claim_id and lc.source = 'loop' and lc.parent_claim_id is null
                                and lc.status = 'eligible' and lc.user_id = p_user
     where ec.new_controller = p_user
  ), settled as (
    select p.season_id, p.controller_id, rank() over (partition by p.season_id order by round(sum(tc.area_m2)::numeric, 1) desc) as r
      from internal.cell_control_public p
      join internal.territory_cells tc on tc.cell = p.cell
      join public.seasons s on s.id = p.season_id and s.status = 'settled'
      join public.competitions c on c.id = s.competition_id and c.kind in ('public', 'club')
     where p.controller_id is not null
     group by p.season_id, p.controller_id
  )
  select jsonb_build_object(
    'distance_km', round((coalesce((select sum(dist) from runs), 0) / 1000.0)::numeric, 2),
    'best_week_streak', coalesce((select max(n) from (select count(*) as n from islands group by grp) s), 0),
    'cells_captured', (select count(*) from my_captures where prior_controller is distinct from p_user),
    'cells_defended', (select count(*) from my_captures where prior_controller = p_user),
    'rivals_beaten', (select count(distinct prior_controller) from my_captures where prior_controller is not null and prior_controller <> p_user),
    'explored_cells', (select count(*) from public.exploration_cells where user_id = p_user),
    'clubs_joined', (select count(*) from public.club_memberships m join public.clubs c on c.id = m.club_id
                      where m.user_id = p_user and m.state = 'active' and c.status = 'active'),
    'club_loops', (select count(*) from public.loop_claims lc join public.competitions c on c.id = lc.competition_id and c.kind = 'club'
                    where lc.user_id = p_user and lc.source = 'loop' and lc.status = 'eligible'),
    'organized_members', coalesce((select max(n) from (
        select count(*) filter (where m2.state = 'active') as n
          from public.club_memberships m join public.clubs c on c.id = m.club_id and c.status = 'active'
          join public.club_memberships m2 on m2.club_id = m.club_id
         where m.user_id = p_user and m.state = 'active' and m.role in ('owner', 'organizer')
         group by m.club_id) s), 0),
    'speed_attempts', (select count(*) from public.speed_attempts where user_id = p_user and status = 'eligible'),
    'titles_won', (select count(distinct (course_version_id, competition_id, season_id)) from internal.speed_title_changes
                    where new_champion = p_user and kind in ('initial', 'takeover') and published_at is not null),
    'top10_finishes', (select count(*) from settled where controller_id = p_user and r <= 10));
$$;

-- Activity detail: the run's race claim, plus what the same loop did in each layer.
create or replace function public.activity_detail(p_activity uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select jsonb_build_object(
    'activity', to_jsonb(a) - 'events' - 'evidence_digest' - 'device',
    'claim', (select to_jsonb(lc) - 'polygon' || jsonb_build_object('polygon', extensions.st_asgeojson(lc.polygon, 6)::jsonb)
                from public.loop_claims lc where lc.activity_id = a.id),
    'layers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'claim_id', lc.id, 'competition_id', c.id, 'season_id', lc.season_id, 'kind', c.kind, 'name', c.name,
               'status', lc.status, 'reasons', to_jsonb(lc.reasons), 'cells', coalesce(lc.eligible_cell_count, 0),
               'area_m2', coalesce(lc.eligible_area_m2, 0), 'published', lc.published_at is not null,
               'gained_cells', coalesce((e.summary ->> 'gained_cells')::integer, 0),
               'kept_cells', coalesce((e.summary ->> 'refreshed_cells')::integer, 0),
               'taken_cells', coalesce((select sum((t.value ->> 'cells')::integer) from jsonb_each(e.summary -> 'taken_from') t), 0),
               'rivals', coalesce((select count(*) from jsonb_object_keys(coalesce(e.summary -> 'taken_from', '{}'::jsonb))), 0))
             order by case c.kind when 'permanent' then 0 when 'public' then 1 when 'club' then 2 else 3 end, c.name)
        from public.loop_claims lc
        join public.competitions c on c.id = lc.competition_id
        left join internal.territory_events e on e.claim_id = lc.id and e.kind = 'capture'
       where lc.activity_id = a.id
          or lc.parent_claim_id = (select p.id from public.loop_claims p where p.activity_id = a.id)), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(sa) || jsonb_build_object('course_name', c.name,
                   'is_benchmark', exists (select 1 from internal.speed_titles t where t.benchmark_attempt_id = sa.id),
                   'is_published_champion', exists (select 1 from internal.speed_titles t where t.published_benchmark_attempt_id = sa.id)))
                from public.speed_attempts sa join public.course_versions cv on cv.id = sa.course_version_id join public.courses c on c.id = cv.course_id
               where sa.activity_id = a.id), '[]'::jsonb),
    'title_context', coalesce((select jsonb_agg(jsonb_build_object('attempt_id', sa.id, 'benchmark_ms', t.benchmark_ms, 'champion_is_me', t.champion_id = auth.uid()))
                from public.speed_attempts sa join internal.speed_titles t on t.course_version_id = sa.course_version_id and t.competition_id = sa.competition_id and t.season_id = sa.season_id
               where sa.activity_id = a.id), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', rp.id, 'status', rp.status, 'name', rp.name)) from public.route_proposals rp where rp.source_activity_id = a.id), '[]'::jsonb)
  )
  from public.activities a where a.id = p_activity and a.user_id = auth.uid() and a.deleted_at is null;
$$;

-- ---- Seasons and events over time --------------------------------------------------------------
/** Standings of an event while it runs: land held in the event, or verified distance since joining. */
create or replace function internal.event_standings_live(p_event uuid)
returns table (entrant_kind text, entrant_id uuid, value double precision, members bigint)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with ev as (
    select c.id, c.event_type, c.team_mode, c.starts_at, c.ends_at,
           (select s.id from public.seasons s where s.competition_id = c.id order by s.number limit 1) as season_id
      from public.competitions c where c.id = p_event and c.kind = 'event'
  ), parts as (
    select ep.user_id, ep.club_id, ep.joined_at from public.event_participants ep join ev on ev.id = ep.competition_id where ep.left_at is null
  ), land as (
    select cp.controller_id as user_id, sum(tc.area_m2) as value
      from ev
      join internal.cell_control_public cp on cp.competition_id = ev.id and cp.season_id = ev.season_id
      join internal.territory_cells tc on tc.cell = cp.cell
     where ev.event_type = 'territory' and cp.status = 'controlled' and cp.controller_id is not null
     group by cp.controller_id
  ), dist as (
    select p.user_id, sum(n.distance_m) as value
      from ev
      join parts p on true
      join public.activities a on a.user_id = p.user_id and a.deleted_at is null and a.status = 'processed'
                              and a.started_at >= greatest(ev.starts_at, p.joined_at) and a.started_at < ev.ends_at
      cross join lateral internal.run_movement_net(a.id) n
     where ev.event_type = 'distance'
     group by p.user_id
  ), runners as (
    select p.user_id, p.club_id, coalesce(l.value, d.value, 0)::double precision as value
      from parts p left join land l on l.user_id = p.user_id left join dist d on d.user_id = p.user_id
  )
  select 'runner'::text, r.user_id, r.value, null::bigint from runners r
  union all
  select 'club'::text, r.club_id, sum(r.value)::double precision, count(*)
    from runners r cross join ev
   where ev.team_mode = 'club' and r.club_id is not null
   group by r.club_id;
$$;

/** Event reminders a day ahead; final standings and archiving once an event's season is settled. */
create or replace function internal.finish_events() returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  e record;
  p record;
  v_done integer := 0;
begin
  for p in
    update public.event_participants ep set reminded_at = now()
      from public.competitions c
     where c.id = ep.competition_id and c.kind = 'event' and c.status = 'active' and c.cancelled_at is null
       and ep.left_at is null and ep.reminded_at is null
       and c.starts_at > now() and c.starts_at <= now() + interval '24 hours'
    returning ep.user_id, c.id as event_id, c.name, c.starts_at
  loop
    perform internal.notify(p.user_id, 'competitive', 'event_starting', null, 'competition', p.event_id::text,
                            jsonb_build_object('name', p.name, 'starts_at', p.starts_at), 'event_start:' || p.event_id::text);
  end loop;
  for e in
    select c.id, c.name, c.team_mode from public.competitions c
     where c.kind = 'event' and c.status = 'active'
       and exists (select 1 from public.seasons s where s.competition_id = c.id and s.status = 'settled')
     for update of c skip locked
  loop
    insert into internal.event_results (competition_id, entrant_kind, entrant_id, rank, value, members)
    select e.id, l.entrant_kind, l.entrant_id,
           rank() over (partition by l.entrant_kind order by round(l.value::numeric, 1) desc), l.value, l.members
      from internal.event_standings_live(e.id) l where l.value > 0 and l.entrant_id is not null
    on conflict do nothing;
    update public.competitions set status = 'archived', archived_at = now() where id = e.id;
    for p in
      select ep.user_id, r.rank, cr.rank as club_rank
        from public.event_participants ep
        left join internal.event_results r on r.competition_id = e.id and r.entrant_kind = 'runner' and r.entrant_id = ep.user_id
        left join internal.event_results cr on cr.competition_id = e.id and cr.entrant_kind = 'club' and cr.entrant_id = ep.club_id
       where ep.competition_id = e.id and ep.left_at is null
    loop
      perform internal.notify(p.user_id, 'competitive', 'event_finished', null, 'competition', e.id::text,
                              jsonb_strip_nulls(jsonb_build_object('name', e.name, 'rank', p.rank, 'club_rank', p.club_rank)),
                              'event_end:' || e.id::text);
    end loop;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

-- Seasons: races (public and club) roll on by themselves at their competition's season length unless
-- an operator has scheduled the next one; the all-time map never rolls; events settle and archive.
create or replace function internal.maintain_seasons()
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_comp record;
  v_last public.seasons;
  v_region public.regions;
begin
  perform internal.ensure_permanent_layers();
  update public.seasons set status = 'active' where status = 'scheduled' and starts_at <= now() and ends_at > now();
  update public.seasons set status = 'settling' where status = 'active' and ends_at <= now();
  update public.seasons set status = 'settled', settled_at = now()
   where status = 'settling' and ends_at + interval '24 hours' <= now()
     and not exists (select 1 from public.integrity_cases ic where ic.status <> 'resolved' and ic.hold_from_competition
                       and ic.object_id in (select coalesce(lc.parent_claim_id, lc.id) from public.loop_claims lc where lc.season_id = seasons.id
                                            union select sa.id from public.speed_attempts sa where sa.season_id = seasons.id));
  for v_comp in select * from public.competitions where status = 'active' and kind in ('public', 'club') loop
    select * into v_last from public.seasons where competition_id = v_comp.id order by number desc limit 1;
    select * into v_region from public.regions where id = v_comp.region_id;
    if v_last.id is null or v_last.ends_at <= now() + interval '3 days' then
      insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                                  territory_rules_version, speed_rules_version, exclusion_set_version)
      values (v_comp.id, coalesce(v_last.number, 0) + 1,
              coalesce(v_last.ends_at, date_trunc('day', now())),
              coalesce(v_last.ends_at, date_trunc('day', now())) + make_interval(days => v_comp.season_length_days),
              case when coalesce(v_last.ends_at, now()) <= now() then 'active' else 'scheduled' end,
              coalesce(v_last.grid_resolution, 11), coalesce(v_last.boundary_band_m, 10),
              coalesce(v_last.territory_rules_version, 'territory-2026.11.0-proposed'),
              coalesce(v_last.speed_rules_version, 'speed-2026.11.0-proposed'),
              case when v_region.exclusion_review_status = 'reviewed' then v_region.exclusion_set_version else null end)
      on conflict do nothing;
    end if;
  end loop;
  perform internal.finish_events();
end $$;

/** Creates an event and its one season (the event window), with the region's grid and rules frozen for it. */
create or replace function internal.create_event(p_actor uuid, p_host_club uuid, p_name text, p_description text, p_event_type text,
  p_team_mode text, p_region uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_target_m integer)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_id uuid;
  v_region public.regions;
  v_race public.seasons;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 60 then raise exception 'name_length' using errcode = '22023', detail = 'Use 3 to 60 characters for the name.'; end if;
  if char_length(coalesce(p_description, '')) > 1000 then raise exception 'description_length' using errcode = '22023'; end if;
  if p_event_type is null or p_event_type not in ('territory', 'distance') then raise exception 'event_type' using errcode = '22023'; end if;
  if p_team_mode is null or p_team_mode not in ('individual', 'club') then raise exception 'team_mode' using errcode = '22023'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then raise exception 'event_window' using errcode = '22023', detail = 'The event must end after it starts.'; end if;
  if p_ends_at > p_starts_at + interval '120 days' then raise exception 'event_window' using errcode = '22023', detail = 'Events run for at most 120 days.'; end if;
  if p_ends_at <= now() + interval '1 hour' then raise exception 'event_window' using errcode = '22023', detail = 'The event must end in the future.'; end if;
  if p_target_m is not null and (p_event_type <> 'distance' or p_target_m not between 1000 and 10000000) then raise exception 'target' using errcode = '22023'; end if;
  if p_region is not null then
    select * into v_region from public.regions where id = p_region;
    if not found or v_region.status <> 'active' then raise exception 'region_unavailable' using errcode = '22023'; end if;
  elsif p_event_type = 'territory' then
    raise exception 'region_needed' using errcode = '22023', detail = 'Territory events take place in one region.';
  end if;
  insert into public.competitions (kind, region_id, name, description, status, event_type, team_mode, visibility, starts_at, ends_at, target_m, created_by, host_club_id)
  values ('event', p_region, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), 'active', p_event_type, p_team_mode,
          case when p_host_club is null then 'public' else 'members' end, p_starts_at, p_ends_at, p_target_m, p_actor, p_host_club)
  returning id into v_id;
  select s.* into v_race from public.seasons s join public.competitions c on c.id = s.competition_id
   where c.region_id = p_region and c.kind = 'public' order by s.number desc limit 1;
  insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                              territory_rules_version, speed_rules_version, exclusion_set_version)
  values (v_id, 1, p_starts_at, p_ends_at, case when p_starts_at <= now() then 'active' else 'scheduled' end,
          coalesce(v_race.grid_resolution, 11), coalesce(v_race.boundary_band_m, 10),
          coalesce(v_race.territory_rules_version, 'territory-2026.11.0-proposed'), coalesce(v_race.speed_rules_version, 'speed-2026.11.0-proposed'),
          case when v_region.exclusion_review_status = 'reviewed' then v_region.exclusion_set_version end);
  perform internal.audit(p_actor, case when p_host_club is null then 'staff' else 'organizer' end, 'event_created', 'competition', v_id::text,
                         jsonb_build_object('type', p_event_type, 'team_mode', p_team_mode, 'club', p_host_club));
  return v_id;
end $$;

-- Operators create region or worldwide events (including club-against-club ones).
create or replace function public.ops_create_event(p_name text, p_description text, p_event_type text, p_team_mode text,
  p_region uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_target_m integer default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
begin
  return internal.create_event(v_actor, null, p_name, p_description, p_event_type, p_team_mode, p_region, p_starts_at, p_ends_at, p_target_m);
end $$;

-- Club and community organisers create challenges for their members; members hear about them.
create or replace function public.create_club_event(p_club uuid, p_name text, p_description text, p_event_type text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_target_m integer default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_club public.clubs;
  v_id uuid;
  m record;
begin
  perform internal.enforce_rate_limit(v_user::text, 'create_event', 10, 86400);
  select * into v_club from public.clubs where id = p_club and status = 'active';
  if not found or not authz.is_organizer(p_club, v_user) then raise exception 'only organizers can create challenges' using errcode = '42501'; end if;
  if p_event_type = 'territory' and v_club.region_id is null then
    raise exception 'region_needed' using errcode = '22023', detail = 'Set the club''s area to run a territory challenge.';
  end if;
  v_id := internal.create_event(v_user, p_club, p_name, p_description, p_event_type, 'individual',
                                case when p_event_type = 'territory' then v_club.region_id end, p_starts_at, p_ends_at, p_target_m);
  for m in select user_id from public.club_memberships where club_id = p_club and state = 'active' and user_id <> v_user loop
    perform internal.notify(m.user_id, 'club', 'club_challenge', v_user, 'competition', v_id::text,
                            jsonb_build_object('name', btrim(p_name), 'club_id', p_club, 'club_name', v_club.name, 'starts_at', p_starts_at),
                            'club_challenge:' || v_id::text);
  end loop;
  return v_id;
end $$;

/** Operators, or the hosting club's organisers, cancel an event before it ends; its runners are told. */
create or replace function public.cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_ev public.competitions;
  p record;
begin
  select * into v_ev from public.competitions where id = p_event and kind = 'event' for update;
  if not found then raise exception 'event not found'; end if;
  if not (authz.has_role(v_user, 'territory_operator') or (v_ev.host_club_id is not null and authz.is_organizer(v_ev.host_club_id, v_user))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_ev.status <> 'active' or v_ev.ends_at <= now() then raise exception 'this event has already finished'; end if;
  update public.competitions set status = 'archived', archived_at = now(), cancelled_at = now() where id = p_event;
  update public.seasons set status = 'settled', settled_at = now(), ends_at = greatest(starts_at + interval '1 second', least(ends_at, now()))
   where competition_id = p_event and status in ('scheduled', 'active');
  for p in select user_id from public.event_participants where competition_id = p_event and left_at is null loop
    perform internal.notify(p.user_id, 'competitive', 'event_cancelled', v_user, 'competition', p_event::text,
                            jsonb_build_object('name', v_ev.name), 'event_cancel:' || p_event::text);
  end loop;
  perform internal.audit(v_user, case when authz.has_role(v_user, 'territory_operator') then 'staff' else 'organizer' end, 'event_cancelled', 'competition', p_event::text, '{}');
end $$;

/** Events a runner can see: running and upcoming ('current'), finished ones, or one club's challenges. */
create or replace function public.list_events(p_scope text default 'current', p_event uuid default null, p_club uuid default null)
returns table (id uuid, name text, description text, event_type text, team_mode text, visibility text, region_id uuid, region_name text,
               host_club_id uuid, host_club_name text, host_avatar_path text, starts_at timestamptz, ends_at timestamptz,
               target_m integer, season_id uuid, phase text, participants bigint, joined boolean, my_club_id uuid, can_manage boolean)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select c.id, c.name, c.description, c.event_type, c.team_mode, c.visibility, c.region_id, r.name, c.host_club_id, k.name, k.avatar_path,
         c.starts_at, c.ends_at, c.target_m, s.id,
         case when c.cancelled_at is not null then 'cancelled'
              when c.status = 'archived' then 'finished'
              when now() < c.starts_at then 'upcoming'
              when now() < c.ends_at then 'live'
              else 'finishing' end,
         (select count(*) from public.event_participants ep where ep.competition_id = c.id and ep.left_at is null),
         exists (select 1 from public.event_participants ep where ep.competition_id = c.id and ep.user_id = auth.uid() and ep.left_at is null),
         (select ep.club_id from public.event_participants ep where ep.competition_id = c.id and ep.user_id = auth.uid() and ep.left_at is null),
         authz.has_role(auth.uid(), 'territory_operator') or (c.host_club_id is not null and authz.is_organizer(c.host_club_id, auth.uid()))
    from public.competitions c
    left join public.regions r on r.id = c.region_id
    left join public.clubs k on k.id = c.host_club_id
    left join lateral (select s2.id from public.seasons s2 where s2.competition_id = c.id order by s2.number limit 1) s on true
   where auth.uid() is not null and c.kind = 'event' and public.can_access_competition(c.id)
     and (p_event is null or c.id = p_event)
     and (p_club is null or c.host_club_id = p_club)
     and (p_event is not null or p_club is not null
          or (coalesce(p_scope, 'current') = 'current' and c.status = 'active')
          or (p_scope = 'finished' and c.status = 'archived'))
   order by case when c.status = 'archived' then 1 else 0 end,
            case when c.status = 'archived' then null else (now() < c.starts_at) end,
            case when c.status = 'archived' then null else c.starts_at end,
            c.ends_at desc
   limit 50;
$$;

/** Join an event (free, like every competition). Runs started after joining count; club events need a club you belong to. */
create or replace function public.join_event(p_event uuid, p_club uuid default null) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_ev public.competitions;
  v_prior public.event_participants;
begin
  perform internal.enforce_rate_limit(v_user::text, 'join_event', 30, 3600);
  select * into v_ev from public.competitions where id = p_event and kind = 'event';
  if not found or not public.can_access_competition(p_event) then raise exception 'event not found' using errcode = '42501'; end if;
  if v_ev.status <> 'active' or v_ev.ends_at <= now() then raise exception 'event_finished' using errcode = 'P0409', detail = 'This event has finished.'; end if;
  if coalesce((select full_private_mode from public.user_settings where user_id = v_user), false) then
    raise exception 'full_private_mode' using errcode = '42501', detail = 'Turn off full private mode to take part in events.';
  end if;
  if v_ev.event_type = 'territory' and not coalesce((select territory_competition_enabled from public.user_settings where user_id = v_user), false) then
    raise exception 'event_needs_territory' using errcode = '42501', detail = 'Turn on territory in Privacy settings to join.';
  end if;
  if v_ev.host_club_id is not null and not authz.is_active_member(v_ev.host_club_id, v_user) then
    raise exception 'members_only' using errcode = '42501', detail = 'This challenge is for club members.';
  end if;
  if v_ev.team_mode = 'club' then
    if p_club is null or not authz.is_active_member(p_club, v_user) then raise exception 'club_needed' using errcode = '42501', detail = 'Choose a club you belong to.'; end if;
  elsif p_club is not null then raise exception 'individual_event' using errcode = '22023';
  end if;
  select * into v_prior from public.event_participants where competition_id = p_event and user_id = v_user for update;
  if found and v_prior.left_at is null then
    if v_prior.club_id is distinct from p_club and now() >= v_ev.starts_at then
      raise exception 'club_locked' using errcode = 'P0409', detail = 'You run for the same club until the event ends.';
    end if;
    update public.event_participants set club_id = p_club where competition_id = p_event and user_id = v_user;
  elsif found then
    update public.event_participants set left_at = null, joined_at = now(), club_id = p_club, reminded_at = null
     where competition_id = p_event and user_id = v_user;
  else
    insert into public.event_participants (competition_id, user_id, club_id) values (p_event, v_user, p_club);
  end if;
end $$;

/** Leave an event: your land in it is withdrawn (the all-time map and the season race are not touched). */
create or replace function public.leave_event(p_event uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  r record;
begin
  update public.event_participants set left_at = now() where competition_id = p_event and user_id = v_user and left_at is null;
  if not found then return; end if;
  if exists (select 1 from public.competitions where id = p_event and status = 'active') then
    for r in select id from public.loop_claims where competition_id = p_event and user_id = v_user and status in ('processing', 'eligible', 'pending_review') loop
      perform internal.invalidate_claim(r.id, 'withdrawn', 'left_event', null);
    end loop;
  end if;
end $$;

/** Ranked event standings (live while it runs, final once archived). Blocked runners appear as "A runner". */
create or replace function public.event_standings(p_event uuid, p_limit integer default 50)
returns table (rank bigint, entrant_kind text, entrant_id uuid, handle text, display_name text, avatar_path text,
               value double precision, members bigint, is_me boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_viewer uuid := auth.uid();
  v_ev public.competitions;
  v_kind text;
  v_my_club uuid;
begin
  if v_viewer is null or not public.can_access_competition(p_event) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_ev from public.competitions where id = p_event and kind = 'event';
  if not found then raise exception 'event not found'; end if;
  v_kind := case when v_ev.team_mode = 'club' then 'club' else 'runner' end;
  select ep.club_id into v_my_club from public.event_participants ep where ep.competition_id = p_event and ep.user_id = v_viewer and ep.left_at is null;
  return query
  with src as (
    select er.entrant_id as eid, er.value as val, er.members as n from internal.event_results er
     where v_ev.status = 'archived' and er.competition_id = p_event and er.entrant_kind = v_kind
    union all
    select l.entrant_id, l.value, l.members from internal.event_standings_live(p_event) l
     where v_ev.status <> 'archived' and l.entrant_kind = v_kind and l.value > 0 and l.entrant_id is not null
  ), ranked as (
    select rank() over (order by round(s.val::numeric, 1) desc) as r, s.eid, s.val, s.n,
           case when v_kind = 'club' then s.eid = v_my_club else s.eid = v_viewer end as mine
      from src s
  )
  select rk.r, v_kind,
         case when v_kind = 'runner' and authz.is_blocked(rk.eid, v_viewer) then null else rk.eid end,
         case when v_kind = 'runner' and not authz.is_blocked(rk.eid, v_viewer) then pr.handle::text end,
         case when v_kind = 'club' then k.name when authz.is_blocked(rk.eid, v_viewer) then 'A runner' else pr.display_name end,
         case when v_kind = 'club' then k.avatar_path when authz.is_blocked(rk.eid, v_viewer) then null else pr.avatar_path end,
         round(rk.val::numeric, 1)::double precision, rk.n, coalesce(rk.mine, false)
    from ranked rk
    left join public.profiles pr on v_kind = 'runner' and pr.id = rk.eid
    left join public.clubs k on v_kind = 'club' and k.id = rk.eid
   where rk.r <= least(greatest(p_limit, 1), 200) or coalesce(rk.mine, false)
   order by 1, 5;
end $$;

/** Operators set a race season's dates; a following season already scheduled moves with it (no gaps or overlaps). */
create or replace function public.ops_set_season_dates(p_season uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
  s public.seasons;
  v_next public.seasons;
  v_kind text;
  v_moves boolean;
begin
  select * into s from public.seasons where id = p_season for update;
  if not found then raise exception 'season not found'; end if;
  select kind into v_kind from public.competitions where id = s.competition_id;
  if v_kind not in ('public', 'club') then raise exception 'only race seasons have editable dates' using errcode = '22023'; end if;
  if s.status not in ('scheduled', 'active') then raise exception 'this season has ended' using errcode = 'P0409'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '120 days' then
    raise exception 'season_window' using errcode = '22023', detail = 'A season runs for up to 120 days.';
  end if;
  if p_ends_at <= now() + interval '1 hour' then raise exception 'season_window' using errcode = '22023', detail = 'The season must end in the future.'; end if;
  if s.status = 'active' and p_starts_at <> s.starts_at then raise exception 'season_window' using errcode = '22023', detail = 'A running season keeps its start date.'; end if;
  if s.status = 'scheduled' and p_starts_at < now() then raise exception 'season_window' using errcode = '22023', detail = 'A scheduled season starts in the future.'; end if;
  if exists (select 1 from public.seasons p where p.competition_id = s.competition_id and p.number < s.number and p.ends_at > p_starts_at) then
    raise exception 'season_window' using errcode = '22023', detail = 'It would start before the previous season ends.';
  end if;
  select * into v_next from public.seasons where competition_id = s.competition_id and number = s.number + 1 for update;
  v_moves := found and v_next.status = 'scheduled' and v_next.starts_at = s.ends_at;
  if found and not v_moves and v_next.starts_at < p_ends_at then
    raise exception 'season_window' using errcode = '22023', detail = 'It would overlap the next season; change that one first.';
  end if;
  -- Order the two updates so the no-overlap rule holds after each one.
  if v_moves and p_ends_at > s.ends_at then
    update public.seasons set starts_at = p_ends_at, ends_at = p_ends_at + (v_next.ends_at - v_next.starts_at) where id = v_next.id;
  end if;
  update public.seasons set starts_at = p_starts_at, ends_at = p_ends_at where id = s.id;
  if v_moves and p_ends_at <= s.ends_at then
    update public.seasons set starts_at = p_ends_at, ends_at = p_ends_at + (v_next.ends_at - v_next.starts_at) where id = v_next.id;
  end if;
  perform internal.audit(v_actor, 'staff', 'season_dates_set', 'season', p_season::text,
                         jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'moved_next', v_moves));
end $$;

/** Operators schedule the next race season ahead (its dates are then kept instead of the automatic length). */
create or replace function public.ops_schedule_season(p_competition uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
  v_comp public.competitions;
  v_last public.seasons;
  v_region public.regions;
  v_id uuid;
begin
  select * into v_comp from public.competitions where id = p_competition for update;
  if not found or v_comp.kind not in ('public', 'club') or v_comp.status <> 'active' then raise exception 'only active races have seasons' using errcode = '22023'; end if;
  select * into v_last from public.seasons where competition_id = p_competition order by number desc limit 1;
  if v_last.status = 'scheduled' then raise exception 'season_window' using errcode = 'P0409', detail = 'A season is already scheduled; change its dates instead.'; end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at < coalesce(v_last.ends_at, now()) or p_starts_at < now()
     or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '120 days' then
    raise exception 'season_window' using errcode = '22023', detail = 'Start after the current season ends and run for up to 120 days.';
  end if;
  select * into v_region from public.regions where id = v_comp.region_id;
  insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                              territory_rules_version, speed_rules_version, exclusion_set_version)
  values (p_competition, coalesce(v_last.number, 0) + 1, p_starts_at, p_ends_at, 'scheduled',
          coalesce(v_last.grid_resolution, 11), coalesce(v_last.boundary_band_m, 10),
          coalesce(v_last.territory_rules_version, 'territory-2026.11.0-proposed'), coalesce(v_last.speed_rules_version, 'speed-2026.11.0-proposed'),
          case when v_region.exclusion_review_status = 'reviewed' then v_region.exclusion_set_version end)
  returning id into v_id;
  perform internal.audit(v_actor, 'staff', 'season_scheduled', 'season', v_id::text, jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at));
  return v_id;
end $$;

/** Operators set how long automatically scheduled race seasons run. */
create or replace function public.ops_set_season_length(p_competition uuid, p_days integer) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
begin
  if p_days is null or p_days not between 7 and 120 then raise exception 'season_length' using errcode = '22023', detail = 'Use 7 to 120 days.'; end if;
  update public.competitions set season_length_days = p_days where id = p_competition and kind in ('public', 'club');
  if not found then raise exception 'only races have seasons' using errcode = '22023'; end if;
  perform internal.audit(v_actor, 'staff', 'season_length_set', 'competition', p_competition::text, jsonb_build_object('days', p_days));
end $$;

/**
 * Self-healing: a run whose other layers are still waiting after its race claim was decided (for example
 * when a deploy landed between upload and evaluation) is evaluated again. Recent runs only.
 */
create index if not exists loop_claims_waiting_layers_idx on public.loop_claims (created_at) where status = 'processing' and parent_claim_id is not null;
create or replace function internal.enqueue_waiting_layers(p_limit integer default 50) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    select distinct ch.parent_claim_id
      from public.loop_claims ch join public.loop_claims p on p.id = ch.parent_claim_id
     where ch.status = 'processing' and ch.parent_claim_id is not null and p.status <> 'processing'
       and ch.created_at < now() - interval '10 minutes' and ch.created_at > now() - interval '3 days'
       and not exists (select 1 from internal.jobs j where j.queue = 'territory' and j.dedupe_key = 'loop:' || ch.parent_claim_id::text
                         and j.status in ('queued', 'running'))
     limit p_limit
  loop
    perform internal.enqueue_job('territory', 'evaluate_loop', jsonb_build_object('claim_id', v_id), 'loop:' || v_id::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function internal.run_maintenance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_t integer;
  v_s integer;
  v_a integer;
  v_m integer;
  v_l integer;
begin
  perform internal.maintain_seasons();
  v_t := internal.publish_due_territory(500);
  v_s := internal.publish_due_titles(500);
  v_a := internal.evaluate_dirty_achievements(300);
  v_m := internal.enqueue_missing_movement(100);
  v_l := internal.enqueue_waiting_layers(50);
  -- Digest dispatch is per user local time; the worker groups pending items (see notifications job).
  if exists (select 1 from internal.digest_items where digested_at is null) then
    perform internal.enqueue_job('notifications', 'dispatch_digests', '{}', 'digests', now());
  end if;
  return jsonb_build_object('territory_events', v_t, 'titles', v_s, 'achievements', v_a, 'movement_jobs', v_m, 'layer_jobs', v_l);
end $$;

-- The all-time map exists from now on for every region with a public race.
select internal.ensure_permanent_layers();

-- Backfill: land already held in races becomes the all-time map (latest verified loop wins each cell,
-- across all seasons so far). Copied loops keep their cells except any now under a safety override.
do $$
declare
  r record;
  v_perm uuid;
  v_season uuid;
  v_child uuid;
begin
  for r in
    select lc.*, pc.region_id
      from public.loop_claims lc
      join public.competitions pc on pc.id = lc.competition_id and pc.kind = 'public'
     where lc.source = 'loop' and lc.parent_claim_id is null and lc.status in ('eligible', 'processing', 'pending_review')
       and not exists (select 1 from public.loop_claims x join public.competitions xc on xc.id = x.competition_id and xc.kind = 'permanent'
                        where x.parent_claim_id = lc.id)
     order by lc.completed_at nulls last, lc.id
  loop
    select c.id, s.id into v_perm, v_season from public.competitions c join public.seasons s on s.competition_id = c.id
     where c.region_id = r.region_id and c.kind = 'permanent' order by s.number limit 1;
    if v_perm is null then continue; end if;
    insert into public.loop_claims (user_id, competition_id, season_id, status, reasons, rule_version, algorithm_version, grid_resolution,
                                    boundary_band_m, exclusion_set_version, completed_at, received_at, validated_at, publish_after, polygon,
                                    raw_area_m2, eligible_area_m2, eligible_cell_count, length_m, parent_claim_id)
    values (r.user_id, v_perm, v_season, r.status, r.reasons, r.rule_version, r.algorithm_version, r.grid_resolution,
            r.boundary_band_m, r.exclusion_set_version, r.completed_at, r.received_at, r.validated_at, r.publish_after, r.polygon,
            r.raw_area_m2, r.eligible_area_m2, r.eligible_cell_count, r.length_m, r.id)
    returning id into v_child;
    if r.status = 'eligible' then
      insert into internal.claim_cells (claim_id, cell)
      select v_child, cc.cell from internal.claim_cells cc join internal.territory_cells tc on tc.cell = cc.cell
       where cc.claim_id = r.id
         and not exists (select 1 from public.exclusion_zones ez where ez.region_id = r.region_id and ez.active and ez.kind = 'safety_override'
                          and extensions.st_intersects(ez.geom, tc.geom::extensions.geography));
      perform internal.apply_claim(v_child);
    end if;
  end loop;
  -- What is already public in the races is public on the map at once, without a flood of notifications.
  for r in select c.id as comp, s.id as season from public.competitions c join public.seasons s on s.competition_id = c.id where c.kind = 'permanent' loop
    insert into internal.cell_control_public (competition_id, season_id, cell, controller_id, claim_id, status, published_at)
    select r.comp, r.season, ctl.cell, ctl.controller_id, ctl.claim_id, 'controlled', now()
      from internal.cell_control ctl join public.loop_claims lc on lc.id = ctl.claim_id
     where ctl.competition_id = r.comp and ctl.season_id = r.season and ctl.status = 'controlled' and lc.publish_after <= now()
    on conflict (competition_id, season_id, cell) do nothing;
    update internal.territory_events set published_at = now()
     where competition_id = r.comp and season_id = r.season and published_at is null and publish_after <= now();
    update public.loop_claims set published_at = coalesce(published_at, now())
     where competition_id = r.comp and season_id = r.season and status = 'eligible' and publish_after <= now();
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants for the RPCs added in this release (everything else stays closed)
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema internal from public, anon, authenticated;
do $$
declare
  f text;
  rpc text[] := array['list_events', 'join_event', 'leave_event', 'event_standings', 'create_club_event', 'cancel_event',
                      'ops_create_event', 'ops_set_season_dates', 'ops_schedule_season', 'ops_set_season_length'];
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (rpc)
  loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
grant execute on all functions in schema public to service_role;
