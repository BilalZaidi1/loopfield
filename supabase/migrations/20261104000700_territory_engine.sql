-- Territory engine (server-authoritative). PostGIS validates polygons, computes geographic area,
-- removes the boundary-uncertainty band, applies exclusions and privacy masks and selects fully
-- contained cells. Control changes are transactional, deterministic, idempotent and serialized per
-- spatial partition (H3 parent cells at resolution 7) to stay safe under concurrent submissions.

create table internal.digest_items (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check (kind in ('territory_gained', 'territory_lost', 'title_won', 'title_lost', 'title_corrected', 'territory_corrected')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  digested_at timestamptz
);
create index digest_items_pending_idx on internal.digest_items (user_id) where digested_at is null;

create or replace function internal.config_bool(p_key text, p_default boolean default true) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select (value)::text::boolean from public.app_config where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------------------------
-- Cell cache
-- ---------------------------------------------------------------------------------------------
-- p_cells: [{"cell": "<int64 as text>", "res": 11, "parent": "<int64>", "ring": [[lng, lat], ...]}]
create or replace function internal.upsert_cells(p_cells jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, internal, extensions as $$
declare
  v_count integer;
begin
  insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7)
  select (c ->> 'cell')::bigint, (c ->> 'res')::smallint, g.geom, st_area(g.geom::geography), (c ->> 'parent')::bigint
    from jsonb_array_elements(p_cells) c
    cross join lateral (
      select st_setsrid(st_makepolygon(st_makeline(array_agg(st_makepoint((pt ->> 0)::float8, (pt ->> 1)::float8) order by ord))), 4326) as geom
        from jsonb_array_elements(c -> 'ring') with ordinality as r(pt, ord)
    ) g
  on conflict (cell) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function internal.ring_to_polygon(p_ring jsonb) returns extensions.geometry
language sql immutable set search_path = pg_catalog, extensions as $$
  -- p_ring: [[lng, lat], ...] without the closing point.
  select st_setsrid(st_makepolygon(st_addpoint(line, st_startpoint(line))), 4326)
    from (select st_makeline(array_agg(st_makepoint((pt ->> 0)::float8, (pt ->> 1)::float8) order by ord)) as line
            from jsonb_array_elements(p_ring) with ordinality as r(pt, ord)) s;
$$;

-- ---------------------------------------------------------------------------------------------
-- Claim geometry evaluation (PRD §6 Eligible land, §11 masks, §17 cell selection)
-- ---------------------------------------------------------------------------------------------
create or replace function internal.evaluate_claim_geometry(p_claim uuid, p_ring jsonb, p_candidate_cells bigint[])
returns public.loop_claims
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_claim public.loop_claims;
  v_season public.seasons;
  v_region public.regions;
  v_poly geometry;
  v_inner geometry;
  v_reasons text[] := '{}';
  v_status text;
  v_count integer := 0;
  v_area double precision := 0;
begin
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found then raise exception 'claim % not found', p_claim; end if;
  if v_claim.status not in ('processing') then return v_claim; end if; -- idempotent re-delivery

  select s.* into v_season from public.seasons s where s.id = v_claim.season_id;
  select r.* into v_region from public.regions r join public.competitions c on c.region_id = r.id where c.id = v_claim.competition_id;

  begin
    v_poly := internal.ring_to_polygon(p_ring);
  exception when others then
    v_poly := null;
  end;

  if v_poly is null or not st_isvalid(v_poly) or not st_issimple(st_exteriorring(v_poly)) then
    v_reasons := array_append(v_reasons, 'invalid_geometry');
  else
    if not internal.config_bool('territory_capture_enabled') then v_reasons := array_append(v_reasons, 'capture_suspended'); end if;
    if v_region.status <> 'active' then v_reasons := array_append(v_reasons, 'region_suspended'); end if;
    -- Fail closed: no reviewed exclusion set means eligibility is unknown (no land awarded).
    if v_region.exclusion_review_status <> 'reviewed' or v_season.exclusion_set_version is null then
      v_reasons := array_append(v_reasons, 'eligibility_data_unavailable');
    end if;
    if not st_coveredby(v_poly, v_region.geom::geometry) then v_reasons := array_append(v_reasons, 'outside_region'); end if;
    if st_area(v_poly::geography) > 25000000 then v_reasons := array_append(v_reasons, 'area_too_large'); end if;
    -- Privacy veto: any intersection of the loop or its interior withholds the whole shared claim.
    if exists (select 1 from public.protected_areas pa where pa.user_id = v_claim.user_id and st_intersects(pa.geom, v_poly::geography)) then
      v_reasons := array_append(v_reasons, 'privacy_mask');
    end if;
  end if;

  if array_length(v_reasons, 1) is null then
    v_inner := st_buffer(v_poly::geography, -v_season.boundary_band_m)::geometry;
    if v_inner is not null and not st_isempty(v_inner) then
      insert into internal.claim_cells (claim_id, cell)
      select p_claim, tc.cell
        from internal.territory_cells tc
       where tc.cell = any (p_candidate_cells)
         and tc.resolution = v_season.grid_resolution
         and st_coveredby(tc.geom, v_inner)
         and not exists (
           select 1 from public.exclusion_zones ez
            where ez.region_id = v_region.id and ez.active
              and (ez.set_version = v_season.exclusion_set_version or ez.kind = 'safety_override')
              and st_intersects(ez.geom, tc.geom::geography))
         -- cells already excluded by an audited safety override in this season stay unavailable
         and not exists (
           select 1 from internal.cell_control x
            where x.competition_id = v_claim.competition_id and x.season_id = v_claim.season_id and x.cell = tc.cell and x.status = 'excluded')
      on conflict do nothing;
      select count(*), coalesce(sum(tc.area_m2), 0) into v_count, v_area
        from internal.claim_cells cc join internal.territory_cells tc on tc.cell = cc.cell where cc.claim_id = p_claim;
    end if;
    if v_count < 1 then v_reasons := array_append(v_reasons, 'no_eligible_cells'); end if;
  end if;

  v_status := case
    when 'privacy_mask' = any (v_reasons) then 'withheld_privacy'
    when array_length(v_reasons, 1) is null then 'eligible'
    else 'unranked' end;

  if v_status <> 'eligible' then delete from internal.claim_cells where claim_id = p_claim; v_count := 0; v_area := 0; end if;

  update public.loop_claims
     set status = v_status,
         reasons = v_reasons,
         polygon = v_poly,
         raw_area_m2 = case when v_poly is null then null else st_area(v_poly::geography) end,
         eligible_area_m2 = v_area,
         eligible_cell_count = v_count,
         grid_resolution = v_season.grid_resolution,
         boundary_band_m = v_season.boundary_band_m,
         exclusion_set_version = v_season.exclusion_set_version,
         validated_at = now(),
         publish_after = greatest(coalesce(v_claim.completed_at, now()) + interval '30 minutes', now())
   where id = p_claim
  returning * into v_claim;
  return v_claim;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Partition locking: all writers lock the same partitions in ascending order (no deadlocks).
-- ---------------------------------------------------------------------------------------------
create or replace function internal.lock_partitions(p_competition uuid, p_season uuid, p_cells bigint[])
returns void language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v_key bigint;
begin
  for v_key in
    select distinct hashtextextended(p_competition::text || ':' || p_season::text || ':' || coalesce(tc.parent_r7, c.cell)::text, 0)
      from unnest(p_cells) as c(cell)
      left join internal.territory_cells tc on tc.cell = c.cell
     order by 1
  loop
    perform pg_advisory_xact_lock(v_key);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Apply an eligible claim: later verified completion wins each included cell; pace never matters.
-- ---------------------------------------------------------------------------------------------
create or replace function internal.apply_claim(p_claim uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_claim public.loop_claims;
  v_event uuid;
  v_cells bigint[];
  v_summary jsonb;
begin
  select * into v_claim from public.loop_claims where id = p_claim;
  if not found or v_claim.status <> 'eligible' then return null; end if;

  select id into v_event from internal.territory_events where claim_id = p_claim and kind = 'capture';
  if found then return v_event; end if; -- idempotent

  select array_agg(cell order by cell) into v_cells from internal.claim_cells where claim_id = p_claim;
  perform internal.lock_partitions(v_claim.competition_id, v_claim.season_id, v_cells);

  -- Re-check after acquiring locks (a concurrent invalidation may have run).
  select * into v_claim from public.loop_claims where id = p_claim;
  if v_claim.status <> 'eligible' then return null; end if;
  select id into v_event from internal.territory_events where claim_id = p_claim and kind = 'capture';
  if found then return v_event; end if;

  insert into internal.territory_events (competition_id, season_id, claim_id, kind, publish_after)
  values (v_claim.competition_id, v_claim.season_id, p_claim, 'capture', v_claim.publish_after)
  returning id into v_event;

  insert into internal.territory_event_cells (event_id, cell, prior_controller, new_controller, prior_claim, new_claim)
  select v_event, cc.cell, ctl.controller_id, v_claim.user_id, ctl.claim_id, p_claim
    from internal.claim_cells cc
    left join internal.cell_control ctl
      on ctl.competition_id = v_claim.competition_id and ctl.season_id = v_claim.season_id and ctl.cell = cc.cell
   where cc.claim_id = p_claim
     and (ctl.cell is null
       or (ctl.status = 'controlled' and (ctl.claim_completed_at, ctl.claim_id) < (v_claim.completed_at, p_claim)));

  insert into internal.cell_control (competition_id, season_id, cell, controller_id, claim_id, claim_completed_at, status)
  select v_claim.competition_id, v_claim.season_id, ec.cell, v_claim.user_id, p_claim, v_claim.completed_at, 'controlled'
    from internal.territory_event_cells ec where ec.event_id = v_event
  on conflict (competition_id, season_id, cell) do update
    set controller_id = excluded.controller_id, claim_id = excluded.claim_id,
        claim_completed_at = excluded.claim_completed_at, updated_at = now()
    where internal.cell_control.status = 'controlled'
      and (internal.cell_control.claim_completed_at, internal.cell_control.claim_id) < (excluded.claim_completed_at, excluded.claim_id);

  select jsonb_build_object(
      'gained_cells', count(*) filter (where prior_controller is distinct from new_controller),
      'refreshed_cells', count(*) filter (where prior_controller = new_controller),
      'unchanged_cells', coalesce(array_length(v_cells, 1), 0) - count(*),
      'gained_area_m2', coalesce(sum(tc.area_m2) filter (where prior_controller is distinct from new_controller), 0),
      'taken_from', coalesce((
        select jsonb_object_agg(prior_controller::text, jsonb_build_object('cells', n, 'area_m2', a))
          from (select e2.prior_controller, count(*) as n, sum(t2.area_m2) as a
                  from internal.territory_event_cells e2 join internal.territory_cells t2 on t2.cell = e2.cell
                 where e2.event_id = v_event and e2.prior_controller is not null and e2.prior_controller <> v_claim.user_id
                 group by e2.prior_controller) s), '{}'::jsonb))
    into v_summary
    from internal.territory_event_cells ec join internal.territory_cells tc on tc.cell = ec.cell
   where ec.event_id = v_event;

  update internal.territory_events set summary = v_summary where id = v_event;
  return v_event;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Recompute a set of cells from remaining eligible claims (invalidation, deletion, appeals).
-- Each affected cell reverts to the latest remaining eligible claim or becomes unowned.
-- ---------------------------------------------------------------------------------------------
create or replace function internal.recompute_cells(p_competition uuid, p_season uuid, p_cells bigint[], p_kind text, p_reason text, p_actor uuid default null, p_claim uuid default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_event uuid;
begin
  if p_cells is null or array_length(p_cells, 1) is null then return null; end if;
  perform internal.lock_partitions(p_competition, p_season, p_cells);

  insert into internal.territory_events (competition_id, season_id, claim_id, kind, actor_id, reason, publish_after)
  values (p_competition, p_season, p_claim, p_kind, p_actor, p_reason, now())
  returning id into v_event;

  with desired as (
    select c.cell, w.user_id, w.claim_id, w.completed_at
      from unnest(p_cells) as c(cell)
      left join lateral (
        select lc.user_id, lc.id as claim_id, lc.completed_at
          from internal.claim_cells cc join public.loop_claims lc on lc.id = cc.claim_id
         where cc.cell = c.cell and lc.competition_id = p_competition and lc.season_id = p_season and lc.status = 'eligible'
         order by lc.completed_at desc, lc.id desc
         limit 1
      ) w on true
  ), current as (
    select d.*, ctl.controller_id as cur_controller, ctl.claim_id as cur_claim, ctl.status as cur_status
      from desired d
      left join internal.cell_control ctl on ctl.competition_id = p_competition and ctl.season_id = p_season and ctl.cell = d.cell
  ), changed as (
    insert into internal.territory_event_cells (event_id, cell, prior_controller, new_controller, prior_claim, new_claim)
    select v_event, cell, cur_controller, user_id, cur_claim, claim_id
      from current
     where coalesce(cur_status, 'controlled') = 'controlled' and cur_claim is distinct from claim_id
    returning cell, new_controller, new_claim
  ), del as (
    delete from internal.cell_control ctl using changed ch
     where ctl.competition_id = p_competition and ctl.season_id = p_season and ctl.cell = ch.cell and ch.new_claim is null
    returning ctl.cell
  )
  insert into internal.cell_control (competition_id, season_id, cell, controller_id, claim_id, claim_completed_at, status)
  select p_competition, p_season, ch.cell, ch.new_controller, ch.new_claim, lc.completed_at, 'controlled'
    from changed ch join public.loop_claims lc on lc.id = ch.new_claim
  on conflict (competition_id, season_id, cell) do update
    set controller_id = excluded.controller_id, claim_id = excluded.claim_id, claim_completed_at = excluded.claim_completed_at, updated_at = now();

  update internal.territory_events e
     set summary = jsonb_build_object('changed_cells', (select count(*) from internal.territory_event_cells where event_id = v_event))
   where e.id = v_event;
  return v_event;
end $$;

-- Invalidate or withdraw one claim and recompute only its dependent cells (FR16).
create or replace function internal.invalidate_claim(p_claim uuid, p_status text, p_reason text, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_claim public.loop_claims;
  v_cells bigint[];
  v_event uuid;
begin
  if p_status not in ('invalid', 'withdrawn', 'unranked', 'pending_review') then raise exception 'bad status %', p_status; end if;
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found then return null; end if;
  select array_agg(cell order by cell) into v_cells from internal.claim_cells where claim_id = p_claim;
  update public.loop_claims
     set status = p_status, reasons = array_append(reasons, p_reason), invalidated_at = now(), invalidation_reason = p_reason
   where id = p_claim;
  if v_claim.season_id is not null and v_cells is not null then
    v_event := internal.recompute_cells(v_claim.competition_id, v_claim.season_id, v_cells,
      case when p_status = 'withdrawn' then 'withdrawal' else 'invalidation' end, p_reason, p_actor, p_claim);
  end if;
  perform internal.audit(p_actor, case when p_actor is null then 'system' else 'staff' end, 'claim_' || p_status, 'loop_claim', p_claim::text, jsonb_build_object('reason', p_reason));
  return v_event;
end $$;

-- Restore a previously invalidated claim (appeal overturned) and recompute its cells.
create or replace function internal.restore_claim(p_claim uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_claim public.loop_claims;
  v_cells bigint[];
begin
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found then return null; end if;
  select array_agg(cell order by cell) into v_cells from internal.claim_cells where claim_id = p_claim;
  if v_cells is null then return null; end if;
  update public.loop_claims set status = 'eligible', invalidated_at = null, invalidation_reason = null,
         reasons = array_append(reasons, 'appeal_overturned') where id = p_claim;
  perform internal.audit(p_actor, 'staff', 'claim_restored', 'loop_claim', p_claim::text, '{}');
  return internal.recompute_cells(v_claim.competition_id, v_claim.season_id, v_cells, 'correction', 'appeal_overturned', p_actor, p_claim);
end $$;

-- Full deterministic rebuild for one competition season (operators, tests; FR13).
create or replace function internal.replay_season(p_competition uuid, p_season uuid)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('replay:' || p_competition::text || ':' || p_season::text, 0));
  delete from internal.cell_control where competition_id = p_competition and season_id = p_season and status = 'controlled';
  insert into internal.cell_control (competition_id, season_id, cell, controller_id, claim_id, claim_completed_at, status)
  select distinct on (cc.cell) p_competition, p_season, cc.cell, lc.user_id, lc.id, lc.completed_at, 'controlled'
    from internal.claim_cells cc join public.loop_claims lc on lc.id = cc.claim_id
   where lc.competition_id = p_competition and lc.season_id = p_season and lc.status = 'eligible'
     and not exists (select 1 from internal.cell_control x where x.competition_id = p_competition and x.season_id = p_season and x.cell = cc.cell and x.status = 'excluded')
   order by cc.cell, lc.completed_at desc, lc.id desc;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Audited safety exclusion during an active season: cells become unavailable and are never
-- transferred to a rival (PRD §6, §17).
create or replace function internal.apply_exclusion(p_zone uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_zone public.exclusion_zones;
  v_season record;
  v_total integer := 0;
  v_cells bigint[];
  v_event uuid;
begin
  select * into v_zone from public.exclusion_zones where id = p_zone;
  if not found then raise exception 'zone not found'; end if;
  for v_season in
    select s.id as season_id, s.competition_id from public.seasons s join public.competitions c on c.id = s.competition_id
     where c.region_id = v_zone.region_id and s.status in ('active', 'settling')
  loop
    select array_agg(tc.cell order by tc.cell) into v_cells
      from internal.territory_cells tc
     where st_intersects(v_zone.geom, tc.geom::geography)
       and exists (select 1 from internal.claim_cells cc join public.loop_claims lc on lc.id = cc.claim_id
                    where cc.cell = tc.cell and lc.competition_id = v_season.competition_id and lc.season_id = v_season.season_id);
    if v_cells is null then continue; end if;
    perform internal.lock_partitions(v_season.competition_id, v_season.season_id, v_cells);
    insert into internal.territory_events (competition_id, season_id, kind, actor_id, reason, publish_after)
    values (v_season.competition_id, v_season.season_id, 'exclusion', p_actor, coalesce(v_zone.reason, 'safety exclusion'), now())
    returning id into v_event;
    insert into internal.territory_event_cells (event_id, cell, prior_controller, new_controller, prior_claim, new_claim)
    select v_event, c.cell, ctl.controller_id, null, ctl.claim_id, null
      from unnest(v_cells) c(cell)
      left join internal.cell_control ctl on ctl.competition_id = v_season.competition_id and ctl.season_id = v_season.season_id and ctl.cell = c.cell;
    insert into internal.cell_control (competition_id, season_id, cell, controller_id, claim_id, claim_completed_at, status)
    select v_season.competition_id, v_season.season_id, c.cell, null, null, null, 'excluded' from unnest(v_cells) c(cell)
    on conflict (competition_id, season_id, cell) do update set controller_id = null, claim_id = null, claim_completed_at = null, status = 'excluded', updated_at = now();
    v_total := v_total + array_length(v_cells, 1);
  end loop;
  perform internal.audit(p_actor, 'staff', 'exclusion_applied', 'exclusion_zone', p_zone::text, jsonb_build_object('cells', v_total));
  return v_total;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Publication: refresh the public snapshot for cells touched by due events (stable snapshot,
-- one digest per user per day instead of a cascade of notifications).
-- ---------------------------------------------------------------------------------------------
create or replace function internal.publish_due_territory(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_event internal.territory_events;
  v_count integer := 0;
begin
  if not internal.config_bool('public_publication_enabled') then return 0; end if;
  for v_event in
    select * from internal.territory_events where published_at is null and publish_after <= now()
     order by publish_after, created_at limit p_limit for update skip locked
  loop
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
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Exploration (private visited ground)
-- ---------------------------------------------------------------------------------------------
create or replace function internal.record_exploration(p_activity uuid, p_user uuid, p_cells bigint[], p_visited_at timestamptz)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_count integer;
begin
  insert into internal.exploration_sources (activity_id, user_id, cell, visited_at)
  select p_activity, p_user, c, p_visited_at from unnest(p_cells) c on conflict do nothing;
  insert into public.exploration_cells (user_id, cell, first_visited_at, last_visited_at, visits)
  select p_user, c, p_visited_at, p_visited_at, 1 from unnest(p_cells) c
  on conflict (user_id, cell) do update
    set first_visited_at = least(public.exploration_cells.first_visited_at, excluded.first_visited_at),
        last_visited_at = greatest(public.exploration_cells.last_visited_at, excluded.last_visited_at),
        visits = (select count(*) from internal.exploration_sources s where s.user_id = p_user and s.cell = excluded.cell);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Deleting a source activity updates derived exploration consistently (FR19).
create or replace function internal.remove_exploration(p_activity uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid;
  v_cells bigint[];
begin
  select user_id, array_agg(cell) into v_user, v_cells from internal.exploration_sources where activity_id = p_activity group by user_id;
  if v_user is null then return; end if;
  delete from internal.exploration_sources where activity_id = p_activity;
  delete from public.exploration_cells e
   where e.user_id = v_user and e.cell = any (v_cells)
     and not exists (select 1 from internal.exploration_sources s where s.user_id = v_user and s.cell = e.cell);
  update public.exploration_cells e
     set first_visited_at = s.first_v, last_visited_at = s.last_v, visits = s.n
    from (select cell, min(visited_at) first_v, max(visited_at) last_v, count(*) n
            from internal.exploration_sources where user_id = v_user and cell = any (v_cells) group by cell) s
   where e.user_id = v_user and e.cell = s.cell;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------------------------
create or replace function internal.maintain_seasons()
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_comp record;
  v_last public.seasons;
  v_region public.regions;
begin
  update public.seasons set status = 'active' where status = 'scheduled' and starts_at <= now() and ends_at > now();
  update public.seasons set status = 'settling' where status = 'active' and ends_at <= now();
  update public.seasons set status = 'settled', settled_at = now()
   where status = 'settling' and ends_at + interval '24 hours' <= now()
     and not exists (select 1 from public.integrity_cases ic where ic.status <> 'resolved' and ic.hold_from_competition
                       and ic.object_id in (select id from public.loop_claims where season_id = seasons.id
                                            union select id from public.speed_attempts where season_id = seasons.id));
  for v_comp in select * from public.competitions where status = 'active' loop
    select * into v_last from public.seasons where competition_id = v_comp.id order by number desc limit 1;
    select * into v_region from public.regions where id = v_comp.region_id;
    if v_last.id is null or v_last.ends_at <= now() + interval '3 days' then
      insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                                  territory_rules_version, speed_rules_version, exclusion_set_version)
      values (v_comp.id, coalesce(v_last.number, 0) + 1,
              coalesce(v_last.ends_at, date_trunc('day', now())),
              coalesce(v_last.ends_at, date_trunc('day', now())) + interval '28 days',
              case when coalesce(v_last.ends_at, now()) <= now() then 'active' else 'scheduled' end,
              coalesce(v_last.grid_resolution, 11), coalesce(v_last.boundary_band_m, 10),
              coalesce(v_last.territory_rules_version, 'territory-2026.11.0-proposed'),
              coalesce(v_last.speed_rules_version, 'speed-2026.11.0-proposed'),
              case when v_region.exclusion_review_status = 'reviewed' then v_region.exclusion_set_version else null end)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Client RPCs (published data only; bounded viewport queries; no raw traces, starts or times)
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_access_competition(p_competition uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select exists (select 1 from public.competitions c where c.id = p_competition and c.status <> 'archived'
                 and (c.kind = 'public' or authz.is_active_member(c.club_id, auth.uid())));
$$;

create or replace function public.current_season(p_competition uuid)
returns table (id uuid, number integer, starts_at timestamptz, ends_at timestamptz, status text, timezone text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id, s.number, s.starts_at, s.ends_at, s.status, r.timezone
    from public.seasons s join public.competitions c on c.id = s.competition_id join public.regions r on r.id = c.region_id
   where s.competition_id = p_competition and public.can_access_competition(p_competition)
     and s.starts_at <= now() and s.ends_at > now()
   limit 1;
$$;

create or replace function public.territory_viewport(p_competition uuid, p_season uuid, p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision, p_limit integer default 6000)
returns table (cell text, status text, controller_id uuid, controller_handle text, controller_name text, is_me boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_env geometry := st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
begin
  if auth.uid() is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  if (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat) > 0.06 then raise exception 'zoom_in' using errcode = 'P0413'; end if;
  return query
  select p.cell::text, p.status, p.controller_id, pr.handle::text, pr.display_name,
         p.controller_id = auth.uid()
    from internal.cell_control_public p
    join internal.territory_cells tc on tc.cell = p.cell
    left join public.profiles pr on pr.id = p.controller_id
   where p.competition_id = p_competition and p.season_id = p_season and tc.geom && v_env
     -- blocked users' identities are suppressed (FR22); their land remains visible as "a runner"
   limit least(p_limit, 8000);
end $$;

-- Identity suppression for blocks is applied on top of the viewport result.
create or replace function public.territory_viewport_safe(p_competition uuid, p_season uuid, p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision)
returns table (cell text, status text, controller_key text, controller_handle text, controller_name text, is_me boolean)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select v.cell, v.status,
         case when v.controller_id is null then null when authz.is_blocked(v.controller_id, auth.uid()) then 'hidden' else md5(v.controller_id::text) end,
         case when v.controller_id is null or authz.is_blocked(v.controller_id, auth.uid()) then null else v.controller_handle end,
         case when v.controller_id is null then null when authz.is_blocked(v.controller_id, auth.uid()) then 'A runner' else v.controller_name end,
         coalesce(v.is_me, false)
    from public.territory_viewport(p_competition, p_season, p_min_lng, p_min_lat, p_max_lng, p_max_lat) v;
$$;

create or replace function public.exclusions_viewport(p_region uuid, p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision)
returns table (id uuid, geojson jsonb)
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select ez.id, st_asgeojson(ez.geom, 6)::jsonb
    from public.exclusion_zones ez
   where auth.uid() is not null and ez.region_id = p_region and ez.active
     and st_intersects(ez.geom, st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
   limit 500;
$$;

create or replace function public.territory_leaderboard(p_competition uuid, p_season uuid, p_district uuid default null, p_limit integer default 50)
returns table (rank bigint, user_id uuid, handle text, display_name text, area_m2 double precision, is_me boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
begin
  if auth.uid() is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with areas as (
    select p.controller_id as uid,
           sum(case when p_district is null then tc.area_m2
                    else st_area(st_intersection(tc.geom, d.geom::geometry)::geography) end) as area
      from internal.cell_control_public p
      join internal.territory_cells tc on tc.cell = p.cell
      left join public.districts d on d.id = p_district
     where p.competition_id = p_competition and p.season_id = p_season and p.status = 'controlled' and p.controller_id is not null
       and (p_district is null or st_intersects(tc.geom, d.geom::geometry))
     group by p.controller_id
  ), ranked as (
    select rank() over (order by round(a.area::numeric, 1) desc) as r, a.uid, a.area from areas a where a.area > 0
  )
  select r.r, case when authz.is_blocked(r.uid, auth.uid()) then null else r.uid end,
         case when authz.is_blocked(r.uid, auth.uid()) then null else pr.handle::text end,
         case when authz.is_blocked(r.uid, auth.uid()) then 'A runner' else pr.display_name end,
         round(r.area::numeric, 1)::double precision, r.uid = auth.uid()
    from ranked r join public.profiles pr on pr.id = r.uid
   where r.r <= p_limit or r.uid = auth.uid()
   order by r.r, pr.handle;
end $$;

create or replace function public.territory_cell_detail(p_competition uuid, p_season uuid, p_cell text)
returns table (cell text, status text, controller_handle text, controller_name text, is_me boolean, controlled_since date, claim_cells integer, my_claim_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
begin
  if auth.uid() is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select p.cell::text, p.status,
         case when authz.is_blocked(p.controller_id, auth.uid()) then null else pr.handle::text end,
         case when p.controller_id is null then null when authz.is_blocked(p.controller_id, auth.uid()) then 'A runner' else pr.display_name end,
         p.controller_id = auth.uid(),
         -- Date only: precise completion times are never disclosed (PRD §11).
         (p.published_at at time zone 'UTC')::date,
         (select count(*)::integer from internal.claim_cells cc where cc.claim_id = p.claim_id),
         case when p.controller_id = auth.uid() then p.claim_id else null end
    from internal.cell_control_public p left join public.profiles pr on pr.id = p.controller_id
   where p.competition_id = p_competition and p.season_id = p_season and p.cell = p_cell::bigint;
end $$;

-- My land changes: published events affecting me plus my own provisional (unpublished) gains.
create or replace function public.my_territory_events(p_limit integer default 30)
returns table (event_id uuid, kind text, competition_id uuid, season_id uuid, direction text, cells integer, area_m2 double precision, provisional boolean, reason text, occurred_on date)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with mine as (
    select e.id, e.kind, e.competition_id, e.season_id, e.reason, e.published_at, e.created_at,
           case when ec.new_controller = auth.uid() then 'gained' else 'lost' end as direction,
           count(*)::integer as cells, sum(tc.area_m2) as area
      from internal.territory_events e
      join internal.territory_event_cells ec on ec.event_id = e.id
      join internal.territory_cells tc on tc.cell = ec.cell
     where (ec.new_controller = auth.uid() or ec.prior_controller = auth.uid())
       and ec.prior_controller is distinct from ec.new_controller
       and (e.published_at is not null or ec.new_controller = auth.uid())
     group by e.id, direction
  )
  select id, kind, competition_id, season_id, direction, cells, round(area::numeric, 1)::double precision,
         published_at is null, reason, (coalesce(published_at, created_at) at time zone 'UTC')::date
    from mine order by coalesce(published_at, created_at) desc limit least(p_limit, 100);
$$;

create or replace function public.my_territory_summary(p_competition uuid, p_season uuid)
returns table (published_area_m2 double precision, published_cells integer, provisional_cells integer)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce((select sum(tc.area_m2) from internal.cell_control_public p join internal.territory_cells tc on tc.cell = p.cell
                    where p.competition_id = p_competition and p.season_id = p_season and p.controller_id = auth.uid()), 0),
         (select count(*)::integer from internal.cell_control_public p where p.competition_id = p_competition and p.season_id = p_season and p.controller_id = auth.uid()),
         (select count(*)::integer from internal.cell_control c where c.competition_id = p_competition and c.season_id = p_season and c.controller_id = auth.uid()
            and not exists (select 1 from internal.cell_control_public p where p.competition_id = c.competition_id and p.season_id = c.season_id and p.cell = c.cell and p.controller_id = auth.uid()));
$$;

-- Cells of one of my own claims (private), for the activity detail and result explanation.
create or replace function public.my_claim_cells(p_claim uuid)
returns table (cell text)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select cc.cell::text from internal.claim_cells cc join public.loop_claims lc on lc.id = cc.claim_id
   where cc.claim_id = p_claim and lc.user_id = auth.uid();
$$;

create or replace function public.season_history(p_competition uuid)
returns table (season_id uuid, number integer, starts_at timestamptz, ends_at timestamptz, status text, my_area_m2 double precision, my_rank bigint, participants bigint)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with s as (select * from public.seasons where competition_id = p_competition and public.can_access_competition(p_competition) and starts_at <= now()),
  areas as (
    select p.season_id, p.controller_id, sum(tc.area_m2) area
      from internal.cell_control_public p join internal.territory_cells tc on tc.cell = p.cell
     where p.competition_id = p_competition and p.controller_id is not null group by p.season_id, p.controller_id
  ), ranked as (select season_id, controller_id, area, rank() over (partition by season_id order by round(area::numeric, 1) desc) r from areas)
  select s.id, s.number, s.starts_at, s.ends_at, s.status,
         (select round(area::numeric, 1)::double precision from ranked where season_id = s.id and controller_id = auth.uid()),
         (select r from ranked where season_id = s.id and controller_id = auth.uid()),
         (select count(*) from ranked where season_id = s.id)
    from s order by s.number desc;
$$;
