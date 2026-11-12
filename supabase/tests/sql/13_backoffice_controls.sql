-- Back-office controls: RBAC and custom roles, game rule versions, settings and limits, support
-- conversations, runner management, analytics, preferences and the read-only SQL editor.
begin;
select plan(59);

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000001', 'admin@controls.test'),
  ('b2000000-0000-4000-8000-000000000002', 'support@controls.test'),
  ('b3000000-0000-4000-8000-000000000003', 'analyst@controls.test'),
  ('b4000000-0000-4000-8000-000000000004', 'runner@controls.test'),
  ('b5000000-0000-4000-8000-000000000005', 'runner2@controls.test'),
  ('b6000000-0000-4000-8000-000000000006', 'helpdesk@controls.test');
update public.profiles set handle = 'ctl_admin' where id = 'b1000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'trailhawk', bio = 'Runs a lot' where id = 'b4000000-0000-4000-8000-000000000004';
insert into public.staff_roles (user_id, role) values
  ('b1000000-0000-4000-8000-000000000001', 'admin'),
  ('b2000000-0000-4000-8000-000000000002', 'support'),
  ('b3000000-0000-4000-8000-000000000003', 'analyst');
-- Other test files may have left admins behind; this file needs to know who the admins are.
update public.staff_roles set revoked_at = now() where role = 'admin' and user_id <> 'b1000000-0000-4000-8000-000000000001' and revoked_at is null;

create function pg_temp.as_user(p uuid, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

-- RBAC ----------------------------------------------------------------------------------------
select ok(authz.has_role('b2000000-0000-4000-8000-000000000002', 'support') and authz.has_role('b2000000-0000-4000-8000-000000000002', 'users.view'),
          'the support role resolves to its permissions');
select ok(not authz.has_role('b2000000-0000-4000-8000-000000000002', 'moderator'), 'support does not imply moderation');
select ok(authz.has_role('b1000000-0000-4000-8000-000000000001', 'sql') and authz.has_role('b1000000-0000-4000-8000-000000000001', 'moderator'),
          'admin holds every permission');
select ok(not authz.has_role('b3000000-0000-4000-8000-000000000003', 'admin'), 'nobody but an admin passes the admin check');

set local role authenticated;
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003');
select ok(public.ops_whoami() -> 'permissions' @> '["analytics", "sql"]', 'whoami lists the analyst''s permissions');
select pg_temp.as_user('b2000000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_save_role('helpdesk', 'Helpdesk', 'Front line', array['users.view', 'staff'], 'Front-line helpers')$$, '42501', null,
                 'only admins edit roles');
select pg_temp.as_user('b1000000-0000-4000-8000-000000000001');
select lives_ok($$select public.ops_save_role('helpdesk', 'Helpdesk', 'Front line', array['users.view', 'staff'], 'Front-line helpers')$$, 'an admin creates a custom role');
select throws_ok($$select public.ops_save_role('helpdesk2', 'Bad', '', array['made_up'], 'Unknown permission')$$, '22023', null, 'unknown permissions are refused');
select ok((select bool_or(r ->> 'key' = 'helpdesk') from jsonb_array_elements(public.ops_rbac() -> 'roles') r), 'the roles screen lists the custom role');
select lives_ok($$select public.ops_grant_role('b6000000-0000-4000-8000-000000000006', 'helpdesk', true)$$, 'an admin grants the custom role');
select pg_temp.as_user('b6000000-0000-4000-8000-000000000006');
select throws_ok($$select public.ops_grant_role('b4000000-0000-4000-8000-000000000004', 'support', true)$$, '42501', null,
                 'staff cannot hand out permissions they do not hold');
select throws_ok($$select public.ops_grant_role('b4000000-0000-4000-8000-000000000004', 'admin', true)$$, '42501', null, 'only admins grant admin');
select lives_ok($$select public.ops_grant_role('b5000000-0000-4000-8000-000000000005', 'helpdesk', true)$$, 'staff can grant a role within their own permissions');
select pg_temp.as_user('b1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.ops_grant_role('b1000000-0000-4000-8000-000000000001', 'admin', false)$$, '42501', null, 'the last admin cannot be removed');
select throws_ok($$select public.ops_delete_role('helpdesk', 'No longer needed')$$, '22023', null, 'a role with members cannot be deleted');

-- Game rules ----------------------------------------------------------------------------------
select pg_temp.as_user('b2000000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_save_rules('territory', '{"minLoopLengthMeters": 600}', 'Shorter loops')$$, '42501', null, 'support cannot edit game rules');
select pg_temp.as_user('b1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.ops_save_rules('territory', '{"minLoopLengthMeters": 50}', 'Too short')$$, '22023', null, 'rule values are bounded');
select throws_ok($$select public.ops_save_rules('territory', '{"minLoopLengthMeters": 5000, "maxLoopLengthMeters": 4000}', 'Inverted')$$, '22023', null,
                 'the minimum loop must be shorter than the maximum');
create temp table saved as select public.ops_save_rules('territory', '{"minLoopLengthMeters": 600, "closureMaxGapMeters": 20}', 'Shorter loops for the pilot') ->> 'version' as v;
select matches((select v from saved), '^territory-.*\+ops\.\d+$', 'saving rules mints a new version');
select is((select r -> 'overrides' from jsonb_array_elements(public.ops_rules() -> 'versions') r where r ->> 'version' = (select v from saved)), '{"minLoopLengthMeters": 600}'::jsonb,
          'only values that differ from the defaults are stored');
select is(public.ops_save_rules('territory', '{"minLoopLengthMeters": 600}', 'Same again') ->> 'version', (select v from saved), 'identical values reuse the version');
select is((public.ops_rules() -> 'next' ->> 'territory'), (select v from saved), 'the new version is next season''s');
select is((public.game_rules() -> 'territory' ->> 'minLoopLengthMeters')::numeric, 1000::numeric, 'the running season keeps its rules');

reset role;
insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m, territory_rules_version, speed_rules_version)
values ('00000000-0000-4000-8000-000000000031', 99, now() + interval '60 days', now() + interval '88 days', 'scheduled', 11, 10,
        'territory-2026.11.0-proposed', 'speed-2026.11.0-proposed');
select is((select territory_rules_version from public.seasons where number = 99), (select v from saved), 'a new season starts on the next version');
select is((select late_upload_hours from public.seasons where number = 99), 24::smallint, 'a new season copies the season timings');
set local role authenticated;

select pg_temp.as_user('b2000000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_apply_rules_now('territory', (select v from saved), 'Now please')$$, '42501', null, 'support cannot apply rules now');
select pg_temp.as_user('b1000000-0000-4000-8000-000000000001');
select ok(public.ops_apply_rules_now('territory', (select v from saved), 'Pilot needs shorter loops now') >= 1, 'applying now moves running seasons');
select is((public.game_rules() -> 'territory' ->> 'minLoopLengthMeters')::numeric, 600::numeric, 'the app now reads the new minimum');

-- Settings and limits -------------------------------------------------------------------------
select throws_ok($$select public.ops_set_config('rate_limits', '{"nope": 2}', 'Unknown action')$$, '22023', null, 'unknown rate-limit actions are refused');
select throws_ok($$select public.ops_set_config('rate_limits', '{"post": 0}', 'Zero posts')$$, '22023', null, 'limits are at least 1');
select lives_ok($$select public.ops_set_config('rate_limits', '{"post": 2}', 'Spam wave')$$, 'an admin lowers the post limit');
select throws_ok($$select public.ops_set_config('share_map_min_distance_m', '100', 'Too low')$$, '22023', null, 'the share-map minimum has a floor');
select throws_ok($$select public.ops_set_config('integrity_overrides', '{"envelopeMargin": 2}', 'Too loose')$$, '22023', null,
                 'cheat-detection tuning keeps the engine''s bounds');
select lives_ok($$select public.ops_set_config('comments_enabled', 'false', 'Comment spam')$$, 'comments can be switched off');
select lives_ok($$select public.ops_set_config('post_max_chars', '100', 'Short posts for the test')$$, 'post length is configurable');
reset role;
select lives_ok($$select internal.enforce_rate_limit('ctl-subject', 'post', 10, 3600); select internal.enforce_rate_limit('ctl-subject', 'post', 10, 3600)$$,
                'the lowered limit allows two posts');
select throws_ok($$select internal.enforce_rate_limit('ctl-subject', 'post', 10, 3600)$$, 'P0429', null, 'the third post hits the limit from App control');
select throws_ok($$select internal.enforce_rate_limit('ctl-subject', 'comment', 60, 3600)$$, '55000', null, 'the comments switch stops new comments');
select throws_ok($$insert into public.posts (author_id, audience, body) values ('b4000000-0000-4000-8000-000000000004', 'public', repeat('x', 150))$$, '22001', null,
                 'posts longer than the setting are refused');
set local role authenticated;

-- Support ---------------------------------------------------------------------------------------
select pg_temp.as_user('b4000000-0000-4000-8000-000000000004');
create temp table tk as select public.support_create('bug', 'App closes on the map', 'It closes when I open the map', '{}', '1.4.0', 'ios', 'iPhone 15') as id;
select pg_temp.as_user('b5000000-0000-4000-8000-000000000005');
select is((select count(*) from public.support_tickets), 0::bigint, 'runners cannot see other runners'' conversations');
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003');
select throws_ok($$select public.ops_support_queue('open')$$, '42501', null, 'the support inbox needs the support permission');
select pg_temp.as_user('b2000000-0000-4000-8000-000000000002');
select ok((select bool_or((i ->> 'id')::uuid = (select id from tk)) from jsonb_array_elements(public.ops_support_queue('open') -> 'items') i), 'support sees the new conversation');
select lives_ok($$select public.ops_support_reply((select id from tk), 'Thanks, we are looking at it', false, null)$$, 'support replies');
select lives_ok($$select public.ops_support_reply((select id from tk), 'Probably the map SDK', true, null)$$, 'support adds an internal note');
reset role;
select ok(exists (select 1 from public.notifications where user_id = 'b4000000-0000-4000-8000-000000000004' and kind = 'support_reply'), 'the runner is notified of the reply');
select is((select status from public.support_tickets where id = (select id from tk)), 'pending', 'a reply waits on the runner');
set local role authenticated;
select pg_temp.as_user('b4000000-0000-4000-8000-000000000004');
select is(jsonb_array_length(public.support_thread((select id from tk)) -> 'messages'), 2, 'the runner sees the reply but not the internal note');
select lives_ok($$select public.support_reply((select id from tk), 'Still closing')$$, 'the runner answers');
reset role;
select is((select status from public.support_tickets where id = (select id from tk)), 'open', 'a runner reply reopens the conversation');
set local role authenticated;

-- Runners ---------------------------------------------------------------------------------------
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003');
select throws_ok($$select public.ops_users_list(null)$$, '42501', null, 'the directory needs users.view');
select pg_temp.as_user('b2000000-0000-4000-8000-000000000002');
select ok((select bool_or(i ->> 'handle' = 'trailhawk') from jsonb_array_elements(public.ops_users_list('trail') -> 'items') i), 'support finds a runner by handle');
select throws_ok($$select public.ops_set_user_status('b4000000-0000-4000-8000-000000000004', 'suspended', 'Spamming runners')$$, '42501', null,
                 'suspending needs users.manage');
select pg_temp.as_user('b1000000-0000-4000-8000-000000000001');
select lives_ok($$select public.ops_set_user_status('b4000000-0000-4000-8000-000000000004', 'suspended', 'Spamming runners')$$, 'an admin suspends a runner');
select is((public.ops_user_overview('b4000000-0000-4000-8000-000000000004') -> 'profile' ->> 'status'), 'suspended', 'the runner profile shows the suspension');

-- Analytics, preferences and SQL ----------------------------------------------------------------
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003');
select is(jsonb_array_length(public.ops_metrics(current_date - 6, current_date) -> 'series' -> 'runs'), 7, 'metrics return one value per day');
select lives_ok($$select public.ops_set_preference('overview_widgets', '["runs", "queues"]')$$, 'staff save their Overview layout');
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003', 'aal1');
select throws_ok($$select public.ops_sql_run('select 1')$$, '42501', null, 'the SQL editor needs an MFA-verified session');
select pg_temp.as_user('b3000000-0000-4000-8000-000000000003');
select is(public.ops_sql_run('select count(*) as n from runners where handle = ''trailhawk''') -> 'rows', '[[1]]'::jsonb, 'the SQL editor reads the curated views');
select matches(public.ops_sql_run('select * from public.profiles') ->> 'error', '^permission denied', 'the SQL editor cannot read the raw tables');

select * from finish();
rollback;
