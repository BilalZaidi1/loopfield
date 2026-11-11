-- Notifications and email: land items after publication (one per run, never naming the rival, losses not
-- pushed, contested land), friends' runs, new members, announcements, season results, the email outbox
-- (preferences, dedupe, invitation cap, welcome on confirmation, event registration) and unsubscribe.
begin;
select plan(34);

insert into auth.users (id, email) values
  ('a1010000-0000-4000-8000-000000000001', 'held@example.test'),
  ('a1020000-0000-4000-8000-000000000002', 'taker@example.test'),
  ('a1030000-0000-4000-8000-000000000003', 'second@example.test'),
  ('a1040000-0000-4000-8000-000000000004', 'quiet@example.test'),
  ('a1050000-0000-4000-8000-000000000005', 'quiettaker@example.test'),
  ('a1060000-0000-4000-8000-000000000006', 'owner@example.test'),
  ('a1070000-0000-4000-8000-000000000007', 'member@example.test'),
  ('a1080000-0000-4000-8000-000000000008', 'friend@example.test'),
  ('a1090000-0000-4000-8000-000000000009', 'follower@example.test'),
  ('a1100000-0000-4000-8000-000000000010', 'operator@example.test');
insert into public.staff_roles (user_id, role) values ('a1100000-0000-4000-8000-000000000010', 'territory_operator');
update public.user_settings set territory_competition_enabled = true;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.n(p_user uuid, p_kind text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and kind = p_kind;
$$;

-- ---- Land notifications ------------------------------------------------------------------------
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
-- A race run, carried into the all-time map, evaluated the way the job does it.
create function pg_temp.loop(p_user uuid, p_started timestamptz, p_ring jsonb) returns uuid language plpgsql as $$
declare v_act uuid := gen_random_uuid(); v_claim uuid; r record;
begin
  insert into public.activities (id, user_id, started_at, ended_at, status, competition_id, season_id)
  values (v_act, p_user, p_started, p_started + interval '30 minutes', 'processing', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041');
  insert into public.loop_claims (activity_id, user_id, competition_id, season_id, rule_version, received_at)
  values (v_act, p_user, '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 'territory-test', now()) returning id into v_claim;
  perform internal.derive_layer_claims(v_claim);
  for r in select id from public.loop_claims where (id = v_claim or parent_claim_id = v_claim) and status = 'processing' order by parent_claim_id nulls first loop
    update public.loop_claims set completed_at = p_started + interval '30 minutes' where id = r.id;
    if (internal.evaluate_claim_geometry(r.id, p_ring, pg_temp.cells())).status = 'eligible' then perform internal.apply_claim(r.id); end if;
  end loop;
  return v_claim;
end $$;
update public.notification_prefs set territory_loss = false where user_id = 'a1040000-0000-4000-8000-000000000004';

select pg_temp.loop('a1010000-0000-4000-8000-000000000001', now() - interval '4 hours', pg_temp.ring(0, 4, 0, 4));
select pg_temp.loop('a1040000-0000-4000-8000-000000000004', now() - interval '4 hours', pg_temp.ring(8, 9, 0, 4));
select pg_temp.loop('a1020000-0000-4000-8000-000000000002', now() - interval '3 hours', pg_temp.ring(3, 6, 0, 4));
select pg_temp.loop('a1030000-0000-4000-8000-000000000003', now() - interval '2 hours', pg_temp.ring(0, 1, 0, 4));
select pg_temp.loop('a1050000-0000-4000-8000-000000000005', now() - interval '2 hours', pg_temp.ring(8, 9, 0, 4));
select ok(internal.publish_due_territory(500) >= 10, 'every run is published on the race and the all-time map');

select is((select (data -> 'layers' -> 0 ->> 'kind') || ':' || (data -> 'layers' -> 0 ->> 'cells') || ':' || object_type
             from public.notifications where user_id = 'a1020000-0000-4000-8000-000000000002' and kind = 'territory_captured'),
          'permanent:20:activity', 'the runner hears what their run captured on the all-time map, linked to the run');
select is((select (data -> 'layers' -> 0 ->> 'taken')::int from public.notifications where user_id = 'a1020000-0000-4000-8000-000000000002' and kind = 'territory_captured'), 10,
          'including how many cells came from other runners');
select is((select push_state from public.notifications where user_id = 'a1020000-0000-4000-8000-000000000002' and kind = 'territory_captured'), 'pending',
          'your own result can be pushed');
select is(pg_temp.n('a1020000-0000-4000-8000-000000000002', 'territory_captured'), 1, 'one item per run, not one per layer');
select is(pg_temp.n('a1010000-0000-4000-8000-000000000001', 'territory_lost'), 1, 'the first runner to lose land hears it changed hands');
select is(pg_temp.n('a1010000-0000-4000-8000-000000000001', 'territory_contested'), 1, 'when a second runner takes cells in the window, the land is contested');
select ok((select bool_and(actor_id is null and push_state = 'not_applicable') from public.notifications
            where user_id = 'a1010000-0000-4000-8000-000000000001' and kind in ('territory_lost', 'territory_contested')),
          'land losses never name the other runner and are never pushed one by one');
select is((select data ->> 'runners' from public.notifications where user_id = 'a1010000-0000-4000-8000-000000000001' and kind = 'territory_contested'), '2',
          'the contested item says how many runners');
select is((select data ->> 'district' from public.notifications where user_id = 'a1020000-0000-4000-8000-000000000002' and kind = 'territory_captured'), 'Dev North',
          'items name the district, not a street or a point');
select is(pg_temp.n('a1040000-0000-4000-8000-000000000004', 'territory_lost') + pg_temp.n('a1040000-0000-4000-8000-000000000004', 'territory_contested'), 0,
          'runners who turned off land-loss notifications get none');

-- ---- Season results ------------------------------------------------------------------------------
update public.seasons set status = 'settled', settled_at = now() where id = '00000000-0000-4000-8000-000000000041';
select is((select string_agg((data ->> 'rank') || '/' || (data ->> 'runners'), ',' order by data ->> 'rank') from public.notifications
            where kind = 'season_finished' and user_id in ('a1010000-0000-4000-8000-000000000001', 'a1020000-0000-4000-8000-000000000002', 'a1030000-0000-4000-8000-000000000003')),
          '1/4,2/4,4/4', 'everyone who held land in the season race hears where they finished');
select ok(exists (select 1 from internal.email_outbox where template = 'season_results' and user_id = 'a1020000-0000-4000-8000-000000000002'),
          'and gets the results by email (events emails are on by default)');

-- ---- Communities ----------------------------------------------------------------------------------
create temp table k (club uuid);
grant select, update, insert on k to authenticated;
insert into k values (null);
set local role authenticated;
select pg_temp.as_user('a1060000-0000-4000-8000-000000000006');
update k set club = public.create_club('community', 'Harbour Striders', 'public', 'open');
reset role;
select is(pg_temp.n('a1060000-0000-4000-8000-000000000006', 'club_member_joined'), 0, 'creating a community is not a join');
insert into public.club_memberships (club_id, user_id, role, state) values ((select club from k), 'a1070000-0000-4000-8000-000000000007', 'member', 'active');
select is(pg_temp.n('a1060000-0000-4000-8000-000000000006', 'club_member_joined'), 1, 'the owner hears when someone joins');
insert into public.posts (author_id, audience, club_id, body, is_announcement, status, published_at)
values ('a1060000-0000-4000-8000-000000000006', 'club', (select club from k), 'Saturday long run at 6', true, 'published', now());
select is((select data ->> 'club_name' from public.notifications where user_id = 'a1070000-0000-4000-8000-000000000007' and kind = 'club_announcement'), 'Harbour Striders',
          'members hear about announcements');
select is(pg_temp.n('a1060000-0000-4000-8000-000000000006', 'club_announcement'), 0, 'the author is not told about their own announcement');

-- ---- Friends' runs ---------------------------------------------------------------------------------
insert into public.follows (follower_id, followee_id, state, accepted_at) values
  ('a1080000-0000-4000-8000-000000000008', 'a1020000-0000-4000-8000-000000000002', 'accepted', now()),
  ('a1020000-0000-4000-8000-000000000002', 'a1080000-0000-4000-8000-000000000008', 'accepted', now()),
  ('a1090000-0000-4000-8000-000000000009', 'a1020000-0000-4000-8000-000000000002', 'accepted', now());
insert into public.posts (author_id, audience, activity_id, status, published_at)
select 'a1020000-0000-4000-8000-000000000002', 'followers', a.id, 'published', now() from public.activities a where a.user_id = 'a1020000-0000-4000-8000-000000000002' limit 1;
select is(pg_temp.n('a1080000-0000-4000-8000-000000000008', 'friend_run'), 1, 'a friend (mutual follow) hears about a shared run');
select is(pg_temp.n('a1090000-0000-4000-8000-000000000009', 'friend_run'), 0, 'a one-way follower sees it in the feed but is not notified');
select is((select push_state from public.notifications where user_id = 'a1080000-0000-4000-8000-000000000008' and kind = 'friend_run'), 'pending',
          'it is queued for push, where preferences decide (off unless the friend turned it on)');

-- ---- Email outbox --------------------------------------------------------------------------------
select ok(not internal.enqueue_email('a1010000-0000-4000-8000-000000000001', 'run_summary', '{"activity_id": "x"}', 'runsum:test'),
          'run summaries are off unless chosen');
update public.notification_prefs set email_runs = true where user_id = 'a1010000-0000-4000-8000-000000000001';
select ok(internal.enqueue_email('a1010000-0000-4000-8000-000000000001', 'run_summary', '{"activity_id": "x"}', 'runsum:test'), 'once chosen, the summary is queued');
select ok(not internal.enqueue_email('a1010000-0000-4000-8000-000000000001', 'run_summary', '{"activity_id": "x"}', 'runsum:test'), 'the same email is never queued twice');
select is((select count(*)::int from internal.jobs where queue = 'email' and kind = 'send_email' and payload ->> 'key' = 'runsum:test'), 1, 'one send job, no address in it');

-- Invitations email the invitee, a few a day at most
set local role authenticated;
select pg_temp.as_user('a1060000-0000-4000-8000-000000000006');
select public.invite_to_club((select club from k), 'a1090000-0000-4000-8000-000000000009');
reset role;
select is((select count(*)::int from internal.email_outbox where user_id = 'a1090000-0000-4000-8000-000000000009' and template = 'club_invite'), 1, 'an invitation is emailed');
update public.app_config set value = '1'::jsonb where key = 'invite_emails_per_day';
set local role authenticated;
select pg_temp.as_user('a1070000-0000-4000-8000-000000000007');
update k set club = public.create_club('group', 'Tuesday Crew', 'private', 'invite_only');
select public.invite_to_club((select club from k), 'a1090000-0000-4000-8000-000000000009');
reset role;
select is((select count(*)::int from internal.email_outbox where user_id = 'a1090000-0000-4000-8000-000000000009' and template = 'club_invite'), 1,
          'past the daily cap, invitations stay in the app');
select is(pg_temp.n('a1090000-0000-4000-8000-000000000009', 'club_invite'), 2, 'both invitations are in the app');

-- Unsubscribe links
select ok(internal.email_unsubscribe(internal.email_token('a1090000-0000-4000-8000-000000000009'), 'clubs'), 'the link in the email works without signing in');
select is((select email_clubs from public.notification_prefs where user_id = 'a1090000-0000-4000-8000-000000000009'), false, 'and switches that category off');
select ok(not internal.email_unsubscribe('not-a-real-token-at-all', 'clubs') and not internal.email_unsubscribe(internal.email_token('a1090000-0000-4000-8000-000000000009'), 'account'),
          'unknown links fail, and account email cannot be switched off');
select ok(not internal.enqueue_email('a1090000-0000-4000-8000-000000000009', 'club_invite', '{}', 'after-unsubscribe'), 'nothing more of that kind is queued');

-- Welcome once the address is confirmed
insert into auth.users (id, email) values ('a1110000-0000-4000-8000-000000000011', 'new@example.test');
select is((select count(*)::int from internal.email_outbox where user_id = 'a1110000-0000-4000-8000-000000000011'), 0, 'no welcome before the address is confirmed');
update auth.users set email_confirmed_at = now() where id = 'a1110000-0000-4000-8000-000000000011';
update auth.users set email_confirmed_at = now() + interval '1 minute' where id = 'a1110000-0000-4000-8000-000000000011';
select is((select count(*)::int from internal.email_outbox where user_id = 'a1110000-0000-4000-8000-000000000011' and template = 'welcome'), 1, 'one welcome after confirming');

-- Joining an event is confirmed by email once
create temp table ev (id uuid);
grant select, insert, update on ev to authenticated;
insert into ev values (null);
set local role authenticated;
select pg_temp.as_user('a1100000-0000-4000-8000-000000000010');
update ev set id = public.ops_create_event('Weekend Distance', null, 'distance', 'individual', null, now() + interval '2 days', now() + interval '4 days');
select pg_temp.as_user('a1080000-0000-4000-8000-000000000008');
select public.join_event((select id from ev));
select public.leave_event((select id from ev));
select public.join_event((select id from ev));
reset role;
select is((select count(*)::int from internal.email_outbox where user_id = 'a1080000-0000-4000-8000-000000000008' and template = 'event_registered'), 1,
          'joining sends one confirmation, even after leaving and rejoining');

select * from finish();
rollback;
