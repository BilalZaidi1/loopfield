-- Movement points, territory reclamation and achievement rankings (new in this release; not in PRD v1.2).
--
--  * Movement points: every verified run (public or private) earns points from server-verified distance.
--    Points live in an internal append-only ledger; only the owner can read their balance.
--  * Reclamation: points can return cells the runner held earlier this season and lost to another
--    runner's loop. A reclaim is a one-cell, points-funded claim inside the existing engine ("newest
--    eligible claim wins each cell"), so replay, invalidation, exclusions, publication and rankings all
--    treat it exactly like any other claim. Points can never buy ground the runner did not hold, and a
--    cell taken back with points can only be won back by running.
--  * Achievements: challenges in six categories award tiered badges from verified data; the global
--    ranking scores badges only and never reads movement points.
-- Every number here is a proposed default stored in app_config (rules_status = proposed).

-- ---------------------------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('movement_points_per_km', '10', 'Movement points per verified kilometre (proposed).'),
  ('movement_points_daily_cap', '400', 'Most movement points one runner can earn per UTC day (proposed).'),
  ('reclaim_points_per_1000_m2', '1', 'Reclaim cost per cell = ceil(average cell area in m² / 1000 × this), at least 1 (proposed).'),
  ('reclaim_max_cells', '200', 'Most cells in one reclaim request.'),
  ('reclaim_enabled', 'true', 'Kill switch: reclaiming lost land with movement points.'),
  ('achievement_tier_points', '{"bronze": 10, "silver": 25, "gold": 60, "platinum": 150}', 'Ranking points per badge tier (proposed).'),
  ('achievement_category_bonus', '25', 'Ranking bonus per challenge category with at least one badge (proposed).')
on conflict (key) do nothing;

create or replace function internal.config_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select (value #>> '{}')::integer from public.app_config where key = p_key), p_default);
$$;

-- Country of a competition region (ISO 3166-1 alpha-2), for country rankings.
alter table public.regions add column if not exists country_code text check (country_code ~ '^[A-Z]{2}$');
update public.regions set country_code = 'PK' where slug = 'dev-karachi' and country_code is null;

-- ---------------------------------------------------------------------------------------------
-- Movement points: append-only ledger and cached balance (internal: never readable by clients)
-- ---------------------------------------------------------------------------------------------
create table internal.movement_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('run', 'revoke', 'reinstate', 'reclaim', 'refund')),
  amount integer not null,
  activity_id uuid,            -- run, revoke, reinstate (no FK: the record outlives a deleted run)
  claim_id uuid,               -- reclaim, refund (the one-cell reclaim claim)
  request_id uuid,             -- reclaim, refund (groups one reclaim request)
  verified_distance_m double precision not null default 0,
  earned_on date,              -- UTC day of the run, for the daily cap and streaks
  rule_version text,
  reasons text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  check ((kind in ('run', 'revoke', 'reinstate')) = (activity_id is not null)),
  check ((kind in ('reclaim', 'refund')) = (claim_id is not null))
);
create unique index movement_ledger_run_once on internal.movement_ledger (activity_id) where kind = 'run';
create unique index movement_ledger_reclaim_once on internal.movement_ledger (claim_id) where kind = 'reclaim';
create unique index movement_ledger_refund_once on internal.movement_ledger (claim_id) where kind = 'refund';
create index movement_ledger_user_idx on internal.movement_ledger (user_id, created_at desc);
create index movement_ledger_activity_idx on internal.movement_ledger (activity_id) where activity_id is not null;

create table internal.movement_balances (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0,         -- may go below zero if a run whose points were spent is removed
  earned_total integer not null default 0,
  spent_total integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Users whose achievements must be re-evaluated (drained by run_maintenance).
create table internal.achievement_dirty (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  marked_at timestamptz not null default now()
);

create or replace function internal.mark_achievements_dirty(p_user uuid) returns void
language sql security definer set search_path = pg_catalog, internal as $$
  insert into internal.achievement_dirty (user_id) select p_user where p_user is not null
  on conflict (user_id) do update set marked_at = now();
$$;

-- Serialises every change to one runner's points (award, revoke, reclaim, refund).
create or replace function internal.lock_movement(p_user uuid) returns void
language sql security definer set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(hashtextextended('movement:' || p_user::text, 0));
$$;

create or replace function internal.add_to_balance(p_user uuid, p_delta integer, p_earned integer, p_spent integer) returns integer
language sql security definer set search_path = pg_catalog, internal as $$
  insert into internal.movement_balances as b (user_id, balance, earned_total, spent_total) values (p_user, p_delta, p_earned, p_spent)
  on conflict (user_id) do update set balance = b.balance + p_delta, earned_total = b.earned_total + p_earned,
                                     spent_total = b.spent_total + p_spent, updated_at = now()
  returning balance;
$$;

/**
 * Award points for one processed run, exactly once. The worker passes the verified distance from
 * evaluateMovement (mocked runs pass 0). Points = floor(km × rate), limited by the daily cap.
 */
create or replace function internal.award_movement_points(p_activity uuid, p_verified_distance_m double precision, p_rule_version text, p_reasons text[] default '{}')
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_act public.activities;
  v_day date;
  v_dist double precision := greatest(coalesce(p_verified_distance_m, 0), 0);
  v_raw integer;
  v_today integer;
  v_points integer;
begin
  select * into v_act from public.activities where id = p_activity;
  if not found or v_act.deleted_at is not null or v_act.status = 'deleted' then return 0; end if;
  perform internal.lock_movement(v_act.user_id);
  select amount into v_points from internal.movement_ledger where activity_id = p_activity and kind = 'run';
  if found then return v_points; end if; -- idempotent: a run is rewarded once
  v_day := (v_act.started_at at time zone 'UTC')::date;
  v_raw := floor(v_dist * internal.config_int('movement_points_per_km', 10) / 1000.0)::integer;
  select coalesce(sum(amount), 0)::integer into v_today
    from internal.movement_ledger where user_id = v_act.user_id and kind = 'run' and earned_on = v_day;
  v_points := least(v_raw, greatest(internal.config_int('movement_points_daily_cap', 400) - v_today, 0));
  insert into internal.movement_ledger (user_id, kind, amount, activity_id, verified_distance_m, earned_on, rule_version, reasons, note)
  values (v_act.user_id, 'run', v_points, p_activity, v_dist, v_day, p_rule_version, coalesce(p_reasons, '{}'),
          case when v_points < v_raw then 'daily_cap' end);
  perform internal.add_to_balance(v_act.user_id, v_points, v_points, 0);
  perform internal.mark_achievements_dirty(v_act.user_id);
  return v_points;
end $$;

-- Net points and distance one run currently contributes (run + revokes + reinstatements).
create or replace function internal.run_movement_net(p_activity uuid, out points integer, out distance_m double precision)
language sql stable security definer set search_path = pg_catalog, internal as $$
  select coalesce(sum(amount), 0)::integer, coalesce(sum(verified_distance_m), 0)
    from internal.movement_ledger where activity_id = p_activity and kind in ('run', 'revoke', 'reinstate');
$$;

/** Remove a run's points (run deleted, or its result ruled invalid). The balance may go below zero. */
create or replace function internal.revoke_movement_points(p_activity uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_run internal.movement_ledger;
  v_net record;
begin
  select * into v_run from internal.movement_ledger where activity_id = p_activity and kind = 'run';
  if not found then return 0; end if;
  perform internal.lock_movement(v_run.user_id);
  select * into v_net from internal.run_movement_net(p_activity);
  if v_net.points <= 0 and v_net.distance_m <= 0 then return 0; end if; -- already removed
  insert into internal.movement_ledger (user_id, kind, amount, activity_id, verified_distance_m, earned_on, rule_version, note)
  values (v_run.user_id, 'revoke', -v_net.points, p_activity, -v_net.distance_m, v_run.earned_on, v_run.rule_version, p_reason);
  perform internal.add_to_balance(v_run.user_id, -v_net.points, -v_net.points, 0);
  perform internal.mark_achievements_dirty(v_run.user_id);
  return v_net.points;
end $$;

/** Give a run's points back when the result that removed them is overturned on appeal. */
create or replace function internal.reinstate_movement_points(p_activity uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_run internal.movement_ledger;
  v_net record;
begin
  select * into v_run from internal.movement_ledger where activity_id = p_activity and kind = 'run';
  if not found then return 0; end if;
  perform internal.lock_movement(v_run.user_id);
  if not exists (select 1 from public.activities where id = p_activity and deleted_at is null) then return 0; end if;
  select * into v_net from internal.run_movement_net(p_activity);
  if v_net.points > 0 or v_net.distance_m > 0 then return 0; end if; -- nothing was removed
  insert into internal.movement_ledger (user_id, kind, amount, activity_id, verified_distance_m, earned_on, rule_version, note)
  values (v_run.user_id, 'reinstate', v_run.amount, p_activity, v_run.verified_distance_m, v_run.earned_on, v_run.rule_version, p_reason);
  perform internal.add_to_balance(v_run.user_id, v_run.amount, v_run.amount, 0);
  perform internal.mark_achievements_dirty(v_run.user_id);
  return v_run.amount;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reclaims are claims: one cell each, funded by points, with no activity
-- ---------------------------------------------------------------------------------------------
alter table public.loop_claims alter column activity_id drop not null;
alter table public.loop_claims add column source text not null default 'loop' check (source in ('loop', 'reclaim'));
alter table public.loop_claims add column points_spent integer check (points_spent is null or points_spent > 0);
alter table public.loop_claims add column reclaim_request_id uuid;
alter table public.loop_claims add column undone_claim_id uuid;   -- the run claim this reclaim took the cell back from
alter table public.loop_claims add column basis_claim_id uuid;    -- the runner's own claim that held the cell earlier
alter table public.loop_claims add column refunded_at timestamptz;
alter table public.loop_claims add constraint loop_claims_source_shape check (
  (source = 'loop' and activity_id is not null and points_spent is null)
  or (source = 'reclaim' and activity_id is null and points_spent is not null and reclaim_request_id is not null
      and undone_claim_id is not null and basis_claim_id is not null));
create index loop_claims_undone_idx on public.loop_claims (undone_claim_id) where source = 'reclaim';
create index loop_claims_basis_idx on public.loop_claims (basis_claim_id) where source = 'reclaim';
create index loop_claims_request_idx on public.loop_claims (reclaim_request_id) where source = 'reclaim';

create table internal.reclaim_requests (
  id uuid primary key,                   -- chosen by the client: a retried request is answered, never re-charged
  user_id uuid not null references public.profiles (id) on delete cascade,
  competition_id uuid not null,
  season_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index reclaim_requests_user_idx on internal.reclaim_requests (user_id, created_at desc);

-- Cost of one cell at a grid resolution: proportional to the cell's average area.
create or replace function internal.reclaim_cost(p_resolution smallint) returns integer
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select greatest(1, ceil(
           (case p_resolution when 9 then 105332.513 when 10 then 15047.502 when 12 then 307.092 else 2149.643 end) / 1000.0
           * coalesce((select (value #>> '{}')::numeric from public.app_config where key = 'reclaim_points_per_1000_m2'), 1)))::integer;
$$;

/**
 * Cells this runner legitimately held this season, with the latest claim that proved it: the runner
 * was recorded as controller by a claim that is still eligible.
 */
create or replace function internal.held_basis(p_user uuid, p_competition uuid, p_season uuid, p_cells bigint[])
returns table (cell bigint, basis_claim uuid, basis_completed_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select distinct on (ec.cell) ec.cell, mine.id, mine.completed_at
    from internal.territory_event_cells ec
    join internal.territory_events e on e.id = ec.event_id
    join public.loop_claims mine on mine.id = ec.new_claim
   where e.competition_id = p_competition and e.season_id = p_season
     and ec.new_controller = p_user and mine.user_id = p_user and mine.status = 'eligible'
     and (p_cells is null or ec.cell = any (p_cells))
   order by ec.cell, mine.completed_at desc, mine.id desc;
$$;

-- ---------------------------------------------------------------------------------------------
-- Publication of one event (shared by the minute job and by reclaims, which publish at once:
-- a reclaim reveals no runner's position, so it does not wait out the publication delay)
-- ---------------------------------------------------------------------------------------------
create or replace function internal.publish_event(p_event uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_event internal.territory_events;
begin
  select * into v_event from internal.territory_events where id = p_event and published_at is null and publish_after <= now() for update skip locked;
  if not found then return false; end if;
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

  update internal.territory_events set published_at = now() where id = v_event.id;
  update public.loop_claims set published_at = coalesce(published_at, now()) where id = v_event.claim_id;
  return true;
end $$;

create or replace function internal.publish_due_territory(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not internal.config_bool('public_publication_enabled') then return 0; end if;
  for v_id in
    select id from internal.territory_events where published_at is null and publish_after <= now()
     order by publish_after, created_at limit p_limit
  loop
    if internal.publish_event(v_id) then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lost and reclaimable cells (the runner's own view, from the published snapshot)
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_lost_cells(p_competition uuid, p_season uuid,
  p_min_lng double precision default null, p_min_lat double precision default null,
  p_max_lng double precision default null, p_max_lat double precision default null)
returns table (cell text, controller_key text, controller_name text, lost_on date, reclaimable boolean, blocked_reason text, cost integer)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
declare
  v_user uuid := auth.uid();
  v_season public.seasons;
  v_env geometry;
  v_open boolean;
  v_cost integer;
  v_participating boolean;
begin
  if v_user is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_season from public.seasons where id = p_season and competition_id = p_competition;
  if not found then return; end if;
  if p_min_lng is not null then
    if (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat) > 0.06 then raise exception 'zoom_in' using errcode = 'P0413'; end if;
    v_env := st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
  end if;
  v_open := v_season.status = 'active' and now() >= v_season.starts_at and now() < v_season.ends_at
            and internal.config_bool('reclaim_enabled') and internal.config_bool('territory_capture_enabled');
  v_participating := coalesce((select territory_competition_enabled from public.user_settings where user_id = v_user), false);
  v_cost := internal.reclaim_cost(v_season.grid_resolution);
  return query
  with lost as (
    select p.cell, p.controller_id, p.claim_id, p.published_at
      from internal.cell_control_public p
      join internal.territory_cells tc on tc.cell = p.cell
     where p.competition_id = p_competition and p.season_id = p_season and p.status = 'controlled'
       and p.controller_id is not null and p.controller_id <> v_user
       and (v_env is null or tc.geom && v_env)
  )
  select l.cell::text,
         case when authz.is_blocked(l.controller_id, v_user) then 'hidden' else md5(l.controller_id::text) end,
         case when authz.is_blocked(l.controller_id, v_user) then 'A runner' else pr.display_name end,
         (l.published_at at time zone 'UTC')::date,
         v_open and v_participating and lc.source = 'loop',
         case when not v_open then 'season_closed'
              when not v_participating then 'not_participating'
              when lc.source = 'reclaim' then 'taken_with_points' end,
         v_cost
    from lost l
    join internal.held_basis(v_user, p_competition, p_season, (select array_agg(lost.cell) from lost)) hb on hb.cell = l.cell
    join public.loop_claims lc on lc.id = l.claim_id
    left join public.profiles pr on pr.id = l.controller_id
   order by l.published_at desc, l.cell
   limit 2000;
end $$;

/**
 * Reclaim lost cells with movement points, atomically: every check, the deduction and the ownership
 * change happen in one transaction under the runner's points lock and the cells' partition locks, or
 * nothing happens. `p_request` is chosen by the client; repeating it returns the first result.
 */
create or replace function public.reclaim_cells(p_request uuid, p_competition uuid, p_season uuid, p_cells text[])
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_prior internal.reclaim_requests;
  v_comp public.competitions;
  v_season public.seasons;
  v_region public.regions;
  v_cells bigint[];
  v_cost integer;
  v_balance integer;
  v_total integer;
  v_now timestamptz := now(); -- transaction time, so the new events count as due when published below
  v_claim uuid;
  v_event uuid;
  v_done text[] := '{}';
  v_events uuid[] := '{}';
  v_result jsonb;
  r record;
begin
  if p_request is null then raise exception 'request_id_required' using errcode = '22023'; end if;
  select * into v_prior from internal.reclaim_requests where id = p_request;
  if found then
    if v_prior.user_id <> v_user then raise exception 'request_id_in_use' using errcode = '22023'; end if;
    return v_prior.result;
  end if;
  if not internal.config_bool('reclaim_enabled') or not internal.config_bool('territory_capture_enabled') then
    raise exception 'reclaim_suspended' using errcode = 'P0503';
  end if;
  if p_cells is null or cardinality(p_cells) = 0 then raise exception 'no_cells' using errcode = '22023'; end if;
  if cardinality(p_cells) > internal.config_int('reclaim_max_cells', 200) then raise exception 'too_many_cells' using errcode = '22023'; end if;
  perform internal.enforce_rate_limit(v_user::text, 'reclaim', 30, 3600);

  select * into v_comp from public.competitions where id = p_competition;
  if not found or v_comp.status <> 'active' or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_region from public.regions where id = v_comp.region_id;
  if v_region.status <> 'active' then raise exception 'region_suspended' using errcode = 'P0503'; end if;
  select * into v_season from public.seasons where id = p_season and competition_id = p_competition;
  if not found or v_season.status <> 'active' or v_now < v_season.starts_at or v_now >= v_season.ends_at then
    raise exception 'season_closed' using errcode = 'P0409';
  end if;
  if not coalesce((select territory_competition_enabled from public.user_settings where user_id = v_user), false) then
    raise exception 'not_participating' using errcode = '42501';
  end if;
  begin
    select array_agg(distinct c::bigint order by c::bigint) into v_cells from unnest(p_cells) c;
  exception when others then
    raise exception 'invalid_cell' using errcode = '22023';
  end;

  -- Lock order everywhere: the runner's points, then the cells' partitions.
  perform internal.lock_movement(v_user);
  perform internal.lock_partitions(p_competition, p_season, v_cells);
  v_cost := internal.reclaim_cost(v_season.grid_resolution);

  create temporary table if not exists pg_temp.reclaim_eligible (cell bigint primary key, live_claim uuid, live_completed_at timestamptz, basis_claim uuid) on commit drop;
  delete from pg_temp.reclaim_eligible;
  insert into pg_temp.reclaim_eligible
  select c.cell, live.claim_id, live.claim_completed_at, hb.basis_claim
    from unnest(v_cells) c(cell)
    join internal.cell_control_public pub on pub.competition_id = p_competition and pub.season_id = p_season and pub.cell = c.cell
    join internal.cell_control live on live.competition_id = p_competition and live.season_id = p_season and live.cell = c.cell
    join public.loop_claims lc on lc.id = live.claim_id
    join internal.held_basis(v_user, p_competition, p_season, v_cells) hb on hb.cell = c.cell
   where pub.status = 'controlled' and pub.controller_id is not null and pub.controller_id <> v_user       -- shown to the runner as lost
     and live.status = 'controlled' and live.controller_id is not null and live.controller_id <> v_user    -- still held by someone else
     and lc.source = 'loop' and lc.status = 'eligible'                                                     -- taken by running, not by points
     and hb.basis_completed_at < live.claim_completed_at;                                                  -- the runner held it before that loop

  select count(*)::integer * v_cost into v_total from pg_temp.reclaim_eligible;
  if v_total = 0 then raise exception 'nothing_to_reclaim' using errcode = 'P0409'; end if;
  v_balance := coalesce((select balance from internal.movement_balances where user_id = v_user), 0);
  if v_balance < v_total then
    raise exception 'insufficient_points' using errcode = 'P0402', detail = format('needs %s, balance %s', v_total, v_balance);
  end if;

  for r in select e.*, tc.geom, tc.area_m2 from pg_temp.reclaim_eligible e join internal.territory_cells tc on tc.cell = e.cell order by e.cell loop
    insert into public.loop_claims (user_id, competition_id, season_id, status, rule_version, algorithm_version, grid_resolution,
                                    completed_at, received_at, validated_at, publish_after, polygon, raw_area_m2, eligible_area_m2,
                                    eligible_cell_count, source, points_spent, reclaim_request_id, undone_claim_id, basis_claim_id)
    values (v_user, p_competition, p_season, 'eligible', 'movement-2026.11.0-proposed', 'reclaim-1', v_season.grid_resolution,
            greatest(v_now, r.live_completed_at + interval '1 millisecond'), v_now, v_now, v_now, r.geom, r.area_m2, r.area_m2,
            1, 'reclaim', v_cost, p_request, r.live_claim, r.basis_claim)
    returning id into v_claim;
    insert into internal.claim_cells (claim_id, cell) values (v_claim, r.cell);
    insert into internal.movement_ledger (user_id, kind, amount, claim_id, request_id)
    values (v_user, 'reclaim', -v_cost, v_claim, p_request);
    v_event := internal.apply_claim(v_claim);
    -- The reclaim must now hold the cell, or the whole request rolls back and nothing is charged.
    if v_event is null or not exists (select 1 from internal.cell_control where competition_id = p_competition and season_id = p_season
                                       and cell = r.cell and controller_id = v_user and claim_id = v_claim) then
      raise exception 'reclaim_conflict' using errcode = '40001';
    end if;
    v_done := v_done || r.cell::text;
    v_events := v_events || v_event;
  end loop;

  v_balance := internal.add_to_balance(v_user, -v_total, 0, v_total);
  if internal.config_bool('public_publication_enabled') then
    perform internal.publish_event(e) from unnest(v_events) e;
  end if;
  perform internal.audit(v_user, 'user', 'territory_reclaimed', 'reclaim_request', p_request::text,
                         jsonb_build_object('cells', cardinality(v_done), 'points', v_total, 'competition_id', p_competition, 'season_id', p_season));

  v_result := jsonb_build_object('request_id', p_request, 'reclaimed', cardinality(v_done), 'skipped', cardinality(v_cells) - cardinality(v_done),
                                 'cost_per_cell', v_cost, 'spent', v_total, 'balance', v_balance, 'cells', to_jsonb(v_done));
  insert into internal.reclaim_requests (id, user_id, competition_id, season_id, result) values (p_request, v_user, p_competition, p_season, v_result);
  return v_result;
end $$;

/** Points back for a reclaim whose capturing run was later invalidated or withdrawn (the runner keeps the cell). */
create or replace function internal.refund_reclaim(p_claim uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v public.loop_claims;
begin
  select * into v from public.loop_claims where id = p_claim and source = 'reclaim';
  if not found or v.refunded_at is not null then return 0; end if;
  perform internal.lock_movement(v.user_id);
  insert into internal.movement_ledger (user_id, kind, amount, claim_id, request_id, note)
  values (v.user_id, 'refund', v.points_spent, v.id, v.reclaim_request_id, p_reason)
  on conflict do nothing;
  if not found then return 0; end if;
  update public.loop_claims set refunded_at = now() where id = v.id;
  perform internal.add_to_balance(v.user_id, v.points_spent, 0, -v.points_spent);
  return v.points_spent;
end $$;

/**
 * Consequences when a claim stops being eligible (invalidation, withdrawal, deletion, consent):
 *  1. reclaims that undid this capture are refunded (the runner who lost the cell is made whole);
 *  2. reclaims that relied on this claim as proof of earlier ownership are withdrawn if it was ruled invalid;
 *  3. a run whose result was ruled invalid loses its movement points (and regains them if restored).
 */
create or replace function internal.on_claim_status_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  r record;
  v_refunds jsonb := '{}';
  v_points integer;
begin
  if new.source = 'loop' and old.status = 'eligible' and new.status <> 'eligible' then
    for r in
      select id, user_id from public.loop_claims
       where source = 'reclaim' and undone_claim_id = new.id and status = 'eligible' and refunded_at is null
       order by user_id, id
    loop
      v_points := internal.refund_reclaim(r.id, 'capture_' || new.status);
      v_refunds := jsonb_set(v_refunds, array[r.user_id::text], to_jsonb(coalesce((v_refunds ->> r.user_id::text)::integer, 0) + v_points));
    end loop;
    for r in select key::uuid as user_id, value::integer as points from jsonb_each_text(v_refunds) loop
      if r.points > 0 then
        perform internal.notify(r.user_id, 'competitive', 'points_refunded', null, 'loop_claim', new.id::text,
                                jsonb_build_object('points', r.points), 'refund:' || new.id::text);
      end if;
    end loop;
    if new.status = 'invalid' then
      for r in select id from public.loop_claims where source = 'reclaim' and basis_claim_id = new.id and status = 'eligible' loop
        perform internal.invalidate_claim(r.id, 'withdrawn', 'basis_invalidated', null);
      end loop;
    end if;
  end if;
  if new.source = 'loop' and new.activity_id is not null then
    if new.status = 'invalid' and old.status in ('eligible', 'pending_review') then
      perform internal.revoke_movement_points(new.activity_id, 'result_invalidated');
    elsif old.status = 'invalid' and new.status = 'eligible' then
      perform internal.reinstate_movement_points(new.activity_id, 'appeal_overturned');
    end if;
  end if;
  if old.status is distinct from new.status then perform internal.mark_achievements_dirty(new.user_id); end if;
  return null;
end $$;
create trigger loop_claims_status_change after update of status on public.loop_claims
  for each row execute function internal.on_claim_status_change();

-- ---------------------------------------------------------------------------------------------
-- History and cell detail now say how ground was taken (a run or points)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.territory_cell_detail(uuid, uuid, text);
create function public.territory_cell_detail(p_competition uuid, p_season uuid, p_cell text)
returns table (cell text, status text, controller_handle text, controller_name text, is_me boolean, controlled_since date,
               claim_cells integer, my_claim_id uuid, held_by text, was_mine boolean, reclaimable boolean, blocked_reason text, reclaim_cost integer)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select p.cell::text, p.status,
         case when authz.is_blocked(p.controller_id, v_user) then null else pr.handle::text end,
         case when p.controller_id is null then null when authz.is_blocked(p.controller_id, v_user) then 'A runner' else pr.display_name end,
         p.controller_id = v_user,
         -- Date only: precise completion times are never disclosed (PRD §11).
         (p.published_at at time zone 'UTC')::date,
         (select count(*)::integer from internal.claim_cells cc where cc.claim_id = p.claim_id),
         case when p.controller_id = v_user then p.claim_id else null end,
         lc.source,
         lost.cell is not null,
         coalesce(lost.reclaimable, false),
         lost.blocked_reason,
         lost.cost
    from internal.cell_control_public p
    left join public.profiles pr on pr.id = p.controller_id
    left join public.loop_claims lc on lc.id = p.claim_id
    left join lateral (select * from public.my_lost_cells(p_competition, p_season) m where m.cell = p.cell::text) lost on p.controller_id is distinct from v_user
   where p.competition_id = p_competition and p.season_id = p_season and p.cell = p_cell::bigint;
end $$;

drop function if exists public.my_territory_events(integer);
create function public.my_territory_events(p_limit integer default 30)
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

-- ---------------------------------------------------------------------------------------------
-- Owner-only movement RPCs
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_movement()
returns table (balance integer, earned_total integer, spent_total integer, verified_distance_m double precision,
               earned_7d integer, earned_today integer, daily_cap integer, points_per_km integer, cost_per_cell integer)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce(b.balance, 0), coalesce(b.earned_total, 0), coalesce(b.spent_total, 0),
         coalesce((select sum(verified_distance_m) from internal.movement_ledger where user_id = auth.uid() and kind in ('run', 'revoke', 'reinstate')), 0),
         coalesce((select sum(amount) from internal.movement_ledger where user_id = auth.uid() and kind in ('run', 'revoke', 'reinstate') and created_at > now() - interval '7 days'), 0)::integer,
         coalesce((select sum(amount) from internal.movement_ledger where user_id = auth.uid() and kind = 'run' and earned_on = (now() at time zone 'UTC')::date), 0)::integer,
         internal.config_int('movement_points_daily_cap', 400),
         internal.config_int('movement_points_per_km', 10),
         internal.reclaim_cost(11::smallint)
    from (select auth.uid() as uid) me
    left join internal.movement_balances b on b.user_id = me.uid
   where me.uid is not null;
$$;

create or replace function public.my_movement_history(p_limit integer default 30)
returns table (kind text, amount integer, cells integer, activity_id uuid, request_id uuid, verified_distance_m double precision, note text, occurred_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select kind, sum(amount)::integer, case when kind in ('reclaim', 'refund') then count(*)::integer end,
         min(activity_id::text)::uuid, request_id, sum(verified_distance_m), min(note), max(created_at)
    from internal.movement_ledger
   where user_id = auth.uid()
   group by kind, coalesce(request_id::text, activity_id::text, id::text), request_id
   order by max(created_at) desc
   limit least(p_limit, 100);
$$;

create or replace function public.activity_movement(p_activity uuid)
returns table (points integer, verified_distance_m double precision, reasons text[], capped boolean, removed boolean, processed boolean)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce(net.points, 0), coalesce(net.distance_m, 0), coalesce(run.reasons, '{}'), coalesce(run.note = 'daily_cap', false),
         run.id is not null and net.points <= 0 and run.amount > 0, run.id is not null
    from public.activities a
    left join internal.movement_ledger run on run.activity_id = a.id and run.kind = 'run'
    left join lateral internal.run_movement_net(a.id) net on true
   where a.id = p_activity and a.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------------------------
-- Challenges, badges and the achievement score
-- ---------------------------------------------------------------------------------------------
create table public.challenges (
  id text primary key check (id ~ '^[a-z0-9_]{3,40}$'),
  category text not null check (category in ('distance', 'consistency', 'territory', 'exploration', 'community', 'competitive')),
  tier text not null check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  title text not null check (char_length(title) <= 40),
  description text not null check (char_length(description) <= 160),
  metric text not null,
  target numeric not null check (target > 0),
  unit text not null,
  sort smallint not null,
  active boolean not null default true
);
alter table public.challenges enable row level security;
grant select on public.challenges to authenticated;
create policy challenges_read on public.challenges for select to authenticated using (true);

insert into public.challenges (id, category, tier, title, description, metric, target, unit, sort) values
  ('distance_10',       'distance',    'bronze',   'First ten',        'Run 10 km of verified distance, public or private.',                    'distance_km',     10,   'km',       11),
  ('distance_50',       'distance',    'silver',   'Half century',     'Run 50 km of verified distance.',                                      'distance_km',     50,   'km',       12),
  ('distance_250',      'distance',    'gold',     'Road regular',     'Run 250 km of verified distance.',                                     'distance_km',     250,  'km',       13),
  ('distance_1000',     'distance',    'platinum', 'Thousand club',    'Run 1,000 km of verified distance.',                                   'distance_km',     1000, 'km',       14),
  ('streak_2',          'consistency', 'bronze',   'Back again',       'Run in two weeks in a row (Monday to Sunday, UTC).',                    'best_week_streak', 2,   'weeks',    21),
  ('streak_4',          'consistency', 'silver',   'Month of running', 'Run in four weeks in a row.',                                          'best_week_streak', 4,   'weeks',    22),
  ('streak_12',         'consistency', 'gold',     'Season-proof',     'Run in twelve weeks in a row.',                                        'best_week_streak', 12,  'weeks',    23),
  ('streak_26',         'consistency', 'platinum', 'Half-year habit',  'Run in twenty-six weeks in a row.',                                    'best_week_streak', 26,  'weeks',    24),
  ('capture_25',        'territory',   'bronze',   'Stake a claim',    'Capture 25 cells with loops.',                                         'cells_captured',  25,   'cells',    31),
  ('capture_500',       'territory',   'silver',   'Landholder',       'Capture 500 cells with loops.',                                        'cells_captured',  500,  'cells',    32),
  ('defend_100',        'territory',   'gold',     'Defender',         'Run loops over 100 cells you already hold, keeping them yours.',       'cells_defended',  100,  'cells',    33),
  ('capture_5000',      'territory',   'platinum', 'Estate',           'Capture 5,000 cells with loops.',                                      'cells_captured',  5000, 'cells',    34),
  ('explore_20',        'exploration', 'bronze',   'Curious',          'Visit 20 exploration cells (about 1.5 ha each).',                      'explored_cells',  20,   'cells',    41),
  ('explore_100',       'exploration', 'silver',   'Wanderer',         'Visit 100 exploration cells.',                                         'explored_cells',  100,  'cells',    42),
  ('explore_400',       'exploration', 'gold',     'Pathfinder',       'Visit 400 exploration cells.',                                         'explored_cells',  400,  'cells',    43),
  ('explore_1500',      'exploration', 'platinum', 'Cartographer',     'Visit 1,500 exploration cells.',                                       'explored_cells',  1500, 'cells',    44),
  ('club_member',       'community',   'bronze',   'Club member',      'Be an active member of a club or community.',                          'clubs_joined',    1,    'clubs',    51),
  ('club_loops_3',      'community',   'silver',   'Club regular',     'Complete 3 eligible loops in club seasons.',                           'club_loops',      3,    'loops',    52),
  ('club_loops_15',     'community',   'gold',     'Club stalwart',    'Complete 15 eligible loops in club seasons.',                          'club_loops',      15,   'loops',    53),
  ('club_organizer_10', 'community',   'platinum', 'Organizer',        'Own or organize a club with at least 10 active members.',              'organized_members', 10, 'members',  54),
  ('route_attempt',     'competitive', 'bronze',   'On the clock',     'Finish an eligible attempt on a speed route.',                         'speed_attempts',  1,    'attempts', 61),
  ('rivals_5',          'competitive', 'silver',   'Rival',            'Take cells from 5 different runners with loops.',                      'rivals_beaten',   5,    'runners',  62),
  ('route_title',       'competitive', 'gold',     'Title holder',     'Win a speed route title.',                                             'titles_won',      1,    'titles',   63),
  ('season_top10',      'competitive', 'platinum', 'Top ten',          'Finish a settled season in the top 10 of a competition.',              'top10_finishes',  1,    'seasons',  64);

create table internal.user_challenges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id text not null references public.challenges (id) on delete cascade,
  progress numeric not null default 0,
  completed_at timestamptz,          -- badge earned (kept while the verified data still supports it)
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
create index user_challenges_badges_idx on internal.user_challenges (user_id) where completed_at is not null;

create table internal.achievement_scores (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  score integer not null default 0,
  badges integer not null default 0,
  categories integer not null default 0,
  reached_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index achievement_scores_rank_idx on internal.achievement_scores (score desc);

/** Every challenge metric for one runner, computed only from verified, still-valid data. */
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
      join public.loop_claims lc on lc.id = e.claim_id and lc.source = 'loop' and lc.status = 'eligible' and lc.user_id = p_user
     where ec.new_controller = p_user
  ), settled as (
    select p.season_id, p.controller_id, rank() over (partition by p.season_id order by round(sum(tc.area_m2)::numeric, 1) desc) as r
      from internal.cell_control_public p
      join internal.territory_cells tc on tc.cell = p.cell
      join public.seasons s on s.id = p.season_id and s.status = 'settled'
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

/** Recompute one runner's progress, badges and score; notify newly earned badges. */
create or replace function internal.evaluate_achievements(p_user uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_metrics jsonb;
  v_before text[];
  v_new integer := 0;
  v_tiers jsonb := coalesce((select value from public.app_config where key = 'achievement_tier_points'), '{"bronze":10,"silver":25,"gold":60,"platinum":150}');
  v_bonus integer := internal.config_int('achievement_category_bonus', 25);
  v_score integer;
  v_badges integer;
  v_categories integer;
  r record;
begin
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    delete from internal.achievement_scores where user_id = p_user;
    return 0;
  end if;
  v_metrics := internal.achievement_metrics(p_user);
  select coalesce(array_agg(challenge_id), '{}') into v_before from internal.user_challenges where user_id = p_user and completed_at is not null;

  insert into internal.user_challenges as uc (user_id, challenge_id, progress, completed_at)
  select p_user, c.id, coalesce((v_metrics ->> c.metric)::numeric, 0),
         case when coalesce((v_metrics ->> c.metric)::numeric, 0) >= c.target then now() end
    from public.challenges c where c.active
  on conflict (user_id, challenge_id) do update
    set progress = excluded.progress,
        completed_at = case when excluded.completed_at is null then null else coalesce(uc.completed_at, excluded.completed_at) end,
        updated_at = now();

  for r in
    select c.id, c.tier, c.title from internal.user_challenges uc join public.challenges c on c.id = uc.challenge_id
     where uc.user_id = p_user and uc.completed_at is not null and not (c.id = any (v_before))
  loop
    v_new := v_new + 1;
    perform internal.notify(p_user, 'competitive', 'badge_earned', null, 'challenge', r.id,
                            jsonb_build_object('challenge_id', r.id, 'tier', r.tier, 'title', r.title), 'badge:' || r.id);
  end loop;

  select coalesce(sum((v_tiers ->> c.tier)::integer), 0)::integer, count(*)::integer, count(distinct c.category)::integer
    into v_score, v_badges, v_categories
    from internal.user_challenges uc join public.challenges c on c.id = uc.challenge_id
   where uc.user_id = p_user and uc.completed_at is not null and c.active;
  v_score := v_score + v_categories * v_bonus;

  insert into internal.achievement_scores as s (user_id, score, badges, categories)
  values (p_user, v_score, v_badges, v_categories)
  on conflict (user_id) do update
    set score = excluded.score, badges = excluded.badges, categories = excluded.categories,
        reached_at = case when s.score <> excluded.score then now() else s.reached_at end, updated_at = now();
  return v_new;
end $$;

create or replace function internal.evaluate_dirty_achievements(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select user_id, marked_at from internal.achievement_dirty order by marked_at limit p_limit for update skip locked loop
    perform internal.evaluate_achievements(r.user_id);
    delete from internal.achievement_dirty where user_id = r.user_id and marked_at <= r.marked_at;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Marks: anything that can change a challenge metric flags the runner for re-evaluation.
create or replace function internal.dirty_from_event_cells() returns trigger
language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  insert into internal.achievement_dirty (user_id)
  select distinct u from (select new_controller as u from new_rows union select prior_controller from new_rows) x where u is not null
  on conflict (user_id) do update set marked_at = now();
  return null;
end $$;
create trigger territory_event_cells_dirty after insert on internal.territory_event_cells
  referencing new table as new_rows for each statement execute function internal.dirty_from_event_cells();

create or replace function internal.dirty_from_user_rows() returns trigger
language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  insert into internal.achievement_dirty (user_id) select distinct user_id from new_rows where user_id is not null
  on conflict (user_id) do update set marked_at = now();
  return null;
end $$;
create trigger exploration_cells_dirty_ins after insert on public.exploration_cells
  referencing new table as new_rows for each statement execute function internal.dirty_from_user_rows();
create trigger exploration_cells_dirty_upd after update on public.exploration_cells
  referencing new table as new_rows for each statement execute function internal.dirty_from_user_rows();
create trigger speed_attempts_dirty after update on public.speed_attempts
  referencing new table as new_rows for each statement execute function internal.dirty_from_user_rows();

create or replace function internal.dirty_from_membership() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  -- The member, and every owner or organizer of the club (their club size changed).
  insert into internal.achievement_dirty (user_id)
  select m.user_id from public.club_memberships m
   where m.club_id = new.club_id and (m.user_id = new.user_id or (m.state = 'active' and m.role in ('owner', 'organizer')))
  on conflict (user_id) do update set marked_at = now();
  return null;
end $$;
create trigger club_memberships_dirty after insert or update of state, role on public.club_memberships
  for each row execute function internal.dirty_from_membership();

create or replace function internal.dirty_from_titles() returns trigger
language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  insert into internal.achievement_dirty (user_id) select new.new_champion where new.new_champion is not null
  on conflict (user_id) do update set marked_at = now();
  return null;
end $$;
create trigger speed_title_changes_dirty after update of published_at on internal.speed_title_changes
  for each row when (new.published_at is not null) execute function internal.dirty_from_titles();

create or replace function internal.dirty_from_settlement() returns trigger
language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  insert into internal.achievement_dirty (user_id)
  select distinct controller_id from internal.cell_control_public where season_id = new.id and controller_id is not null
  on conflict (user_id) do update set marked_at = now();
  return null;
end $$;
create trigger seasons_settled_dirty after update of status on public.seasons
  for each row when (new.status = 'settled' and old.status is distinct from 'settled') execute function internal.dirty_from_settlement();

-- The minute job also drains achievement evaluations.
create or replace function internal.run_maintenance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_t integer;
  v_s integer;
  v_a integer;
begin
  perform internal.maintain_seasons();
  v_t := internal.publish_due_territory(500);
  v_s := internal.publish_due_titles(500);
  v_a := internal.evaluate_dirty_achievements(300);
  -- Digest dispatch is per user local time; the worker groups pending items (see notifications job).
  if exists (select 1 from internal.digest_items where digested_at is null) then
    perform internal.enqueue_job('notifications', 'dispatch_digests', '{}', 'digests', now());
  end if;
  return jsonb_build_object('territory_events', v_t, 'titles', v_s, 'achievements', v_a);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Achievement RPCs
-- ---------------------------------------------------------------------------------------------
-- Whether `p_viewer` may see `p_target`'s achievements: themselves, a public profile, or an accepted
-- follower; never anyone in full private mode, and never across a block.
create or replace function internal.can_see_achievements(p_target uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select p_viewer is not null and (
    p_target = p_viewer
    or (authz.can_view_profile(p_target, p_viewer)
        and not coalesce((select full_private_mode from public.user_settings where user_id = p_target), false)
        and ((select visibility from public.profiles where id = p_target) = 'public' or authz.follows(p_viewer, p_target))));
$$;

create or replace function public.my_challenges()
returns table (id text, category text, tier text, title text, description text, unit text, target numeric, progress numeric, completed_at timestamptz, sort smallint)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select c.id, c.category, c.tier, c.title, c.description, c.unit, c.target, coalesce(uc.progress, 0), uc.completed_at, c.sort
    from public.challenges c
    left join internal.user_challenges uc on uc.challenge_id = c.id and uc.user_id = auth.uid()
   where c.active and auth.uid() is not null
   order by c.sort;
$$;

/** Ask for an immediate re-evaluation of my own achievements (pull to refresh). */
create or replace function public.refresh_my_achievements() returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  perform internal.enforce_rate_limit(v_user::text, 'refresh_achievements', 20, 3600);
  return internal.evaluate_achievements(v_user);
end $$;

create or replace function public.achievement_profile(p_user uuid)
returns table (visible boolean, score integer, badges integer, categories integer, global_rank bigint, ranked_runners bigint, earned jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid := coalesce(p_user, auth.uid());
  v_score internal.achievement_scores;
begin
  if v_viewer is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not internal.can_see_achievements(v_target, v_viewer) then
    return query select false, null::integer, null::integer, null::integer, null::bigint, null::bigint, null::jsonb;
    return;
  end if;
  select * into v_score from internal.achievement_scores where user_id = v_target;
  return query
  with ranked as (
    select s.user_id, rank() over (order by s.score desc) as r
      from internal.achievement_scores s
      join public.profiles p on p.id = s.user_id and p.status = 'active'
      left join public.user_settings us on us.user_id = s.user_id
     where s.score > 0 and not coalesce(us.full_private_mode, false)
  )
  select true, coalesce(v_score.score, 0), coalesce(v_score.badges, 0), coalesce(v_score.categories, 0),
         (select r from ranked where user_id = v_target), (select count(*) from ranked),
         coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tier', c.tier, 'category', c.category, 'title', c.title,
                                                       'completed_on', (uc.completed_at at time zone 'UTC')::date) order by c.sort)
                     from internal.user_challenges uc join public.challenges c on c.id = uc.challenge_id
                    where uc.user_id = v_target and uc.completed_at is not null and c.active), '[]'::jsonb);
end $$;

/**
 * Global achievement leaderboard. Scope: everyone, country, region (by the viewer's district), friends
 * (mutual follows) or club (members of a club the viewer belongs to). Movement points never count.
 * Runners the viewer may not identify are ranked as "Private runner".
 */
create or replace function public.achievement_leaderboard(p_scope text default 'everyone', p_club uuid default null, p_limit integer default 50)
returns table (rank bigint, user_id uuid, handle text, display_name text, avatar_path text, score integer, badges integer,
               categories integer, top_tier text, is_me boolean, hidden boolean, total bigint)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_viewer uuid := auth.uid();
  v_region uuid;
  v_country text;
begin
  if v_viewer is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_scope not in ('everyone', 'country', 'region', 'friends', 'club') then raise exception 'bad scope' using errcode = '22023'; end if;
  select d.region_id, r.country_code into v_region, v_country
    from public.profiles p join public.districts d on d.id = p.district_id join public.regions r on r.id = d.region_id
   where p.id = v_viewer;
  if p_scope in ('country', 'region') and v_region is null then raise exception 'set_city' using errcode = 'P0404'; end if;
  if p_scope = 'country' and v_country is null then raise exception 'no_country' using errcode = 'P0404'; end if;
  if p_scope = 'club' and (p_club is null or not authz.is_active_member(p_club, v_viewer)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with pool as (
    select s.user_id, s.score, s.badges, s.categories
      from internal.achievement_scores s
      join public.profiles p on p.id = s.user_id and p.status = 'active'
      left join public.user_settings us on us.user_id = s.user_id
      left join public.districts d on d.id = p.district_id
      left join public.regions rg on rg.id = d.region_id
     where s.score > 0 and not coalesce(us.full_private_mode, false)
       and not authz.is_blocked(s.user_id, v_viewer)
       and (p_scope = 'everyone'
         or (p_scope = 'region' and d.region_id = v_region)
         or (p_scope = 'country' and rg.country_code = v_country)
         or (p_scope = 'friends' and (s.user_id = v_viewer or (authz.follows(v_viewer, s.user_id) and authz.follows(s.user_id, v_viewer))))
         or (p_scope = 'club' and authz.is_active_member(p_club, s.user_id)))
  ), ranked as (
    select pool.*, rank() over (order by pool.score desc) as r, count(*) over () as n from pool
  )
  select rk.r,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then rk.user_id end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.handle::text end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.display_name else 'Private runner' end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.avatar_path end,
         rk.score, rk.badges, rk.categories,
         (select c.tier from internal.user_challenges uc join public.challenges c on c.id = uc.challenge_id
           where uc.user_id = rk.user_id and uc.completed_at is not null and c.active
           order by array_position(array['platinum', 'gold', 'silver', 'bronze'], c.tier) limit 1),
         rk.user_id = v_viewer,
         not internal.can_see_achievements(rk.user_id, v_viewer),
         rk.n
    from ranked rk join public.profiles pr on pr.id = rk.user_id
   where rk.r <= least(greatest(p_limit, 1), 200) or rk.user_id = v_viewer
   order by rk.r, rk.user_id = v_viewer desc, pr.handle;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants (new RPCs only; everything else stays closed)
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema internal from public, anon, authenticated;
do $$
declare
  f text;
  rpc text[] := array['my_lost_cells', 'reclaim_cells', 'territory_cell_detail', 'my_territory_events', 'my_movement',
                      'my_movement_history', 'activity_movement', 'my_challenges', 'refresh_my_achievements',
                      'achievement_profile', 'achievement_leaderboard'];
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

-- Runs recorded before this release earn points once, from their stored evidence (where it still exists).
select internal.enqueue_job('territory', 'award_movement', jsonb_build_object('activity_id', a.id), 'movement:' || a.id::text, now())
  from public.activities a
 where a.status = 'processed' and a.deleted_at is null and a.raw_evidence_purged_at is null
   and not exists (select 1 from internal.movement_ledger l where l.activity_id = a.id and l.kind = 'run');

-- Existing runners are evaluated by the next maintenance runs.
insert into internal.achievement_dirty (user_id) select id from public.profiles where status = 'active' on conflict do nothing;
