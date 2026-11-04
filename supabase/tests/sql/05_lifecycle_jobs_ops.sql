-- Jobs, account lifecycle, appeals, rate limits and scoped operator actions (FR09, FR16, FR23, FR24, FR44).
begin;
select plan(24);

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-000000000001', 'runner@example.test'),
  ('f0000000-0000-4000-8000-000000000002', 'mod@example.test');
insert into public.staff_roles (user_id, role) values ('f0000000-0000-4000-8000-000000000002', 'moderator');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Jobs ------------------------------------------------------------------------------------
select is(internal.enqueue_job('media', 'x', '{"a":1}', 'dup-key'), internal.enqueue_job('media', 'x', '{"a":2}', 'dup-key'), 'dedupe key collapses duplicate enqueues');
select is((select count(*)::int from internal.claim_jobs('w1', array['media'], 10)), 1, 'worker claims the ready job');
select is((select count(*)::int from internal.claim_jobs('w2', array['media'], 10)), 0, 'claimed job is not handed to a second worker');
select lives_ok($$select internal.fail_job((select id from internal.jobs where dedupe_key = 'dup-key'), 'w1', 'boom')$$, 'failure is recorded');
select ok((select run_at > now() and status = 'queued' from internal.jobs where dedupe_key = 'dup-key'), 'failed job is retried later with backoff');
update internal.jobs set run_at = now() - interval '1 second', attempts = max_attempts - 1 where dedupe_key = 'dup-key';
select is((select count(*)::int from internal.claim_jobs('w1', array['media'], 10)), 1, 'retry is claimable once due');
select lives_ok($$select internal.fail_job((select id from internal.jobs where dedupe_key = 'dup-key'), 'w1', 'boom again')$$, 'final failure');
select is((select status from internal.jobs where dedupe_key = 'dup-key'), 'dead', 'job dead-letters after max attempts');
select is(internal.check_rate_limit('subject', 'act', 2, 3600) and internal.check_rate_limit('subject', 'act', 2, 3600), true, 'rate limit allows up to the limit');
select is(internal.check_rate_limit('subject', 'act', 2, 3600), false, 'rate limit rejects beyond the limit');

-- Activity deletion withdraws shared summaries and schedules dependent recomputation ----------
insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms)
values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '1 hour', 'processed', 5000, 1800000);
set local role authenticated; select pg_temp.as_user('e0000000-0000-4000-8000-000000000001');
create temp table p as select (public.create_post('followers', 'Morning run', null, 'e1000000-0000-4000-8000-000000000001', array['distance', 'duration']) ->> 'post_id')::uuid id;
select is((select shared_summary ->> 'distance_m' from public.posts where id = (select id from p)), '5000', 'shared fields are copied from the server record');
select lives_ok($$select public.delete_activity('e1000000-0000-4000-8000-000000000001')$$, 'owner deletes the activity');
select is((select shared_summary from public.posts where id = (select id from p)), null, 'deleting the run withdraws the shared summary');
select is((select count(*)::int from public.activities where id = 'e1000000-0000-4000-8000-000000000001'), 0, 'deleted activity disappears from the owner''s history');
reset role;
select is((select count(*)::int from internal.jobs where kind = 'delete_activity'), 1, 'dependent claim/attempt replay is queued');

-- Consent withdrawal -----------------------------------------------------------------------
set local role authenticated; select pg_temp.as_user('e0000000-0000-4000-8000-000000000001');
select public.set_consent('territory_competition', true, 'v1');
select public.set_consent('territory_competition', false, 'v1');
reset role;
select is((select count(*)::int from internal.jobs where kind = 'withdraw_competition'), 1, 'withdrawing contest consent queues result withdrawal');

-- Operator scope ---------------------------------------------------------------------------
set local role authenticated; select pg_temp.as_user('e0000000-0000-4000-8000-000000000001');
select throws_ok($$select * from public.ops_moderation_queue()$$, '42501', null, 'non-staff cannot open the moderation queue');
select throws_ok($$select public.ops_set_switch('territory_capture_enabled', 'false')$$, '42501', null, 'non-staff cannot flip kill switches');
create temp table r as select public.submit_report('post', (select id from p)::text, 'spam', 'test') id;
reset role;
set local role authenticated; select pg_temp.as_user('f0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.ops_moderation_queue()), 1, 'moderator sees the open case');
select throws_ok($$select public.ops_replay_season('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041')$$, '42501', null, 'a moderator has no scoring powers');
select lives_ok($$select public.ops_moderate((select id from public.moderation_cases limit 1), 'remove_content', 'spam')$$, 'moderator removes the post');
reset role;
select is((select status from public.posts where id = (select id from p)), 'removed', 'post removed');
select ok((select count(*) > 0 from internal.audit_log where action = 'moderation_remove_content'), 'moderation action is audited');

-- Account deletion hides public identity immediately ---------------------------------------
set local role authenticated; select pg_temp.as_user('e0000000-0000-4000-8000-000000000001');
select public.request_account_deletion('DELETE');
reset role;
select is((select status from public.profiles where id = 'e0000000-0000-4000-8000-000000000001'), 'deleted', 'profile marked deleted and hidden at once; the job removes the rest');

select * from finish();
rollback;
