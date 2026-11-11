-- 11 Nov enhancement release: movement integrity trail, appeals and reviewer clearing.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('a7100000-0000-4000-8000-000000000001', 'rider@example.test'),
  ('a7200000-0000-4000-8000-000000000002', 'other@example.test'),
  ('a7300000-0000-4000-8000-000000000003', 'reviewer@example.test');
insert into public.staff_roles (user_id, role) values ('a7300000-0000-4000-8000-000000000003', 'integrity_reviewer');

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

select * from finish();
rollback;
