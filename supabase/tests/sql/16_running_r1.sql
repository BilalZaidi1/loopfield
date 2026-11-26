-- Running features R1: planned routes (owner-only, measured by the database), the daily path-following
-- count, and live links (owner pushes, the public page, protected areas, ending, revoking, clean-up).
begin;
select plan(50);

insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-000000000001', 'planner@run.test'),
  ('d2000000-0000-4000-8000-000000000002', 'other@run.test'),
  ('d3000000-0000-4000-8000-000000000003', 'blocked@run.test');
update public.profiles set handle = 'planner_p', display_name = 'Planner' where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'other_o' where id = 'd2000000-0000-4000-8000-000000000002';
update public.profiles set handle = 'blocked_b' where id = 'd3000000-0000-4000-8000-000000000003';
insert into public.blocks (blocker_id, blocked_id) values ('d1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.fix(seconds_ago double precision, lng double precision, lat double precision, acc double precision default 5) returns jsonb language sql as $$
  select jsonb_build_object('t', (extract(epoch from now()) * 1000 - seconds_ago * 1000)::bigint, 'lat', lat, 'lng', lng, 'acc', acc);
$$;
create temp table t (line text, loop text, short text, route uuid, run_token text, standing text, tick_token text);
grant select, update, insert on t to authenticated, anon;
insert into t (line, loop, short) values (
  extensions.st_asencodedpolyline(extensions.st_setsrid(extensions.st_makeline(extensions.st_makepoint(67.0011, 24.8607), extensions.st_makepoint(67.0110, 24.8607)), 4326), 5),
  extensions.st_asencodedpolyline(extensions.st_setsrid(extensions.st_makeline(array[extensions.st_makepoint(67.0011, 24.8607), extensions.st_makepoint(67.0041, 24.8607),
                                   extensions.st_makepoint(67.0041, 24.8634), extensions.st_makepoint(67.0011, 24.8634), extensions.st_makepoint(67.0011, 24.8607)]), 4326), 5),
  extensions.st_asencodedpolyline(extensions.st_setsrid(extensions.st_makeline(extensions.st_makepoint(67.0011, 24.8607), extensions.st_makepoint(67.0013, 24.8607)), 4326), 5));

-- Settings ----------------------------------------------------------------------------------------
select is((select count(*)::int from public.app_config where key in ('route_builder_enabled', 'route_snapping_enabled', 'planned_routes_max',
          'route_snap_daily_cap', 'route_snap_monthly_alert', 'off_route_distance_m', 'off_route_seconds', 'live_links_enabled', 'live_link_push_seconds',
          'live_link_grace_minutes', 'live_link_max_hours', 'live_link_keep_hours', 'avatar_marker_enabled')), 13, 'the R1 settings exist');
select is((select count(*)::int from internal.config_registry where key in ('route_builder_enabled', 'route_snapping_enabled', 'planned_routes_max',
          'route_snap_daily_cap', 'route_snap_monthly_alert', 'off_route_distance_m', 'off_route_seconds', 'live_links_enabled', 'live_link_push_seconds',
          'live_link_grace_minutes', 'live_link_max_hours', 'live_link_keep_hours', 'avatar_marker_enabled')), 13, 'and each appears in App control');
select ok((select 'live_link' = any (allowed) from internal.config_registry where key = 'rate_limits'), 'live links have an anti-spam limit');

-- Planned routes ------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.planned_routes (name, path, snapped) select '  River loop ', line, false from t$$, 'a runner saves a planned route');
update t set route = (select id from public.planned_routes where name = 'River loop');
select ok((select distance_m between 980 and 1020 from public.planned_routes where id = (select route from t)), 'the database measures the line (about 1 km)');
select is((select point_count from public.planned_routes where id = (select route from t)), 2, 'and counts its points');
select is((select is_loop from public.planned_routes where id = (select route from t)), false, 'a line from A to B is not a loop');
select lives_ok($$insert into public.planned_routes (name, path, snapped) select 'Square', loop, true from t$$, 'a loop saves too');
select is((select is_loop from public.planned_routes where name = 'Square'), true, 'and is recognised as a loop');
select throws_ok($$insert into public.planned_routes (name, path) select 'Tiny', short from t$$, '22023', null, 'a route shorter than 50 m is refused');
select throws_ok($$insert into public.planned_routes (name, path) values ('Junk', '????')$$, '22023', null, 'an unreadable line is refused');
select throws_ok($$update public.planned_routes set distance_m = 5 where name = 'Square'$$, '42501', null, 'the measurements cannot be set by the app');
select lives_ok($$update public.planned_routes set name = 'Square loop' where name = 'Square'$$, 'a planned route can be renamed');

select pg_temp.as_user('d2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.planned_routes), 0, 'nobody else can see a runner''s planned routes');
update public.planned_routes set name = 'Stolen' where name = 'Square loop';
delete from public.planned_routes where name = 'Square loop';
reset role;
select is((select count(*)::int from public.planned_routes where name = 'Square loop'), 1, 'or change or delete them');

update public.app_config set value = '2' where key = 'planned_routes_max';
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into public.planned_routes (name, path) select 'Third', line from t$$, '54000', null, 'the number of planned routes is limited');
reset role;
update public.app_config set value = '100' where key = 'planned_routes_max';
update public.app_config set value = 'false' where key = 'route_builder_enabled';
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into public.planned_routes (name, path) select 'Paused', line from t$$, '42501', null, 'saving is paused while the route builder is switched off');
select lives_ok($$delete from public.planned_routes where name = 'Square loop'$$, 'but routes can still be deleted');
reset role;
update public.app_config set value = 'true' where key = 'route_builder_enabled';

-- Path following ---------------------------------------------------------------------------------------
select is(internal.take_route_snap('d1000000-0000-4000-8000-000000000001'), 'ok', 'a path-following request is counted');
update public.app_config set value = '2' where key = 'route_snap_daily_cap';
select is(internal.take_route_snap('d1000000-0000-4000-8000-000000000001'), 'ok', 'up to the daily cap');
select is(internal.take_route_snap('d1000000-0000-4000-8000-000000000001'), 'capped', 'and then refused for the day');
update public.app_config set value = 'false' where key = 'route_snapping_enabled';
select is(internal.take_route_snap('d2000000-0000-4000-8000-000000000002'), 'paused', 'the switch stops path following for everyone');
update public.app_config set value = 'true' where key = 'route_snapping_enabled';
update public.app_config set value = '200' where key = 'route_snap_daily_cap';
set local role authenticated;
select throws_ok($$select internal.take_route_snap('d1000000-0000-4000-8000-000000000001')$$, '42501', null, 'the app cannot call the counter itself');

-- Live links -----------------------------------------------------------------------------------------------
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
update t set run_token = (select public.live_link_create('run') ->> 'token');
select ok((select length(run_token) >= 22 from t), 'a runner starts a live link for this run');
update t set standing = (select public.live_link_create('standing') ->> 'token');
select is((select public.live_link_create('standing') ->> 'token' from t), (select standing from t), 'the standing link stays the same');
select is((select (public.live_link_push(run_token, 'e1000000-0000-4000-8000-000000000001', 'running',
            jsonb_build_array(pg_temp.fix(20, 67.0011, 24.8607), pg_temp.fix(10, 67.0041, 24.8607), pg_temp.fix(0, 67.0070, 24.8607), pg_temp.fix(5, 67.0, 24.0, 90))) ->> 'added')::int from t),
          3, 'the phone sends its fixes; inaccurate ones are dropped');
select is((select public.live_link_push(run_token, 'e1000000-0000-4000-8000-000000000001', 'running', '[]') ->> 'reason' from t), 'too_soon',
          'pushes come no more often than the update interval');
select is((select public.live_link_push(run_token, 'e2000000-0000-4000-8000-000000000002', 'running', '[]') ->> 'reason' from t), 'ended',
          'a run link carries only one run');
select is(jsonb_array_length(public.my_live_links()), 2, 'the runner sees their open links');

select pg_temp.as_user('d2000000-0000-4000-8000-000000000002');
select is((select public.live_link_push(run_token, 'e1000000-0000-4000-8000-000000000001', 'running', '[]') ->> 'reason' from t), 'ended',
          'nobody else can push to a runner''s link');

set local role anon;
select is((select public.public_live_link(run_token, true) ->> 'status' from t), 'running', 'anyone with the link sees the run live');
select is((select public.public_live_link(run_token) ->> 'name' from t), 'Planner', 'with the runner''s display name');
select ok((select (public.public_live_link(run_token) ->> 'distance_m')::int between 550 and 650 from t), 'and the distance so far');
select is((select jsonb_array_length(public.public_live_link(run_token) -> 'trail' -> 0) from t), 3, 'and the trail');
select throws_ok($$select public.live_link_create('run')$$, '42501', null, 'signed-out visitors cannot start links');
reset role;
select is((select views from public.live_links where token = (select run_token from t)), 1, 'opening the page is counted once');

-- A protected area around the latest position hides it (and its part of the trail).
insert into public.protected_areas (user_id, label, center, radius_m)
values ('d1000000-0000-4000-8000-000000000001', 'Home', extensions.st_setsrid(extensions.st_makepoint(67.0070, 24.8607), 4326)::extensions.geography, 100);
set local role anon;
select is((select (public.public_live_link(run_token) ->> 'hidden')::boolean from t), true, 'a position inside a protected area is held back');
select ok((select public.public_live_link(run_token) -> 'last' = 'null'::jsonb from t), 'so the page never receives it');
select is((select jsonb_array_length(public.public_live_link(run_token) -> 'trail' -> 0) from t), 2, 'and the trail stops before it');
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select public.live_link_set_show_everywhere(run_token, true) from t;
set local role anon;
select ok((select public.public_live_link(run_token) -> 'last' <> 'null'::jsonb from t), 'unless the runner chose to show their position everywhere');

set local role authenticated;
select pg_temp.as_user('d3000000-0000-4000-8000-000000000003');
select ok((select public.public_live_link(run_token) is null from t), 'a blocked viewer sees nothing');

select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select public.live_link_end(run_token) from t;
set local role anon;
select is((select public.public_live_link(run_token) ->> 'status' from t), 'ended', 'stopping sharing ends a run link at once');

-- A standing link shares each run, and shows nothing between runs.
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select public.live_link_push(standing, 'e3000000-0000-4000-8000-000000000003', 'running', jsonb_build_array(pg_temp.fix(5, 67.0200, 24.8700))) from t;
set local role anon;
select is((select public.public_live_link(standing) ->> 'status' from t), 'running', 'a standing link shows the current run');
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select public.live_link_end(standing) from t;
set local role anon;
select is((select public.public_live_link(standing) ->> 'status' from t), 'not_running', 'and "not running" once the run stops');
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select public.live_link_revoke(standing) from t;
set local role anon;
select ok((select public.public_live_link(standing) is null from t), 'a turned-off link shows nothing');
reset role;
select is((select count(*)::int from internal.live_positions where token = (select standing from t)), 0, 'and its positions are deleted at once');

-- Clean-up: links end after the run plus the grace period, and positions go after the keep time.
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
update t set tick_token = (select public.live_link_create('run') ->> 'token');
select public.live_link_push(tick_token, 'e4000000-0000-4000-8000-000000000004', 'finished', jsonb_build_array(pg_temp.fix(5, 67.03, 24.87))) from t;
reset role;
update internal.live_link_runs set ended_at = now() - interval '20 minutes' where token = (select tick_token from t);
select internal.live_links_tick();
select ok((select ended_at is not null from public.live_links where token = (select tick_token from t)), 'a run link ends after the run plus the grace period');
update internal.live_link_runs set ended_at = now() - interval '25 hours' where token = (select tick_token from t);
select internal.live_links_tick();
select is((select count(*)::int from internal.live_positions where token = (select tick_token from t)), 0, 'positions are deleted once the keep time has passed');
select ok(internal.run_maintenance() ? 'live_links', 'the every-minute maintenance runs the live-link clean-up');

update public.app_config set value = 'false' where key = 'live_links_enabled';
set local role authenticated;
select pg_temp.as_user('d1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.live_link_create('run')$$, '55000', null, 'no new links while live links are switched off');
reset role;
update public.app_config set value = 'true' where key = 'live_links_enabled';

select * from finish();
rollback;
