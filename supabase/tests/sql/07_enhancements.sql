-- 11 Nov enhancement release: movement integrity trail, appeals and reviewer clearing; the all-time map,
-- season races and events (derived claims, cascades, standings, settlement, season dates).
begin;
select plan(53);

insert into auth.users (id, email) values
  ('a7100000-0000-4000-8000-000000000001', 'rider@example.test'),
  ('a7200000-0000-4000-8000-000000000002', 'other@example.test'),
  ('a7300000-0000-4000-8000-000000000003', 'reviewer@example.test'),
  ('a7400000-0000-4000-8000-000000000004', 'operator@example.test'),
  ('a7500000-0000-4000-8000-000000000005', 'organizer@example.test');
insert into public.staff_roles (user_id, role) values
  ('a7300000-0000-4000-8000-000000000003', 'integrity_reviewer'),
  ('a7400000-0000-4000-8000-000000000004', 'territory_operator');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table ids as select 'a7000000-0000-4000-8000-0000000000aa'::uuid act;
grant select on ids to authenticated;
insert into public.activities (id, user_id, started_at, ended_at, status)
values ((select act from ids), 'a7100000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '90 minutes', 'processed');
-- The run earned points for its honest part (2.1 km); 3 km were left out as vehicle-like.
select internal.award_movement_points((select act from ids), 2100, 'movement-test', array['implausible_speed']);

-- Movement integrity ----------------------------------------------------------------------
select internal.flag_activity((select act from ids), array['implausible_speed', 'suspicious_speed'], '{"excluded_m": 3000, "rule_version": "integrity-test"}');
select is((select integrity_flags from public.activities where id = (select act from ids)), array['implausible_speed', 'suspicious_speed'], 'the run carries the server''s reasons');
select is((select count(*)::int from public.integrity_cases where kind = 'activity' and object_id = (select act from ids)), 1, 'one case on the review trail');
select is((select signals ->> 'rule_version' from public.integrity_cases where object_id = (select act from ids)), 'integrity-test', 'the case records which rules found it');
select internal.flag_activity((select act from ids), array['implausible_speed'], '{"excluded_m": 3000}');
select is((select count(*)::int from public.integrity_cases where kind = 'activity' and object_id = (select act from ids)), 1, 're-evaluating never opens a second case');

-- Appeals -----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select throws_ok($$select public.submit_appeal('activity', (select act from ids), 'This is not my run but I want it reviewed')$$, '42501', null, 'only the runner can ask for a review of their run');
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select lives_ok($$select public.submit_appeal('activity', (select act from ids), 'GPS jumped along the motorway near my route')$$, 'the runner asks for a review');
reset role;
select is((select count(*)::int from public.integrity_cases where object_id = (select act from ids) and opened_by = 'appeal'), 1, 'the appeal opens a case for a reviewer');

-- Reviewer clears a GPS error ----------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_resolve_integrity((select id from public.integrity_cases where object_id = (select act from ids) and opened_by = 'appeal'), 'overturned', 'cleared')$$, null, null, 'runners cannot resolve cases');
select pg_temp.as_user('a7300000-0000-4000-8000-000000000003');
select lives_ok($$select public.ops_resolve_integrity((select id from public.integrity_cases where object_id = (select act from ids) and opened_by = 'appeal'), 'overturned', 'GPS multipath near flyover')$$, 'a reviewer overturns');
reset role;
select is((select integrity_flags from public.activities where id = (select act from ids)), '{}'::text[], 'flags are cleared');
select is((select coalesce(sum(amount), 0)::int from internal.movement_ledger where activity_id = (select act from ids)), 21 + 30, 'the left-out 3 km are credited back');
select is((select status from public.appeals where object_id = (select act from ids)), 'overturned', 'the appeal shows the outcome');
select internal.flag_activity((select act from ids), array['implausible_speed'], '{"excluded_m": 3000}');
select is((select integrity_flags from public.activities where id = (select act from ids)), '{}'::text[], 'a cleared run is never flagged again');


-- =============================================================================================
-- All-time map, season races and events
-- =============================================================================================
create temp table g as select 0.0009::float8 as dlat, 0.001::float8 as dlng, 67.05::float8 as lng0, 24.90::float8 as lat0;
insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7)
select 300000 + i * 100 + j, 11,
       extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326),
       extensions.st_area(extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326)::extensions.geography),
       9000 + (i / 10) * 10 + (j / 10)
  from g, generate_series(0, 9) i, generate_series(0, 9) j;
create function pg_temp.ring(i0 int, i1 int, j0 int, j1 int) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + (i1 + 1) * dlat + 0.00018),
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + (i1 + 1) * dlat + 0.00018)) from g;
$$;
create function pg_temp.cells() returns bigint[] language sql as $$ select array_agg(cell) from internal.territory_cells where cell between 300000 and 301000 $$;
-- A race run (primary claim) and its derived layers, evaluated the way the job does it.
create function pg_temp.run(p_user uuid, p_started timestamptz) returns uuid language plpgsql as $$
declare v_act uuid := gen_random_uuid(); v_claim uuid;
begin
  insert into public.activities (id, user_id, started_at, ended_at, status, competition_id, season_id)
  values (v_act, p_user, p_started, p_started + interval '30 minutes', 'processing', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041');
  insert into public.loop_claims (activity_id, user_id, competition_id, season_id, rule_version, received_at)
  values (v_act, p_user, '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 'territory-test', now()) returning id into v_claim;
  return v_claim;
end $$;
create function pg_temp.evaluate(p_primary uuid, p_ring jsonb) returns void language plpgsql as $$
declare r record;
begin
  for r in select id from public.loop_claims where (id = p_primary or parent_claim_id = p_primary) and status = 'processing' loop
    update public.loop_claims set completed_at = (select a.ended_at from public.activities a join public.loop_claims p on p.activity_id = a.id where p.id = p_primary)
     where id = r.id;
    if (internal.evaluate_claim_geometry(r.id, p_ring, pg_temp.cells())).status = 'eligible' then perform internal.apply_claim(r.id); end if;
  end loop;
end $$;
create function pg_temp.held(p_comp uuid, p_user uuid) returns int language sql as $$
  select count(*)::int from internal.cell_control where competition_id = p_comp and controller_id = p_user and status = 'controlled';
$$;
create temp table lay as select
  '00000000-0000-4000-8000-000000000031'::uuid race,
  (select id from public.competitions where kind = 'permanent' and region_id = '00000000-0000-4000-8000-000000000001') map,
  null::uuid ev, null::uuid dist, null::uuid club, null::uuid challenge, null::uuid a, null::uuid b;
grant select, update on lay to authenticated;
update public.user_settings set territory_competition_enabled = true where user_id = 'a7200000-0000-4000-8000-000000000002';

-- The layer that never resets
select is((select count(*)::int from public.seasons s where s.competition_id = (select map from lay) and s.ends_at > now() + interval '1000 years'), 1,
          'the region has an all-time map whose one season never ends');
set local role authenticated;
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select ok(public.can_access_competition((select map from lay)), 'every signed-in runner can see the all-time map');

-- Events are created by operators (or club organisers) and joined for free
select throws_ok($$select public.ops_create_event('Weekend Territory Challenge', null, 'territory', 'individual', '00000000-0000-4000-8000-000000000001', now() - interval '3 hours', now() + interval '2 days')$$,
                 '42501', null, 'runners cannot create events');
select pg_temp.as_user('a7400000-0000-4000-8000-000000000004');
select lives_ok($$update lay set ev = public.ops_create_event('Weekend Territory Challenge', 'Most land by Sunday', 'territory', 'individual',
                   '00000000-0000-4000-8000-000000000001', now() - interval '3 hours', now() + interval '2 days')$$, 'an operator creates a territory event');
reset role;
select is((select status || ':' || coalesce(exclusion_set_version, '-') from public.seasons where competition_id = (select ev from lay)), 'active:dev-exclusions-1',
          'the event has one season (its window) with the region''s rules frozen for it');
set local role authenticated;
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select throws_ok($$select public.join_event((select ev from lay))$$, '42501', null, 'joining a territory event needs territory consent');
reset role;
update public.user_settings set territory_competition_enabled = true where user_id = 'a7100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select lives_ok($$select public.join_event((select ev from lay))$$, 'the runner joins');
reset role;
update public.event_participants set joined_at = now() - interval '4 hours' where competition_id = (select ev from lay);

-- One run counts in each layer it belongs to
update lay set a = pg_temp.run('a7100000-0000-4000-8000-000000000001', now() - interval '2 hours'),
               b = pg_temp.run('a7200000-0000-4000-8000-000000000002', now() - interval '90 minutes');
select is(internal.derive_layer_claims((select a from lay)), 2, 'a joined runner''s race run is carried into the all-time map and the event');
select is(internal.derive_layer_claims((select b from lay)), 1, 'a runner outside the event only reaches the all-time map');
select is(internal.derive_layer_claims((select a from lay)), 0, 'deriving again adds nothing');
select pg_temp.evaluate((select a from lay), pg_temp.ring(0, 4, 0, 4));
select pg_temp.evaluate((select b from lay), pg_temp.ring(3, 6, 0, 4));
select is(array[pg_temp.held((select race from lay), 'a7100000-0000-4000-8000-000000000001'),
                pg_temp.held((select map from lay), 'a7100000-0000-4000-8000-000000000001'),
                pg_temp.held((select ev from lay), 'a7100000-0000-4000-8000-000000000001')], array[15, 15, 25],
          'the later loop takes the overlap in the race and on the map, but cannot touch an event it is not in');
select is(pg_temp.held((select ev from lay), 'a7200000-0000-4000-8000-000000000002'), 0, 'the other runner has no land in the event');

-- Publication announces land once per run (from the map), and standings follow each layer
select ok(internal.publish_due_territory(500) >= 5, 'every layer is published');
select is((select array_agg(distinct (payload ->> 'competition_id')) from internal.digest_items where user_id in ('a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000002')),
          array[(select map from lay)::text], 'land notifications come only from the all-time map (no duplicates for the race or the event)');
set local role authenticated;
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select is((select rank || ':' || entrant_kind from public.event_standings((select ev from lay)) where is_me), '1:runner', 'the runner leads the event standings');
select is((select count(*)::int from public.my_territory_events(50) where competition_id in ((select race from lay), (select ev from lay))), 0,
          'my land changes list the all-time map, not one line per layer');
select is((select jsonb_agg(l ->> 'kind' order by l ->> 'kind') from jsonb_array_elements(public.activity_detail((select activity_id from public.loop_claims where id = (select a from lay))) -> 'layers') l),
          '["event", "permanent", "public"]'::jsonb, 'the run''s detail shows what the loop did in each layer');
reset role;

-- A shared card's land comes from the all-time map: what changed hands, and from how many runners
select is((select (l ->> 'layer') || ':' || (l ->> 'taken_cells') || ':' || (l ->> 'rivals') || ':' || jsonb_array_length(l -> 'cells')
             from internal.share_land((select activity_id from public.loop_claims where id = (select b from lay))) l), 'permanent:10:1:20',
          'a card shows the run''s map land: 20 cells, 10 taken from 1 runner');

-- A decision on the race claim carries to the run's other layers
select internal.invalidate_claim((select a from lay), 'invalid', 'staff_invalidated', 'a7300000-0000-4000-8000-000000000003');
select is((select array_agg(status order by competition_id) from public.loop_claims where parent_claim_id = (select a from lay)), array['invalid', 'invalid'],
          'invalidating the race claim invalidates its map and event claims');
select is(array[pg_temp.held((select map from lay), 'a7100000-0000-4000-8000-000000000001'), pg_temp.held((select ev from lay), 'a7100000-0000-4000-8000-000000000001')], array[0, 0],
          'and their land is recomputed');
select internal.restore_claim((select a from lay), 'a7300000-0000-4000-8000-000000000003');
select is(array[pg_temp.held((select map from lay), 'a7100000-0000-4000-8000-000000000001'), pg_temp.held((select ev from lay), 'a7100000-0000-4000-8000-000000000001')], array[15, 25],
          'restoring it restores every layer');

-- Leaving an event withdraws only the event land
set local role authenticated;
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select public.leave_event((select ev from lay));
reset role;
select is(array[pg_temp.held((select map from lay), 'a7100000-0000-4000-8000-000000000001'), pg_temp.held((select ev from lay), 'a7100000-0000-4000-8000-000000000001')], array[15, 0],
          'leaving the event withdraws its event land and never touches the all-time map');

-- Points never buy land in an event
select throws_ok($$insert into public.loop_claims (user_id, competition_id, season_id, status, rule_version, received_at, source, points_spent, reclaim_request_id, undone_claim_id, basis_claim_id)
                   values ('a7200000-0000-4000-8000-000000000002', (select ev from lay), (select id from public.seasons where competition_id = (select ev from lay)), 'eligible', 'x', now(), 'reclaim', 5,
                           gen_random_uuid(), (select a from lay), (select a from lay))$$, '42501', null, 'reclaiming with points is refused in events');

-- A held-at-evaluation run is evaluated again when a reviewer clears it
update lay set a = pg_temp.run('a7100000-0000-4000-8000-000000000001', now() - interval '50 minutes');
select internal.derive_layer_claims((select a from lay));
update public.loop_claims set status = 'pending_review', reasons = '{no_running_steps}', validated_at = now() where id = (select a from lay) or parent_claim_id = (select a from lay);
select internal.restore_claim((select a from lay), 'a7300000-0000-4000-8000-000000000003');
select is((select array_agg(distinct status) from public.loop_claims where id = (select a from lay) or parent_claim_id = (select a from lay)), array['processing'],
          'the held run and its layers go back to evaluation');
select is((select payload ->> 'reviewed' from internal.jobs where kind = 'evaluate_loop' and payload ->> 'claim_id' = (select a from lay)::text), 'true',
          'the evaluation runs without the movement signals the reviewer cleared');

-- Distance events count verified distance after joining
set local role authenticated;
select pg_temp.as_user('a7400000-0000-4000-8000-000000000004');
select lives_ok($$update lay set dist = public.ops_create_event('Monthly Distance', null, 'distance', 'individual', null, now() - interval '1 day', now() + interval '20 days', 100000)$$,
                'an operator creates a worldwide distance event');
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select public.join_event((select dist from lay));
reset role;
update public.event_participants set joined_at = now() - interval '1 day' where competition_id = (select dist from lay);
insert into public.activities (id, user_id, started_at, ended_at, status)
values ('a7000000-0000-4000-8000-0000000000bb', 'a7200000-0000-4000-8000-000000000002', now() - interval '5 hours', now() - interval '4 hours', 'processed');
select internal.award_movement_points('a7000000-0000-4000-8000-0000000000bb', 5400, 'movement-test', '{}');
set local role authenticated;
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select is((select value from public.event_standings((select dist from lay)) where is_me), 5400::double precision, 'distance standings are server-verified distance');
reset role;

-- Club challenges are for members, who hear about them
insert into public.clubs (id, kind, name, visibility, join_policy, created_by)
values ('a7c00000-0000-4000-8000-0000000000c1', 'club', 'Harbour Striders', 'private', 'request', 'a7500000-0000-4000-8000-000000000005');
insert into public.club_memberships (club_id, user_id, role, state) values
  ('a7c00000-0000-4000-8000-0000000000c1', 'a7500000-0000-4000-8000-000000000005', 'owner', 'active'),
  ('a7c00000-0000-4000-8000-0000000000c1', 'a7200000-0000-4000-8000-000000000002', 'member', 'active');
set local role authenticated;
select pg_temp.as_user('a7500000-0000-4000-8000-000000000005');
select lives_ok($$update lay set challenge = public.create_club_event('a7c00000-0000-4000-8000-0000000000c1', 'November 100 km', null, 'distance', now(), now() + interval '19 days', 100000)$$,
                'an organiser creates a club challenge');
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_events('current') where id = (select challenge from lay)), 0, 'non-members do not see club challenges');
select throws_ok($$select public.join_event((select challenge from lay))$$, '42501', null, 'and cannot join them');
reset role;
select is((select count(*)::int from public.notifications where user_id = 'a7200000-0000-4000-8000-000000000002' and kind = 'club_challenge'), 1, 'members are told about the new challenge');

-- Events settle into final standings and are archived
update public.seasons set status = 'settled', settled_at = now() where competition_id = (select dist from lay);
select is(internal.finish_events() >= 1, true, 'a settled event is finished');
select is((select status from public.competitions where id = (select dist from lay)), 'archived', 'and archived');
select is((select (data ->> 'rank')::int from public.notifications where user_id = 'a7200000-0000-4000-8000-000000000002' and kind = 'event_finished'), 1,
          'its runners are told their final place');
set local role authenticated;
select pg_temp.as_user('a7200000-0000-4000-8000-000000000002');
select is((select value from public.event_standings((select dist from lay)) where is_me), 5400::double precision, 'final standings stay readable after the event');
reset role;

-- Seasons: dates set by operators; the all-time map never rolls
set local role authenticated;
select pg_temp.as_user('a7400000-0000-4000-8000-000000000004');
select lives_ok($$select public.ops_schedule_season('00000000-0000-4000-8000-000000000031',
                   (select ends_at from public.seasons where id = '00000000-0000-4000-8000-000000000041'),
                   (select ends_at from public.seasons where id = '00000000-0000-4000-8000-000000000041') + interval '14 days')$$, 'an operator schedules the next race season');
select lives_ok($$select public.ops_set_season_dates('00000000-0000-4000-8000-000000000041',
                   (select starts_at from public.seasons where id = '00000000-0000-4000-8000-000000000041'),
                   (select ends_at from public.seasons where id = '00000000-0000-4000-8000-000000000041') + interval '3 days')$$, 'and extends the current one');
reset role;
select is((select s2.starts_at = s1.ends_at and s2.ends_at - s2.starts_at = interval '14 days'
             from public.seasons s1 join public.seasons s2 on s2.competition_id = s1.competition_id and s2.number = s1.number + 1
            where s1.id = '00000000-0000-4000-8000-000000000041'), true, 'the next season moves with it (no gap, no overlap, same length)');
select internal.maintain_seasons();
select is((select count(*)::int from public.seasons where competition_id = (select map from lay)), 1, 'season upkeep never rolls the all-time map');
select is((select count(*)::int from public.seasons where competition_id = '00000000-0000-4000-8000-000000000031'), 2, 'nor adds a race season while one is scheduled');

select * from finish();
rollback;
