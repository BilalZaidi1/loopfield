-- Territory engine: geometry evaluation, partial takeover, completion ordering, invalidation,
-- replay determinism, privacy veto, exclusions, fail-closed eligibility, publication and ranking.
-- Uses a synthetic 100 m square grid (cell ids are arbitrary; H3 is supplied by the worker in production).
begin;
select plan(26);

create temp table g as select 0.0009::float8 as dlat, 0.001::float8 as dlng, 67.0::float8 as lng0, 24.86::float8 as lat0;

-- 20 x 20 grid of ~100 m cells in the development region.
insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7)
select 100000 + i * 100 + j, 11,
       extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326),
       extensions.st_area(extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326)::extensions.geography),
       7000 + (i / 10) * 10 + (j / 10)
  from g, generate_series(0, 19) i, generate_series(0, 19) j;

create temp table ids as select '00000000-0000-4000-8000-000000000031'::uuid comp, '00000000-0000-4000-8000-000000000041'::uuid season;

-- Rectangle ring around cells [i0..i1] x [j0..j1] with a 20 m margin (beyond the 10 m band).
create function pg_temp.ring(i0 int, i1 int, j0 int, j1 int) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + (i1 + 1) * dlat + 0.00018),
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + (i1 + 1) * dlat + 0.00018)) from g;
$$;
create function pg_temp.all_cells() returns bigint[] language sql as $$ select array_agg(cell) from internal.territory_cells where cell between 100000 and 102000 $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ali@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'sara@example.test'),
  ('cccccccc-0000-4000-8000-000000000003', 'omar@example.test');

create function pg_temp.new_claim(p_user uuid, p_completed timestamptz) returns uuid language plpgsql as $$
declare v_act uuid := gen_random_uuid(); v_claim uuid;
begin
  insert into public.activities (id, user_id, started_at, ended_at, status, competition_id, season_id)
  values (v_act, p_user, p_completed - interval '40 minutes', p_completed, 'processing', (select comp from ids), (select season from ids));
  insert into public.loop_claims (activity_id, user_id, competition_id, season_id, rule_version, completed_at, received_at)
  values (v_act, p_user, (select comp from ids), (select season from ids), 'territory-test', p_completed, now()) returning id into v_claim;
  return v_claim;
end $$;

create temp table c as select
  pg_temp.new_claim('aaaaaaaa-0000-4000-8000-000000000001', now() - interval '3 hours') as a,
  pg_temp.new_claim('bbbbbbbb-0000-4000-8000-000000000002', now() - interval '2 hours') as b;

-- A: 10 x 10 cells. B (later completion): overlaps 2 rows x 5 cols of A plus 10 new cells.
select is((select status from internal.evaluate_claim_geometry((select a from c), pg_temp.ring(0, 9, 0, 9), pg_temp.all_cells())), 'eligible', 'A loop is eligible');
select is((select eligible_cell_count from public.loop_claims where id = (select a from c)), 100, 'A frozen cell set has exactly the 100 fully contained cells');
select is((select status from internal.evaluate_claim_geometry((select b from c), pg_temp.ring(8, 11, 5, 9), pg_temp.all_cells())), 'eligible', 'B loop is eligible');
select is((select eligible_cell_count from public.loop_claims where id = (select b from c)), 20, 'B frozen cell set has 20 cells');
select ok((select abs(raw_area_m2 - eligible_area_m2) > 0 from public.loop_claims where id = (select a from c)), 'displayed claim area is the awarded cell area, not the raw polygon');

-- Arrival order: B (later completion) is applied first, A arrives later within the window.
select isnt(internal.apply_claim((select b from c)), null, 'B applied');
select isnt(internal.apply_claim((select a from c)), null, 'A applied after B');
select is((select count(*)::int from internal.cell_control where controller_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 20, 'B controls all of its cells');
select is((select count(*)::int from internal.cell_control where controller_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 90, 'A keeps only the non-overlapping 90 cells (completion order, not upload order)');
select is(internal.apply_claim((select a from c)), (select id from internal.territory_events where claim_id = (select a from c) and kind = 'capture'), 'apply_claim is idempotent');
select is((select (summary ->> 'unchanged_cells')::int from internal.territory_events where claim_id = (select a from c)), 10, 'late earlier loop leaves the 10 overlap cells unchanged');

-- Replay determinism (FR13).
create temp table before as select cell, controller_id from internal.cell_control where competition_id = (select comp from ids);
select is(internal.replay_season((select comp from ids), (select season from ids)), 110, 'replay rebuilds 110 controlled cells');
select is((select count(*)::int from (select * from before except select cell, controller_id from internal.cell_control where competition_id = (select comp from ids)) d), 0, 'replay reproduces identical control');

-- Invalidation of B restores A's overlap and frees B-only cells (FR16, Appendix A).
select isnt(internal.invalidate_claim((select b from c), 'invalid', 'staff_invalidated', null), null, 'B invalidated');
select is((select count(*)::int from internal.cell_control where controller_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 100, 'overlap reverts to A');
select is((select count(*)::int from internal.cell_control where controller_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'B controls nothing after invalidation');

-- Privacy veto: a protected area touching the loop withholds the whole claim.
insert into public.protected_areas (user_id, center, radius_m) select 'cccccccc-0000-4000-8000-000000000003', extensions.st_setsrid(extensions.st_makepoint(lng0 + 15.5 * dlng, lat0 + 15.5 * dlat), 4326)::extensions.geography, 150 from g;
create temp table c2 as select pg_temp.new_claim('cccccccc-0000-4000-8000-000000000003', now() - interval '1 hour') as x;
select is((select status from internal.evaluate_claim_geometry((select x from c2), pg_temp.ring(12, 19, 12, 19), pg_temp.all_cells())), 'withheld_privacy', 'protected area withholds the shared claim');
select is((select count(*)::int from internal.claim_cells where claim_id = (select x from c2)), 0, 'no clipped outline is stored for a withheld claim');

-- Exclusions remove cells instead of transferring them.
insert into public.exclusion_zones (region_id, set_version, kind, geom)
select '00000000-0000-4000-8000-000000000001', 'dev-exclusions-1', 'restricted',
       extensions.st_multi(extensions.st_makeenvelope(lng0 + 12 * dlng + 0.0001, lat0 + 0.0001, lng0 + 13 * dlng - 0.0001, lat0 + 2 * dlat - 0.0001, 4326))::extensions.geography from g;
create temp table c3 as select pg_temp.new_claim('cccccccc-0000-4000-8000-000000000003', now() - interval '50 minutes') as x;
select evaluate_claim_geometry_ok from (select (internal.evaluate_claim_geometry((select x from c3), pg_temp.ring(0, 1, 12, 15), pg_temp.all_cells())).status as evaluate_claim_geometry_ok) s;
select is((select eligible_cell_count from public.loop_claims where id = (select x from c3)), 6, 'excluded cells are not awarded (8 enclosed - 2 excluded)');

-- Fail closed when eligibility data is unavailable.
update public.regions set exclusion_review_status = 'unavailable' where id = '00000000-0000-4000-8000-000000000001';
create temp table c4 as select pg_temp.new_claim('cccccccc-0000-4000-8000-000000000003', now() - interval '40 minutes') as x;
select ok((select 'eligibility_data_unavailable' = any (reasons) from internal.evaluate_claim_geometry((select x from c4), pg_temp.ring(4, 6, 14, 16), pg_temp.all_cells())), 'unavailable eligibility data never authorizes a claim');
update public.regions set exclusion_review_status = 'reviewed' where id = '00000000-0000-4000-8000-000000000001';

-- Publication: only due claims reach the public snapshot.
select ok(internal.publish_due_territory() >= 1, 'due events published');
select is((select count(*)::int from internal.cell_control_public where controller_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 100, 'public snapshot shows A''s 100 cells');
create temp table c5 as select pg_temp.new_claim('bbbbbbbb-0000-4000-8000-000000000002', now()) as x;
select is((select status from internal.evaluate_claim_geometry((select x from c5), pg_temp.ring(0, 2, 0, 2), pg_temp.all_cells())), 'eligible', 'fresh claim eligible');
select isnt(internal.apply_claim((select x from c5)), null, 'fresh claim applied');
select is((select count(*)::int from internal.cell_control_public where controller_id = 'bbbbbbbb-0000-4000-8000-000000000002' and (select internal.publish_due_territory()) >= 0), 0, 'a run is not published before the 30-minute delay');

-- Ranking through the client RPC (published data only).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select rank::int from public.territory_leaderboard('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041') where handle like 'runner_aaaaaaaa%'), 1, 'A ranks first by published area');
reset role;

select * from finish();
rollback;
