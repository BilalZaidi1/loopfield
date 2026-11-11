-- Movement points, reclamation and achievements: award once, daily cap, revoke/reinstate, owner-only
-- reads; reclaim eligibility (lost to a run, held earlier), atomic charge, idempotency, no points
-- ping-pong, running retakes, replay, refunds when the capture is invalidated, withdrawal when the
-- ownership basis is invalid; challenge evaluation, badges, score and leaderboard scopes and privacy.
begin;
select plan(73);

create temp table g as select 0.0009::float8 as dlat, 0.001::float8 as dlng, 67.0::float8 as lng0, 24.86::float8 as lat0;
insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7)
select 100000 + i * 100 + j, 11,
       extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326),
       extensions.st_area(extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326)::extensions.geography),
       7000 + (i / 10) * 10 + (j / 10)
  from g, generate_series(0, 19) i, generate_series(0, 19) j;
create function pg_temp.ring(i0 int, i1 int, j0 int, j1 int) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + i0 * dlat - 0.00018),
    jsonb_build_array(lng0 + (j1 + 1) * dlng + 0.0002, lat0 + (i1 + 1) * dlat + 0.00018),
    jsonb_build_array(lng0 + j0 * dlng - 0.0002, lat0 + (i1 + 1) * dlat + 0.00018)) from g;
$$;
create function pg_temp.all_cells() returns bigint[] language sql as $$ select array_agg(cell) from internal.territory_cells where cell between 100000 and 102000 $$;
create function pg_temp.cell(i int, j int) returns text language sql as $$ select (100000 + i * 100 + j)::text $$;
create temp table ids as select '00000000-0000-4000-8000-000000000031'::uuid comp, '00000000-0000-4000-8000-000000000041'::uuid season;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'ali@example.test'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'sara@example.test'),
  ('cccccccc-0000-4000-8000-00000000000c', 'omar@example.test');
update public.user_settings set territory_competition_enabled = true where user_id in ('aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b');

create function pg_temp.act(p_user uuid, p_started timestamptz) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.activities (id, user_id, started_at, ended_at, status) values (v, p_user, p_started, p_started + interval '40 minutes', 'processed');
  return v;
end $$;
create function pg_temp.loop(p_user uuid, p_completed timestamptz, i0 int, i1 int, j0 int, j1 int) returns uuid language plpgsql as $$
declare v_act uuid := gen_random_uuid(); v_claim uuid;
begin
  insert into public.activities (id, user_id, started_at, ended_at, status, competition_id, season_id)
  values (v_act, p_user, p_completed - interval '40 minutes', p_completed, 'processed', (select comp from ids), (select season from ids));
  insert into public.loop_claims (activity_id, user_id, competition_id, season_id, rule_version, completed_at, received_at)
  values (v_act, p_user, (select comp from ids), (select season from ids), 'territory-test', p_completed, now()) returning id into v_claim;
  perform internal.evaluate_claim_geometry(v_claim, pg_temp.ring(i0, i1, j0, j1), pg_temp.all_cells());
  update public.loop_claims set publish_after = least(publish_after, now()) where id = v_claim; -- frozen test clock
  perform internal.apply_claim(v_claim);
  return v_claim;
end $$;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table u as select 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid a, 'bbbbbbbb-0000-4000-8000-00000000000b'::uuid b, 'cccccccc-0000-4000-8000-00000000000c'::uuid c;
grant select on g, ids, u to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Movement points
-- ---------------------------------------------------------------------------------------------
create temp table runs as select pg_temp.act((select a from u), date_trunc('day', now()) + interval '1 hour') as r1,
                                  pg_temp.act((select a from u), date_trunc('day', now()) + interval '2 hours') as r2,
                                  pg_temp.act((select a from u), date_trunc('day', now()) + interval '3 hours') as r3;
grant select on runs to authenticated;
select is(internal.award_movement_points((select r1 from runs), 2549, 'movement-test', '{}'), 25, 'a verified 2.549 km run earns 25 points (rounded down)');
select is(internal.award_movement_points((select r1 from runs), 9999, 'movement-test', '{}'), 25, 'awarding the same run again changes nothing');
select is((select count(*)::int from internal.movement_ledger where activity_id = (select r1 from runs)), 1, 'one ledger entry per run');
select is(internal.award_movement_points((select r2 from runs), 45000, 'movement-test', '{}'), 375, 'the daily cap (400) limits a 45 km run to the remaining 375 points');
select is((select note from internal.movement_ledger where activity_id = (select r2 from runs)), 'daily_cap', 'a capped award is labelled');
select is(internal.award_movement_points((select r3 from runs), 5000, 'movement-test', '{}'), 0, 'no more points once the cap is reached that day');
select is((select balance from internal.movement_balances where user_id = (select a from u)), 400, 'balance holds the 400 points earned');
select is(internal.revoke_movement_points((select r1 from runs), 'source_deleted'), 25, 'removing a run takes its points back');
select is(internal.revoke_movement_points((select r1 from runs), 'source_deleted'), 0, 'a second removal takes nothing');
select is(internal.reinstate_movement_points((select r1 from runs), 'appeal_overturned'), 25, 'an overturned removal restores the points');
select is((select balance from internal.movement_balances where user_id = (select a from u)), 400, 'balance is back to 400');

set local role authenticated;
select pg_temp.as_user((select a from u));
select throws_ok($$select * from internal.movement_ledger$$, '42501', null, 'the points ledger is closed to clients');
select is((select balance from public.my_movement()), 400, 'my_movement shows my balance');
select is((select points from public.activity_movement((select r1 from runs))), 25, 'activity_movement shows what one run earned');
select pg_temp.as_user((select b from u));
select is((select balance from public.my_movement()), 0, 'another runner sees only their own balance');
select is((select count(*)::int from public.activity_movement((select r1 from runs))), 0, 'nobody else can read what my run earned');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Reclamation. A holds a 5 x 5 block; B's later loop takes 4 of A's cells plus 6 new ones.
-- ---------------------------------------------------------------------------------------------
create temp table c as select pg_temp.loop((select a from u), now() - interval '3 hours', 0, 4, 0, 4) as a_loop,
                               pg_temp.loop((select b from u), now() - interval '2 hours', 0, 1, 3, 7) as b_loop;
select internal.publish_due_territory(100);
select is((select count(*)::int from internal.cell_control_public where controller_id = (select a from u)), 21, 'A holds 21 published cells after losing 4');

set local role authenticated;
select pg_temp.as_user((select a from u));
select is((select count(*)::int from public.my_lost_cells((select comp from ids), (select season from ids))), 4, 'A sees exactly the 4 cells B took');
select is((select count(*)::int from public.my_lost_cells((select comp from ids), (select season from ids)) where reclaimable and cost = 3), 4, 'all 4 are reclaimable at 3 points each');
select is((select count(*)::int from public.my_lost_cells((select comp from ids), (select season from ids), 66.99, 24.85, 67.02, 24.88)), 4, 'the viewport form returns the same cells');
select pg_temp.as_user((select c from u));
select is((select count(*)::int from public.my_lost_cells((select comp from ids), (select season from ids))), 0, 'a runner who never held ground has nothing to reclaim');
select throws_ok($$select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(0, 6)])$$,
                 '42501', null, 'a runner without territory sharing switched on cannot reclaim');
reset role;

-- Not enough points: nothing changes.
update internal.movement_balances set balance = 5 where user_id = (select a from u);
set local role authenticated;
select pg_temp.as_user((select a from u));
select throws_ok($$select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(0, 3), pg_temp.cell(0, 4)])$$,
                 'P0402', null, 'reclaiming more than the balance covers is refused');
reset role;
select is((select count(*)::int from public.loop_claims where source = 'reclaim'), 0, 'a refused reclaim writes no claims');
select is((select balance from internal.movement_balances where user_id = (select a from u)), 5, 'and charges nothing');
update internal.movement_balances set balance = 400 where user_id = (select a from u);

-- Reclaim two cells (as A; results kept in a table owned by the test).
select pg_temp.as_user((select a from u));
create temp table r1 as select public.reclaim_cells('11111111-0000-4000-8000-000000000001', (select comp from ids), (select season from ids), array[pg_temp.cell(0, 3), pg_temp.cell(0, 4)]) as res;
grant select on r1 to authenticated;
select is((select (res ->> 'reclaimed')::int from r1), 2, 'two cells reclaimed');
select is((select (res ->> 'spent')::int from r1), 6, 'for 6 points');
select is((select balance from internal.movement_balances where user_id = (select a from u)), 394, 'balance drops by exactly the cost');
select is((select controller_id from internal.cell_control where cell = pg_temp.cell(0, 3)::bigint), (select a from u), 'A controls the cell again');
select is((select controller_id from internal.cell_control_public where cell = pg_temp.cell(0, 4)::bigint), (select a from u), 'the published map shows it at once');
select is((select count(*)::int from internal.movement_ledger where kind = 'reclaim' and request_id = '11111111-0000-4000-8000-000000000001'), 2, 'one ledger entry per reclaimed cell');

-- The same request again is answered, not charged again; another runner cannot reuse its id.
set local role authenticated;
select pg_temp.as_user((select a from u));
select is(public.reclaim_cells('11111111-0000-4000-8000-000000000001', (select comp from ids), (select season from ids), array[pg_temp.cell(0, 3), pg_temp.cell(0, 4)]),
          (select res from r1), 'repeating a request returns its first result');
select pg_temp.as_user((select b from u));
select throws_ok($$select public.reclaim_cells('11111111-0000-4000-8000-000000000001', (select comp from ids), (select season from ids), array[pg_temp.cell(0, 5)])$$,
                 '22023', null, 'another runner cannot reuse a request id');
reset role;
select is((select balance from internal.movement_balances where user_id = (select a from u)), 394, 'still charged once');

-- Cells A never held are skipped, never sold.
select pg_temp.as_user((select a from u));
create temp table r2 as select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(1, 3), pg_temp.cell(1, 4), pg_temp.cell(1, 6)]) as res;
set local role authenticated;
select throws_ok($$select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(0, 6), pg_temp.cell(1, 7)])$$,
                 'P0409', null, 'points cannot buy ground the runner never held');
reset role;
select is((select (res ->> 'reclaimed')::int from r2), 2, 'the two lost cells are reclaimed');
select is((select (res ->> 'skipped')::int from r2), 1, 'the never-held cell is skipped');
select is((select balance from internal.movement_balances where user_id = (select a from u)), 388, 'only reclaimed cells are paid for');

-- Replay determinism: reclaims are claims, so a full rebuild reproduces the same control.
create temp table before as select cell, controller_id from internal.cell_control where competition_id = (select comp from ids) and season_id = (select season from ids);
select internal.replay_season((select comp from ids), (select season from ids));
select is((select count(*)::int from (select * from before except select cell, controller_id from internal.cell_control where competition_id = (select comp from ids) and season_id = (select season from ids)) d), 0,
          'replay reproduces control including reclaimed cells');

-- No points ping-pong: B lost these cells to points, so B can only win them back by running.
select internal.award_movement_points(pg_temp.act((select b from u), now() - interval '5 hours'), 12000, 'movement-test', '{}');
set local role authenticated;
select pg_temp.as_user((select b from u));
select is((select count(*)::int from public.my_lost_cells((select comp from ids), (select season from ids)) where not reclaimable and blocked_reason = 'taken_with_points'), 4,
          'B sees the 4 cells as taken back with points');
select throws_ok($$select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(0, 3)])$$,
                 'P0409', null, 'points cannot undo a reclaim');
reset role;
select is((select held_by from public.territory_cell_detail((select comp from ids), (select season from ids), pg_temp.cell(0, 3)) d), 'reclaim', 'cell detail says the ground is held through points');

-- Running still wins: a newer loop by C takes a reclaimed cell; A could reclaim it again.
update public.user_settings set territory_competition_enabled = true where user_id = (select c from u);
create temp table c3 as select pg_temp.loop((select c from u), now() + interval '1 minute', 0, 0, 3, 3) as x;
select internal.publish_due_territory(100);
select is((select controller_id from internal.cell_control where cell = pg_temp.cell(0, 3)::bigint), (select c from u), 'a later loop takes a reclaimed cell (running beats points)');
set local role authenticated;
select pg_temp.as_user((select a from u));
select ok((select reclaimable from public.my_lost_cells((select comp from ids), (select season from ids)) where cell = pg_temp.cell(0, 3)), 'A may reclaim it again from the run that took it');
reset role;

-- Achievements, evaluated before any invalidation.
select internal.evaluate_achievements((select a from u));
select internal.evaluate_achievements((select b from u));
select ok((select completed_at is not null from internal.user_challenges where user_id = (select a from u) and challenge_id = 'distance_50'), 'A earned the 50 km badge from verified distance');
select ok((select completed_at is not null from internal.user_challenges where user_id = (select a from u) and challenge_id = 'capture_25'), 'A earned the capture badge from loop captures');
select is((select progress from internal.user_challenges where user_id = (select b from u) and challenge_id = 'rivals_5'), 1::numeric, 'B took cells from one runner');
select is((select score from internal.achievement_scores where user_id = (select a from u)), 10 + 25 + 10 + 2 * 25, 'score = tier points + 25 per category');
select is((select count(*)::int from public.notifications where user_id = (select a from u) and kind = 'badge_earned'), 3, 'each new badge is notified once');
select internal.evaluate_achievements((select a from u));
select is((select count(*)::int from public.notifications where user_id = (select a from u) and kind = 'badge_earned'), 3, 're-evaluation does not notify again');
update internal.movement_balances set balance = 999999 where user_id = (select b from u);
select internal.evaluate_achievements((select b from u));
select is((select score from internal.achievement_scores where user_id = (select b from u)), 10 + 25, 'points balance never changes the ranking score');

set local role authenticated;
select pg_temp.as_user((select a from u));
select is((select count(*)::int from public.my_challenges()), 24, 'all 24 challenges are listed with my progress');
select is((select rank from public.achievement_leaderboard('everyone') where is_me), 1::bigint, 'A ranks first');
select ok((select hidden and handle is null and display_name = 'Private runner' from public.achievement_leaderboard('everyone') where score = 35), 'a private profile is ranked but not identified');
select is((select visible from public.achievement_profile((select b from u))), false, 'a private runner''s badges are hidden from non-followers');
select throws_ok($$select * from public.achievement_leaderboard('region')$$, 'P0404', null, 'region rankings need a city');
select throws_ok($$select * from public.achievement_leaderboard('club', gen_random_uuid())$$, '42501', null, 'club rankings need membership');
select is((select count(*)::int from public.achievement_leaderboard('friends')), 1, 'friends ranking without mutual follows is just me');
reset role;
update public.profiles set visibility = 'public', district_id = '00000000-0000-4000-8000-000000000011' where id in ((select a from u), (select b from u));
insert into public.follows (follower_id, followee_id, state, accepted_at) values ((select a from u), (select b from u), 'accepted', now()), ((select b from u), (select a from u), 'accepted', now());
set local role authenticated;
select pg_temp.as_user((select a from u));
select is((select handle from public.achievement_leaderboard('everyone') where score = 35), (select handle::text from public.profiles where id = (select b from u)), 'a public profile is identified');
select is((select count(*)::int from public.achievement_leaderboard('friends')), 2, 'mutual follows appear in friends');
select is((select count(*)::int from public.achievement_leaderboard('country')), 2, 'country ranking uses the region''s country');
select ok((select visible and badges = 1 and jsonb_array_length(earned) = 1 from public.achievement_profile((select b from u))), 'a public runner''s badges are visible');
reset role;
update public.user_settings set full_private_mode = true where user_id = (select b from u);
set local role authenticated;
select pg_temp.as_user((select a from u));
select is((select count(*)::int from public.achievement_leaderboard('everyone')), 1, 'full private mode leaves the rankings');
reset role;
update public.user_settings set full_private_mode = false where user_id = (select b from u);

-- Refund: B's capture is ruled invalid, so the 4 cells A paid for are refunded (A keeps them).
select internal.award_movement_points((select activity_id from public.loop_claims where id = (select b_loop from c)), 3000, 'movement-test', '{}');
create temp table bal as select balance from internal.movement_balances where user_id = (select a from u);
select internal.invalidate_claim((select b_loop from c), 'invalid', 'staff_invalidated', null);
select is((select balance from internal.movement_balances where user_id = (select a from u)), (select balance + 12 from bal), 'A is refunded 12 points for 4 reclaimed cells');
select is((select count(*)::int from public.loop_claims where source = 'reclaim' and refunded_at is not null), 4, 'each refunded reclaim is marked');
select is((select (data ->> 'points')::int from public.notifications where user_id = (select a from u) and kind = 'points_refunded'), 12, 'one refund notification with the total');
select is((select points from internal.run_movement_net((select activity_id from public.loop_claims where id = (select b_loop from c)))), 0, 'the invalidated run loses its movement points');

-- Basis invalid: A's own loop is ruled invalid, so reclaims that relied on it are withdrawn.
select internal.invalidate_claim((select a_loop from c), 'invalid', 'staff_invalidated', null);
select is((select count(*)::int from public.loop_claims where source = 'reclaim' and status = 'withdrawn' and 'basis_invalidated' = any (reasons)), 4,
          'every reclaim based on the invalid claim is withdrawn, including one a later loop had already taken');
select is((select count(*)::int from internal.cell_control where controller_id = (select a from u)), 0, 'A holds nothing after the basis is invalid');
select internal.evaluate_achievements((select a from u));
select ok((select completed_at is null from internal.user_challenges where user_id = (select a from u) and challenge_id = 'capture_25'), 'a badge whose evidence was invalidated is removed');

-- Closed seasons accept no reclaims.
update public.seasons set status = 'settling' where id = (select season from ids);
set local role authenticated;
select pg_temp.as_user((select a from u));
select throws_ok($$select public.reclaim_cells(gen_random_uuid(), (select comp from ids), (select season from ids), array[pg_temp.cell(0, 0)])$$,
                 'P0409', null, 'no reclaims outside an active season');
reset role;
select lives_ok($$select internal.run_maintenance()$$, 'the minute job publishes and drains achievement evaluations');
select is((select count(*)::int from internal.achievement_dirty), 0, 'no runner is left waiting for evaluation');

select * from finish();
rollback;
