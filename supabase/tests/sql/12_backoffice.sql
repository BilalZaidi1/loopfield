-- Back-office RPCs: config registry and validation, history and audit, MFA gate, overview, user
-- search, staff list, dead-job retry, appeals and the audit log.
begin;
select plan(44);

-- Supabase provides these; the local shim may not.
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null);
alter table auth.users add column if not exists last_sign_in_at timestamptz;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'admin@backoffice.test'),
  ('a2000000-0000-4000-8000-000000000002', 'operator@backoffice.test'),
  ('a3000000-0000-4000-8000-000000000003', 'moderator@backoffice.test'),
  ('a4000000-0000-4000-8000-000000000004', 'support@backoffice.test'),
  ('a5000000-0000-4000-8000-000000000005', 'runner@backoffice.test'),
  ('a6000000-0000-4000-8000-000000000006', 'integrity@backoffice.test');
update public.profiles set handle = 'ops_admin' where id = 'a1000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'trailfox' where id = 'a5000000-0000-4000-8000-000000000005';
insert into public.staff_roles (user_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'admin'),
  ('a2000000-0000-4000-8000-000000000002', 'territory_operator'),
  ('a3000000-0000-4000-8000-000000000003', 'moderator'),
  ('a4000000-0000-4000-8000-000000000004', 'support'),
  ('a6000000-0000-4000-8000-000000000006', 'integrity_reviewer');
insert into auth.mfa_factors (user_id, status) values ('a1000000-0000-4000-8000-000000000001', 'verified');

create function pg_temp.as_user(p uuid, aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

-- Gates -------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a5000000-0000-4000-8000-000000000005');
select throws_ok($$select public.ops_overview()$$, '42501', null, 'non-staff cannot open the overview');
select throws_ok($$select * from public.ops_config()$$, '42501', null, 'non-staff cannot read settings through the console');
select is(public.ops_whoami() -> 'roles', '[]'::jsonb, 'whoami reports no roles for a runner');
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001');
select is(public.ops_whoami() -> 'roles', '["admin"]'::jsonb, 'whoami reports the admin role');
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003');
select ok(public.ops_overview() ? 'queues', 'any staff member can open the overview');
select is((select can_edit from public.ops_config() where key = 'paywall_enabled'), false, 'a moderator sees the paywall but cannot edit it');

-- Settings ----------------------------------------------------------------------------------
select pg_temp.as_user('a2000000-0000-4000-8000-000000000002');
select lives_ok($$select public.ops_set_config('territory_capture_enabled', 'false', 'Pausing capture for a test')$$, 'operator flips a kill switch with a reason');
reset role;
select is((select value from public.app_config where key = 'territory_capture_enabled'), 'false'::jsonb, 'switch value updated');
select is((select count(*)::int from internal.config_history where key = 'territory_capture_enabled'), 1, 'change recorded in history');
select is((select count(*)::int from internal.audit_log where action = 'config_changed' and object_id = 'territory_capture_enabled'), 1, 'change written to the audit log');
set local role authenticated;
select pg_temp.as_user('a2000000-0000-4000-8000-000000000002');
select throws_ok($$select public.ops_set_config('paywall_enabled', 'true', 'Trying to sell things')$$, '42501', null, 'an operator cannot change admin settings');
select throws_ok($$select public.ops_set_config('territory_capture_enabled', 'true', 'ok')$$, '22023', null, 'a short reason is refused');
select throws_ok($$select public.ops_set_config('territory_capture_enabled', '"yes"', 'Wrong type on purpose')$$, '22023', null, 'a switch only takes true or false');
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.ops_set_config('min_supported_app_version', '"1.2"', 'Bad version string')$$, '22023', null, 'versions must look like 1.2.3');
select lives_ok($$select public.ops_set_config('min_supported_app_version', '"0.2.0"', 'Raising the floor')$$, 'admin raises the minimum version');
select throws_ok($$select public.ops_set_config('premium_features', '["territory"]', 'Gating core land capture')$$, '22023', null, 'core features can never be premium');
select lives_ok($$select public.ops_set_config('premium_features', '["route_insights"]', 'Extra insights for premium')$$, 'a non-core feature can be premium');
select throws_ok($$select public.ops_set_config('maintenance_mode', '{"enabled": true, "message": null, "until": null}', 'Going down for upgrade')$$, '22023', null, 'maintenance needs a message for users');
select lives_ok($$select public.ops_set_config('maintenance_mode', '{"enabled": true, "message": "Back at 3pm", "until": "2026-12-01T10:00:00Z"}', 'Going down for upgrade')$$, 'maintenance mode turns on with a message');
select public.ops_set_config('min_supported_app_version', '"0.2.0"', 'Same value again');
reset role;
select is((select count(*)::int from internal.config_history where key = 'min_supported_app_version'), 1, 'an unchanged value adds no history');
set local role authenticated;
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.ops_set_config('no_such_setting', 'true', 'Does not exist')$$, '22023', null, 'unknown settings are refused');
select pg_temp.as_user('a2000000-0000-4000-8000-000000000002');
select lives_ok($$select public.ops_set_switch('speed_titles_enabled', 'false')$$, 'the app''s switch screen still works');
select throws_ok($$select public.ops_set_switch('speed_titles_enabled', '"off"')$$, '22023', null, 'the app''s switch screen checks the value type');
reset role;
select is((select count(*)::int from internal.config_history where key = 'speed_titles_enabled'), 1, 'switches changed in the app are recorded in history');
set local role authenticated;
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.ops_config_history('territory_capture_enabled')), 1, 'staff can read the change history');

-- MFA gate ----------------------------------------------------------------------------------
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001', 'aal2');
select lives_ok($$select public.ops_set_config('ops_require_mfa', 'true', 'Enforcing MFA for staff')$$, 'admin turns on the MFA requirement');
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003', 'aal1');
select throws_ok($$select public.ops_overview()$$, '42501', null, 'without MFA, staff calls are refused');
select throws_ok($$select * from public.ops_moderation_queue()$$, '42501', null, 'the existing operator API is covered too');
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003', 'aal2');
select lives_ok($$select public.ops_overview()$$, 'with MFA, staff calls work');
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001', 'aal2');
select public.ops_set_config('ops_require_mfa', 'false', 'Back off for the rest of the tests');

-- User search -------------------------------------------------------------------------------
select pg_temp.as_user('a4000000-0000-4000-8000-000000000004');
select is((select matched_by from public.ops_users_search('trail')), 'handle', 'support finds a runner by handle');
select is((select handle from public.ops_users_search('runner@backoffice.test')), 'trailfox', 'support finds a runner by exact email');
reset role;
select is((select count(*)::int from internal.audit_log where action = 'user_email_lookup'), 1, 'email lookups are audited');
set local role authenticated;
select pg_temp.as_user('a2000000-0000-4000-8000-000000000002');
select throws_ok($$select * from public.ops_users_search('trail')$$, '42501', null, 'a territory operator cannot search users');

-- Staff, audit log and jobs -----------------------------------------------------------------
select throws_ok($$select * from public.ops_audit_log()$$, '42501', null, 'only admins read the audit log');
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001');
select ok((select count(*) from public.ops_audit_log()) > 0, 'admin reads the audit log');
select is((select count(*)::int from public.ops_staff_list()), 5, 'staff list has every active staff member');
select is((select mfa_enabled from public.ops_staff_list() where handle = 'ops_admin'), true, 'staff list shows MFA status');
reset role;
insert into internal.jobs (queue, kind, dedupe_key, status, updated_at) values
  ('media', 'x', 'dk1', 'dead', now() - interval '2 hours'),
  ('media', 'x', 'dk1', 'dead', now() - interval '1 hour'),
  ('media', 'x', 'dk2', 'queued', now()),
  ('media', 'x', 'dk2', 'dead', now()),
  ('email', 'y', null, 'dead', now());
set local role authenticated;
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003');
select throws_ok($$select public.ops_retry_dead_jobs()$$, '42501', null, 'only admins retry jobs');
select pg_temp.as_user('a1000000-0000-4000-8000-000000000001');
select is(public.ops_retry_dead_jobs(), 2, 'retry requeues the newest copy and skips jobs already queued');

-- Appeals -----------------------------------------------------------------------------------
reset role;
insert into public.appeals (user_id, object_type, object_id, reason) values
  ('a5000000-0000-4000-8000-000000000005', 'post', gen_random_uuid(), 'Please review this removal'),
  ('a5000000-0000-4000-8000-000000000005', 'account_action', 'a5000000-0000-4000-8000-000000000005', 'I was suspended by mistake'),
  ('a5000000-0000-4000-8000-000000000005', 'loop_claim', gen_random_uuid(), 'My loop was valid, honestly');
update public.profiles set status = 'suspended' where id = 'a5000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.ops_appeals_queue('open')), 2, 'moderators see content and account appeals');
select pg_temp.as_user('a6000000-0000-4000-8000-000000000006');
select is((select track from public.ops_appeals_queue('open')), 'competitive', 'integrity reviewers see competitive appeals');
select pg_temp.as_user('a3000000-0000-4000-8000-000000000003');
select throws_ok($$select public.ops_decide_account_appeal((select id from public.ops_appeals_queue('open') where object_type = 'account_action'), true, 'ok')$$,
  '22023', null, 'an appeal decision needs a written response');
select lives_ok($$select public.ops_decide_account_appeal((select id from public.ops_appeals_queue('open') where object_type = 'account_action'), true, 'Reinstated after review')$$,
  'moderator overturns an account appeal');
reset role;
select is((select status from public.profiles where id = 'a5000000-0000-4000-8000-000000000005'), 'active', 'overturning reinstates the account');

select * from finish();
rollback;
