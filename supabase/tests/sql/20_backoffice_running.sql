-- Back office for the running features: settings and their permissions, support ending a runner's live links,
-- live-sharing status on tickets and runner pages, the Overview figures, the route review queue, the twelve
-- daily metrics on fixed data (and the days whose sources are purged), and what the SQL editor cannot read.
begin;
select plan(75);

insert into auth.users (id, email) values
  ('9a100000-0000-4000-8000-000000000001', 'admin@bo-run.test'),
  ('9a200000-0000-4000-8000-000000000002', 'support@bo-run.test'),
  ('9a300000-0000-4000-8000-000000000003', 'moderator@bo-run.test'),
  ('9a400000-0000-4000-8000-000000000004', 'routes@bo-run.test'),
  ('9a500000-0000-4000-8000-000000000005', 'analyst@bo-run.test'),
  ('9a600000-0000-4000-8000-000000000006', 'settings@bo-run.test'),
  ('9b100000-0000-4000-8000-000000000001', 'sharer@bo-run.test'),
  ('9b200000-0000-4000-8000-000000000002', 'other@bo-run.test');
update public.profiles set handle = 'bo_sharer' where id = '9b100000-0000-4000-8000-000000000001';
update public.profiles set handle = 'bo_other' where id = '9b200000-0000-4000-8000-000000000002';
insert into internal.staff_role_defs (key, label, permissions) values ('settings_only', 'Settings only', '{config}');
insert into public.staff_roles (user_id, role) values
  ('9a100000-0000-4000-8000-000000000001', 'admin'),
  ('9a200000-0000-4000-8000-000000000002', 'support'),
  ('9a300000-0000-4000-8000-000000000003', 'moderator'),
  ('9a400000-0000-4000-8000-000000000004', 'route_reviewer'),
  ('9a500000-0000-4000-8000-000000000005', 'analyst'),
  ('9a600000-0000-4000-8000-000000000006', 'settings_only');

create function pg_temp.as_user(p uuid, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create function pg_temp.fix(seconds_ago double precision, lng double precision, lat double precision) returns jsonb language sql as $$
  select jsonb_build_object('t', (extract(epoch from now()) * 1000 - seconds_ago * 1000)::bigint, 'lat', lat, 'lng', lng, 'acc', 5);
$$;
create temp table t (run_link text, standing text, friends text, other_link text, ticket uuid, ended jsonb);
insert into t default values;
grant select, update on t to authenticated;

-- Settings ------------------------------------------------------------------------------------------------
select is((select (value, is_public)::text from public.app_config where key = 'route_review_target_hours'), '(48,f)',
          'the review target is 48 hours and only the server reads it');
select is((select (category, min_role, min_value, max_value)::text from internal.config_registry where key = 'route_review_target_hours'),
          '(system,config,1,336)', 'and it is edited with the App settings permission');
select is((select allowed from internal.config_registry where key = 'disabled_health_cards'),
          array['heart_rate', 'steps', 'calories', 'sleep', 'resting_hr', 'hrv', 'vo2_max', 'training', 'imported_routes'],
          'the health-card list offers the cards the app can hide, training and imported maps included');
select is((select (category, min_role)::text from internal.config_registry where key = 'route_proposals_a_to_b'), '(tunable,rules.edit)',
          'start-to-finish routes change the competition, so they need Edit game rules');

set local role authenticated;
select pg_temp.as_user('9a100000-0000-4000-8000-000000000001');
select lives_ok($$select public.ops_set_config('disabled_health_cards', '["training", "imported_routes"]', 'Training numbers look wrong')$$,
                'a known health card can be hidden');
select throws_ok($$select public.ops_set_config('disabled_health_cards', '["traning"]', 'Typo on purpose')$$, '22023', null,
                 'a misspelt card is refused instead of silently doing nothing');
select lives_ok($$select public.ops_set_config('disabled_health_cards', '[]', 'Back to normal')$$, 'and the list can be emptied again');
select pg_temp.as_user('9a600000-0000-4000-8000-000000000006');
select throws_ok($$select public.ops_set_config('route_proposals_a_to_b', 'true', 'Trying start to finish')$$, '42501', null,
                 'the App settings permission alone cannot turn on start-to-finish routes');
select lives_ok($$select public.ops_set_config('route_review_target_hours', '24', 'Faster reviews for the pilot')$$,
                'but it can change the review target');
select pg_temp.as_user('9a100000-0000-4000-8000-000000000001');
select lives_ok($$select public.ops_set_config('route_review_target_hours', '48', 'Back to the agreed target')$$, 'the target goes back to 48 hours');

-- Live links and sharing with friends ---------------------------------------------------------------------
select pg_temp.as_user('9b100000-0000-4000-8000-000000000001');
update t set run_link = (select public.live_link_create('run') ->> 'token');
update t set standing = (select public.live_link_create('standing') ->> 'token');
select public.live_link_push(run_link, '9c000000-0000-4000-8000-000000000001', 'running', jsonb_build_array(pg_temp.fix(5, 67.0011, 24.8607))) from t;
update public.user_settings set friends_live_mode = 'all' where user_id = '9b100000-0000-4000-8000-000000000001';
update t set friends = (select public.friends_live_start('9c000000-0000-4000-8000-000000000002') ->> 'token');
select pg_temp.as_user('9b200000-0000-4000-8000-000000000002');
update t set other_link = (select public.live_link_create('run') ->> 'token');
select public.live_link_push(other_link, '9c000000-0000-4000-8000-000000000003', 'running', jsonb_build_array(pg_temp.fix(5, 67.0200, 24.8700))) from t;
update t set ticket = public.support_create('safety', 'Someone has my link', 'A stranger messaged me about my run', '{}', '2.0.0', 'ios', 'iPhone 15');
reset role;
select ok((select run_link is not null and standing is not null and friends is not null and other_link is not null from t), 'the runners have links to end');

set local role authenticated;
select pg_temp.as_user('9a200000-0000-4000-8000-000000000002');
select is(public.ops_user_overview('9b100000-0000-4000-8000-000000000001') -> 'sharing',
          '{"live_links": 2, "friends_sharing": true, "live_links_enabled": true, "friends_live_enabled": true}'::jsonb,
          'the runner page says how many live links work and whether sharing with friends is on');
select ok(position((select run_link from t) in public.ops_user_overview('9b100000-0000-4000-8000-000000000001')::text) = 0
          and position((select friends from t) in public.ops_user_overview('9b100000-0000-4000-8000-000000000001')::text) = 0,
          'and never a link itself');
select is((public.ops_support_ticket((select ticket from t)) -> 'runner' -> 'sharing' ->> 'live_links')::int, 1,
          'a ticket''s runner panel shows the same status');
select is((select array_agg(k order by k) from jsonb_object_keys(public.ops_support_ticket((select ticket from t)) -> 'runner' -> 'sharing') k),
          array['friends_live_enabled', 'friends_sharing', 'live_links', 'live_links_enabled'], 'with counts and yes or no only');
select is(public.ops_overview() -> 'running' ->> 'live_links_now', '2', 'the Overview counts live links with a run being shared now');
select is(public.ops_overview() -> 'running' ->> 'friends_live_now', '1', 'and runs being shared with friends');

select pg_temp.as_user('9a300000-0000-4000-8000-000000000003');
select throws_ok($$select public.ops_end_live_links('9b100000-0000-4000-8000-000000000001', 'Ending them for safety', false)$$, '42501', null,
                 'runner lookup alone cannot end live links: it needs the support permission');
select pg_temp.as_user('9a200000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_end_live_links('9b0000ff-0000-4000-8000-000000000001', 'Ending them for safety', false)$$, 'P0002', null,
                 'an unknown runner is reported, not ignored');
select throws_ok($$select public.ops_end_live_links('9b100000-0000-4000-8000-000000000001', 'no', false)$$, '22023', null, 'ending live links needs a reason');
update t set ended = public.ops_end_live_links('9b100000-0000-4000-8000-000000000001', 'Runner reports a stranger has the link', false);
select is((select ended from t), '{"links_ended": 3, "friend_sharing_off": false}'::jsonb,
          'support ends the run link, the standing link and the run shared with friends at once, and learns only how many');
reset role;
select is((select count(*)::int from public.live_links where user_id = '9b100000-0000-4000-8000-000000000001' and revoked_at is null), 0,
          'none of the runner''s links works any more');
select is((select count(*)::int from internal.live_link_runs r join t on r.token in (t.run_link, t.standing, t.friends)), 0,
          'and their shared runs and positions are deleted, as when the runner turns a link off');
select is((select count(*)::int from internal.live_positions p join t on p.token = t.other_link), 1, 'another runner''s live link is untouched');
select ok((select revoked_at is null from public.live_links l join t on l.token = t.other_link), 'and keeps working');
select is((select friends_live_mode from public.user_settings where user_id = '9b100000-0000-4000-8000-000000000001'), 'all',
          'sharing with friends stays on unless support asks to turn it off');
select is((select (details ->> 'reason', details ->> 'links_ended', details ->> 'friend_sharing_off', object_type)::text from internal.audit_log
            where action = 'end_live_links' and object_id = '9b100000-0000-4000-8000-000000000001' order by id desc limit 1),
          '("Runner reports a stranger has the link",3,false,profile)', 'the audit log records the reason and what was ended');
select is((select (category, kind, actor_id is null, data ->> 'friend_sharing_off')::text from public.notifications
            where user_id = '9b100000-0000-4000-8000-000000000001' and kind = 'live_links_ended'),
          '(system,live_links_ended,t,false)', 'the runner is told in the app what support did, without naming who');

set local role authenticated;
select pg_temp.as_user('9a200000-0000-4000-8000-000000000002');
select is(public.ops_end_live_links('9b100000-0000-4000-8000-000000000001', 'Turning off sharing with friends too', true),
          '{"links_ended": 0, "friend_sharing_off": true}'::jsonb, 'support can also turn off sharing with friends');
reset role;
select is((select friends_live_mode from public.user_settings where user_id = '9b100000-0000-4000-8000-000000000001'), 'off', 'it is off');
select is((select count(*)::int from public.notifications where user_id = '9b100000-0000-4000-8000-000000000001' and kind = 'live_links_ended'), 2,
          'and the runner is told');
set local role authenticated;
select pg_temp.as_user('9a200000-0000-4000-8000-000000000002');
select is(public.ops_end_live_links('9b100000-0000-4000-8000-000000000001', 'Checking nothing is left', true),
          '{"links_ended": 0, "friend_sharing_off": false}'::jsonb, 'with nothing left to end it changes nothing');
reset role;
select is((select count(*)::int from public.notifications where user_id = '9b100000-0000-4000-8000-000000000001' and kind = 'live_links_ended'), 2,
          'and sends no notice');
select is((select count(*)::int from internal.audit_log where action = 'end_live_links' and object_id = '9b100000-0000-4000-8000-000000000001'), 3,
          'every use is audited');
set local role authenticated;
select pg_temp.as_user('9a200000-0000-4000-8000-000000000002');
select is(public.ops_user_overview('9b100000-0000-4000-8000-000000000001') -> 'sharing' ->> 'friends_sharing', 'false', 'the runner page shows it');
select is(public.ops_overview() -> 'running' ->> 'live_links_now', '1', 'the Overview count drops');
select is(public.ops_overview() -> 'running' ->> 'friends_live_now', '0', 'for friends too');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.ops_end_live_links('9b200000-0000-4000-8000-000000000002', 'Not signed in at all', false)$$, '42501', null,
                 'nobody signed out can end live links');
reset role;
select ok(not has_function_privilege('anon', 'public.ops_end_live_links(uuid, text, boolean)', 'execute')
          and has_function_privilege('authenticated', 'public.ops_end_live_links(uuid, text, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'internal.live_sharing_status(uuid)', 'execute'),
          'only signed-in users reach the staff function, and nobody reaches the status helper directly');

-- Overview figures ---------------------------------------------------------------------------------------
insert into internal.route_snap_usage (user_id, day, requests) values
  ('9b100000-0000-4000-8000-000000000001', (now() at time zone 'utc')::date, 30),
  ('9b200000-0000-4000-8000-000000000002', (now() at time zone 'utc')::date, 12),
  ('9b100000-0000-4000-8000-000000000001', (date_trunc('month', now() at time zone 'utc') - interval '1 day')::date, 500)
on conflict (user_id, day) do update set requests = excluded.requests;
delete from internal.running_now_summary where scope = 'all' and key = '';
insert into internal.running_now_summary (scope, key, runners) values ('all', '', 7);
set local role authenticated;
select pg_temp.as_user('9a300000-0000-4000-8000-000000000003');
select is((public.ops_overview() -> 'running' -> 'route_snap_month')::int, 42, 'any staff member sees this month''s path-following requests');
select is((public.ops_overview() -> 'running' -> 'route_snap_alert')::int, 0, 'against the alert level, not set yet');
select is(public.ops_overview() -> 'running' -> 'running_now' ->> 'everywhere', '7', 'runners out right now, as runners see it');
reset role;
update internal.running_now_summary set runners = 3 where scope = 'all' and key = '';
set local role authenticated;
select pg_temp.as_user('9a300000-0000-4000-8000-000000000003');
select ok(public.ops_overview() -> 'running' -> 'running_now' -> 'everywhere' = 'null'::jsonb, 'and blank below the smallest count runners are shown');
reset role;

-- Route review queue ------------------------------------------------------------------------------------
insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms) values
  ('9d000000-0000-4000-8000-000000000001', '9b100000-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'processed', 8000, 3600000),
  ('9d000000-0000-4000-8000-000000000002', '9b200000-0000-4000-8000-000000000002', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'processed', 5000, 3000000);
insert into public.courses (id, region_id, creator_id, name) values
  ('9e000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '9b200000-0000-4000-8000-000000000002', 'Harbour line'),
  ('9e000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '9b200000-0000-4000-8000-000000000002', 'Far away loop');
insert into public.course_versions (id, course_id, version, path, length_m, closed, start_gate, finish_gate, start_bearing, finish_bearing, checkpoints, corridor_m) values
  ('9e000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 1, 'SRID=4326;LINESTRING(67.0000 24.8600, 67.0100 24.8600)', 1010, false,
   'SRID=4326;LINESTRING(67.0 24.8599, 67.0 24.8601)', 'SRID=4326;LINESTRING(67.01 24.8599, 67.01 24.8601)', 90, 90, '[]', 20),
  ('9e000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000003', 1, 'SRID=4326;LINESTRING(67.1000 24.9500, 67.1100 24.9500)', 1010, false,
   'SRID=4326;LINESTRING(67.1 24.9499, 67.1 24.9501)', 'SRID=4326;LINESTRING(67.11 24.9499, 67.11 24.9501)', 90, 90, '[]', 20);
update public.courses set current_version_id = '9e000000-0000-4000-8000-000000000002' where id = '9e000000-0000-4000-8000-000000000001';
update public.courses set current_version_id = '9e000000-0000-4000-8000-000000000004' where id = '9e000000-0000-4000-8000-000000000003';
insert into public.route_proposals (id, creator_id, source_activity_id, region_id, name, path, closed, length_m, course_geometry, consent_version,
                                    status, from_m, to_m, created_at) values
  ('9f000000-0000-4000-8000-000000000001', '9b100000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'Harbour stretch', 'SRID=4326;LINESTRING(67.0002 24.8602, 67.0150 24.8602)', false, 1500, '{"corridor_m": 20}', 'route-v1', 'pending_review', 1200, 2700,
   now() - interval '50 hours'),
  ('9f000000-0000-4000-8000-000000000002', '9b200000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
   'Park loop', 'SRID=4326;LINESTRING(67.0500 24.9000, 67.0600 24.9000, 67.0600 24.9100, 67.0500 24.9000)', true, 3300, '{"corridor_m": 20}', 'route-v1',
   'pending_review', null, null, now() - interval '2 hours');
set local role authenticated;
select pg_temp.as_user('9a300000-0000-4000-8000-000000000003');
select throws_ok($$select * from public.ops_route_queue(50)$$, '42501', null, 'the review queue needs the routes permission');
select pg_temp.as_user('9a400000-0000-4000-8000-000000000004');
select is((select array_agg(name order by created_at) from public.ops_route_queue(50)), array['Harbour stretch', 'Park loop'], 'reviewers see the oldest first');
select is((select (shape, from_m, to_m, over_target, waited_hours > 49)::text from public.ops_route_queue(50) where name = 'Harbour stretch'),
          '(a_to_b,1200,2700,t,t)', 'a start-to-finish route from part of a run, waiting past the target');
select is((select (shape, from_m is null, over_target)::text from public.ops_route_queue(50) where name = 'Park loop'), '(loop,t,f)',
          'a loop from a whole run, within the target');
select is((select (checks ->> 'protected_areas', checks ->> 'region', checks ->> 'target_hours')::text from public.ops_route_queue(50) where name = 'Harbour stretch'),
          '(passed,"Development region (Karachi test area)",48)', 'the quick checks say what the server already checked, never the protected areas');
select is((select (jsonb_array_length(checks -> 'nearby'), checks -> 'nearby' -> 0 ->> 'name', (checks -> 'nearby' -> 0 ->> 'distance_m')::int <= 100)::text
             from public.ops_route_queue(50) where name = 'Harbour stretch'),
          '(1,"Harbour line",t)', 'and list existing routes within 100 m, not ones further away');
select ok((select (checks ->> 'length_min_m')::float < length_m and length_m < (checks ->> 'length_max_m')::float from public.ops_route_queue(50) where name = 'Harbour stretch'),
          'with the length limits the proposal was checked against');
select is((public.ops_overview() -> 'queues' -> 'routes' ->> 'over_target')::int, 1, 'the Overview counts proposals past the target');
reset role;
select ok(not has_function_privilege('anon', 'public.ops_route_queue(integer)', 'execute') and has_function_privilege('authenticated', 'public.ops_route_queue(integer)', 'execute'),
          'the recreated queue keeps its grants');

-- Daily metrics on fixed data -----------------------------------------------------------------------------
-- Five days ago, so nothing made earlier in this file falls on the same day.
create temp table d as
  select (now() at time zone internal.analytics_tz())::date - 5 as day,
         (((now() at time zone internal.analytics_tz())::date - 5) + time '12:00') at time zone internal.analytics_tz() as noon;
grant select on d to authenticated;
insert into public.planned_routes (user_id, name, path, created_at, updated_at)
  select '9b100000-0000-4000-8000-000000000001', n, extensions.st_asencodedpolyline(extensions.st_setsrid(extensions.st_makeline(extensions.st_makepoint(67.0011, 24.8607),
         extensions.st_makepoint(67.0110, 24.8607)), 4326), 5), d.noon, d.noon
    from d, (values ('Morning'), ('Evening')) v(n);
insert into internal.route_snap_usage (user_id, day, requests)
  select u, d.day, r from d, (values ('9b100000-0000-4000-8000-000000000001'::uuid, 5), ('9b200000-0000-4000-8000-000000000002'::uuid, 7)) v(u, r);
insert into public.live_links (token, user_id, kind, created_at, expires_at, ended_at, views)
  select k || '-fixed-token-for-metrics-0000', '9b200000-0000-4000-8000-000000000002', kind, d.noon, d.noon + interval '6 hours', d.noon + interval '1 hour', views
    from d, (values ('run-a', 'run', 3), ('run-b', 'run', 0), ('friends-a', 'friends', 0)) v(k, kind, views);
insert into public.live_links (token, user_id, kind, created_at, views)
  select 'standing-fixed-token-for-metrics', '9b100000-0000-4000-8000-000000000001', 'standing', d.noon, 1 from d;
insert into internal.running_now_peaks (day, peak) select day, 9 from d;
insert into public.route_proposals (creator_id, source_activity_id, name, consent_version, status, closed, from_m, to_m, reviewed_by, created_at, decided_at)
  select '9b100000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', n, 'route-v1', st, cl, fm, tm, rv, d.noon - make_interval(hours => h), dec
    from d, (values
      ('Fixed stretch', 'pending_review', false, 100.0, 900.0, null::uuid, 0, null::timestamptz),
      ('Fixed whole', 'declined', null, null, null, null, 0, null)) v(n, st, cl, fm, tm, rv, h, dec);
update public.route_proposals rp set decided_at = d.noon from d where rp.name = 'Fixed whole';
insert into public.route_proposals (creator_id, source_activity_id, name, consent_version, status, closed, reviewed_by, created_at, decided_at)
  select '9b200000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000002', n, 'route-v1', st, true, rv, d.noon - make_interval(hours => h), d.noon
    from d, (values ('Reviewed fast', 'approved', '9a400000-0000-4000-8000-000000000004'::uuid, 10),
                    ('Reviewed slow', 'declined', '9a400000-0000-4000-8000-000000000004'::uuid, 30),
                    ('Job declined', 'declined', null, 1)) v(n, st, rv, h);
insert into public.gear (user_id, name, reminder_m, created_at)
  select '9b100000-0000-4000-8000-000000000001', n, 700000, d.noon from d, (values ('Daily trainers'), ('Racers')) v(n);
insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms, gear_id)
  select gen_random_uuid(), '9b100000-0000-4000-8000-000000000001', d.noon, d.noon + interval '40 minutes', 'processed', 6000, 2400000, g
    from d, (values ((select id from public.gear where name = 'Racers')), (null)) v(g);
insert into public.notifications (user_id, category, kind, object_type, data, created_at)
  select '9b100000-0000-4000-8000-000000000001', 'system', 'gear_reminder', 'gear', jsonb_build_object('percent', p), d.noon from d, (values (90), (100)) v(p);
select internal.refresh_metrics(day, day) from d;
create function pg_temp.metric(p text) returns double precision language sql as $$
  select value from internal.metrics_daily m join d on m.day = d.day where m.metric = p;
$$;
select is(pg_temp.metric('planned_routes_created'), 2::float, 'planned routes saved that day');
select is(pg_temp.metric('route_snap_requests'), 12::float, 'path-following requests, from the per-runner daily counts');
select is(pg_temp.metric('live_links_started'), 3::float, 'live links started, without the runs shared with friends');
select is(pg_temp.metric('live_links_opened'), 2::float, 'links started that day that were opened');
select is(pg_temp.metric('running_now_peak'), 9::float, 'the most runners out at once');
select is(pg_temp.metric('friends_live_runs'), 1::float, 'runs shared live with friends');
select is(pg_temp.metric('route_proposals_stretch'), 1::float, 'proposals from part of a run');
select is(pg_temp.metric('route_proposals_a_to_b'), 1::float, 'start-to-finish proposals');
select is(pg_temp.metric('route_review_hours_median'), 20::float, 'the median review time counts reviewers'' decisions, not the job''s');
select is(pg_temp.metric('gear_added'), 2::float, 'pairs of shoes added');
select is(pg_temp.metric('runs_with_gear'), 1::float, 'runs with shoes');
select is(pg_temp.metric('gear_reminders_sent'), 2::float, 'shoe reminders sent');
select is(pg_temp.metric('route_proposals'), 4::float, 'and the existing proposals metric stays the total (one was proposed the day before)');

-- Old days whose sources are purged keep their counts; the rest are recounted as before.
insert into internal.metrics_daily (day, metric, value) values
  ((now() at time zone 'utc')::date - 60, 'live_links_started', 5),
  ((now() at time zone 'utc')::date - 60, 'runs', 5),
  ((now() at time zone 'utc')::date - 60, 'route_snap_requests', 99);
insert into internal.route_snap_usage (user_id, day, requests) values ('9b100000-0000-4000-8000-000000000001', (now() at time zone 'utc')::date - 60, 4);
select internal.refresh_metrics((now() at time zone 'utc')::date - 60, (now() at time zone 'utc')::date - 60);
select is((select value from internal.metrics_daily where day = (now() at time zone 'utc')::date - 60 and metric = 'live_links_started'), 5::float,
          'live links deleted after 30 days do not wipe the count made while they were there');
select ok(not exists (select 1 from internal.metrics_daily where day = (now() at time zone 'utc')::date - 60 and metric = 'runs'), 'other metrics are recounted');
select is((select value from internal.metrics_daily where day = (now() at time zone 'utc')::date - 60 and metric = 'route_snap_requests'), 4::float,
          'path-following counts are kept 90 days, so a 60-day-old day is recounted');
select ok(internal.metric_kept('route_snap_requests', (now() at time zone 'utc')::date - 120) and not internal.metric_kept('runs', (now() at time zone 'utc')::date - 1000)
          and not internal.metric_kept('live_links_started', (now() at time zone 'utc')::date - 3), 'only purged sources keep their old days');

insert into internal.metrics_daily (day, metric, value) select day - 1, 'running_now_peak', 4 from d;
set local role authenticated;
select pg_temp.as_user('9a500000-0000-4000-8000-000000000005');
select is((select count(*)::int from jsonb_array_elements(public.ops_metrics((select day - 1 from d), (select day from d)) -> 'catalog') e
            where e ->> 'group' = 'Running tools' and char_length(e ->> 'description') > 10), 12, 'the console gets the twelve Running tools metrics, each described');
select is((public.ops_metrics((select day - 1 from d), (select day from d)) -> 'totals' ->> 'running_now_peak')::float, 9::float,
          'the range total of the busiest moment is the busiest day, not a sum');
select is((public.ops_metrics((select day - 1 from d), (select day from d)) -> 'totals' ->> 'route_snap_requests')::float, 12::float, 'counts are summed as before');
reset role;
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc where oid = 'internal.metric_catalog()'::regprocedure),
          'the metric catalog has a fixed search path');

-- The SQL editor cannot read any of the new private tables ----------------------------------------------
select is((select coalesce(string_agg(tbl, ', '), '') from unnest(array['public.planned_routes', 'public.live_links', 'internal.live_positions',
            'public.live_share_people', 'internal.running_now', 'public.gear', 'internal.route_snap_usage']) tbl
            where has_table_privilege('loopfield_sql_reader', tbl, 'select')), '', 'the SQL editor role has no read access to them');
set local role authenticated;
select pg_temp.as_user('9a500000-0000-4000-8000-000000000005');
select is((select coalesce(string_agg(tbl, ', '), '') from unnest(array['public.planned_routes', 'public.live_links', 'internal.live_positions',
            'public.live_share_people', 'internal.running_now', 'public.gear', 'internal.route_snap_usage']) tbl
            where coalesce(public.ops_sql_run('select count(*) from ' || tbl) ->> 'error', '') !~ '^permission denied'), '',
          'and a query in the SQL editor is refused for each of them');
reset role;

select * from finish();
rollback;
