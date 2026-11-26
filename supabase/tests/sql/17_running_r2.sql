-- Running features R2: live runs with friends (who counts as a friend, who was chosen, protected areas with no
-- override, unfollowing and blocking, switching off), one push for several links, and runners out right now
-- (check-ins without positions, counts by profile city and country, the smallest count, opting out, stale runs).
begin;
select plan(55);

insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', 'ayesha@run.test'),
  ('f2000000-0000-4000-8000-000000000002', 'bilal@run.test'),
  ('f3000000-0000-4000-8000-000000000003', 'cara@run.test'),
  ('f4000000-0000-4000-8000-000000000004', 'dan@run.test'),
  ('f5000000-0000-4000-8000-000000000005', 'k1@run.test'),
  ('f6000000-0000-4000-8000-000000000006', 'k2@run.test'),
  ('f7000000-0000-4000-8000-000000000007', 'k3@run.test'),
  ('f8000000-0000-4000-8000-000000000008', 'lahore@run.test'),
  ('f9000000-0000-4000-8000-000000000009', 'london@run.test');
update public.profiles set handle = 'ayesha_a', display_name = 'Ayesha', country_code = 'PK', city_label = 'Karachi' where id = 'f1000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'bilal_b', display_name = 'Bilal', country_code = 'PK', city_label = ' karachi ' where id = 'f2000000-0000-4000-8000-000000000002';
update public.profiles set handle = 'cara_c', country_code = 'PK', city_label = 'Karachi' where id = 'f3000000-0000-4000-8000-000000000003';
update public.profiles set handle = 'dan_d', country_code = 'PK', city_label = 'Karachi' where id = 'f4000000-0000-4000-8000-000000000004';
update public.profiles set handle = 'k_one', country_code = 'PK', city_label = 'Karachi' where id = 'f5000000-0000-4000-8000-000000000005';
update public.profiles set handle = 'k_two', country_code = 'PK', city_label = 'Karachi' where id = 'f6000000-0000-4000-8000-000000000006';
update public.profiles set handle = 'k_three', country_code = 'PK', city_label = 'KARACHI' where id = 'f7000000-0000-4000-8000-000000000007';
update public.profiles set handle = 'lahore_l', country_code = 'PK', city_label = 'Lahore' where id = 'f8000000-0000-4000-8000-000000000008';
update public.profiles set handle = 'london_l', country_code = 'GB', city_label = 'London' where id = 'f9000000-0000-4000-8000-000000000009';
-- Ayesha and Bilal follow each other, and so do Ayesha and Dan; Cara follows Ayesha but not the other way round.
insert into public.follows (follower_id, followee_id, state, accepted_at) values
  ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002', 'accepted', now()),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'accepted', now()),
  ('f1000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000004', 'accepted', now()),
  ('f4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001', 'accepted', now()),
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'accepted', now());

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.fix(seconds_ago double precision, lng double precision, lat double precision) returns jsonb language sql as $$
  select jsonb_build_object('t', (extract(epoch from now()) * 1000 - seconds_ago * 1000)::bigint, 'lat', lat, 'lng', lng, 'acc', 5);
$$;
create temp table t (friends text, run_link text);
insert into t default values;
grant select, update, insert on t to authenticated, anon;

-- Settings ----------------------------------------------------------------------------------------------
select is((select count(*)::int from public.app_config where key in ('run_summaries_enabled', 'running_now_enabled', 'running_now_min_count',
          'running_now_stale_minutes', 'friends_live_enabled', 'friends_live_max_people', 'friends_live_trail_minutes')), 7, 'the R2 settings exist');
select is((select count(*)::int from internal.config_registry where key in ('run_summaries_enabled', 'running_now_enabled', 'running_now_min_count',
          'running_now_stale_minutes', 'friends_live_enabled', 'friends_live_max_people', 'friends_live_trail_minutes')), 7, 'and each appears in App control');
select ok((select allowed @> array['running_now', 'friends_live'] from internal.config_registry where key = 'rate_limits'), 'check-ins and friends shares have request limits');
select is((select (running_now_counted, friends_live_mode)::text from public.user_settings where user_id = 'f1000000-0000-4000-8000-000000000001'),
          '(t,off)', 'runners are counted unless they opt out, and share with friends only once they turn it on');

-- Live runs with friends ------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select is(public.friends_live_start('a1000000-0000-4000-8000-000000000001') ->> 'reason', 'off', 'nothing is shared while sharing is off');
update public.user_settings set friends_live_mode = 'chosen' where user_id = 'f1000000-0000-4000-8000-000000000001';
select is(public.friends_live_start('a1000000-0000-4000-8000-000000000001') ->> 'reason', 'nobody', 'or before any friend is chosen');
select is((select array_agg(x ->> 'handle' order by x ->> 'handle') from jsonb_array_elements(public.live_share_candidates()) x),
          array['bilal_b', 'dan_d'], 'only mutual followers can be chosen');
select is(public.set_live_share_people(array['f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000003']::uuid[]),
          '{"saved": 1, "skipped": 1}'::jsonb, 'someone who is not a friend is not kept');
select is((select count(*)::int from public.live_share_people), 1, 'the runner sees their own choice');
update t set friends = (select public.friends_live_start('a1000000-0000-4000-8000-000000000001') ->> 'token');
select ok((select length(friends) >= 22 from t), 'a run is shared with the chosen friends');
select is((select public.friends_live_start('a1000000-0000-4000-8000-000000000001') ->> 'token' from t), (select friends from t), 'once per run');
select is((select public.live_push('a1000000-0000-4000-8000-000000000001', array[friends], 'running',
            jsonb_build_array(pg_temp.fix(40, 67.0011, 24.8607), pg_temp.fix(20, 67.0021, 24.8607), pg_temp.fix(0, 67.0031, 24.8612))) ->> 'ok' from t),
          'true', 'the phone''s push reaches the friends share');
select is(jsonb_array_length(public.my_live_links()), 0, 'a friends share is not one of the runner''s live links');

select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select is(jsonb_array_length(public.friends_live_now()), 1, 'a chosen friend sees the run');
select is(public.friends_live_now() -> 0 ->> 'display_name', 'Ayesha', 'with the runner''s name');
select ok(public.friends_live_now() -> 0 -> 'position' ? 'lat', 'where they are');
select ok((public.friends_live_now() -> 0 ->> 'bearing')::numeric between 0 and 360, 'which way they are heading');
select is(jsonb_array_length(public.friends_live_now() -> 0 -> 'trail' -> 0), 3, 'and the last few minutes of their path');
select is((select count(*)::int from public.live_share_people), 0, 'a friend cannot see who else was chosen');

select pg_temp.as_user('f4000000-0000-4000-8000-000000000004');
select is(jsonb_array_length(public.friends_live_now()), 0, 'a friend who was not chosen sees nothing');
select pg_temp.as_user('f3000000-0000-4000-8000-000000000003');
select is(jsonb_array_length(public.friends_live_now()), 0, 'nor does someone who only follows the runner');
set local role anon;
select ok((select public.public_live_link(friends) is null from t), 'and the public live page refuses a friends share');
select throws_ok($$select public.friends_live_now()$$, '42501', null, 'signed-out visitors cannot ask');

set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
update public.user_settings set friends_live_mode = 'all' where user_id = 'f1000000-0000-4000-8000-000000000001';
select pg_temp.as_user('f4000000-0000-4000-8000-000000000004');
select is(jsonb_array_length(public.friends_live_now()), 1, 'with "All my friends" every friend sees the run');
select pg_temp.as_user('f3000000-0000-4000-8000-000000000003');
select is(jsonb_array_length(public.friends_live_now()), 0, 'but still nobody else');

-- Protected areas are always held back from friends, even when the runner shows everything on a live link.
reset role;
insert into public.protected_areas (user_id, label, center, radius_m)
values ('f1000000-0000-4000-8000-000000000001', 'Home', extensions.st_setsrid(extensions.st_makepoint(67.0040, 24.8612), 4326)::extensions.geography, 100);
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select public.live_link_set_show_everywhere(friends, true) from t;
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select is((public.friends_live_now() -> 0 ->> 'hidden')::boolean, true, 'a position inside a protected area is held back from friends');
select ok(public.friends_live_now() -> 0 -> 'position' = 'null'::jsonb, 'with no way to show it');
select is(jsonb_array_length(public.friends_live_now() -> 0 -> 'trail' -> 0), 2, 'and the path stops before it');

-- Unfollowing or blocking stops it at once.
reset role;
delete from public.follows where follower_id = 'f2000000-0000-4000-8000-000000000002' and followee_id = 'f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select is(jsonb_array_length(public.friends_live_now()), 0, 'unfollowing stops sharing at once');
reset role;
insert into public.blocks (blocker_id, blocked_id) values ('f4000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.as_user('f4000000-0000-4000-8000-000000000004');
select is(jsonb_array_length(public.friends_live_now()), 0, 'and so does a block');

-- One push serves several links of the same run.
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
update t set run_link = (select public.live_link_create('run') ->> 'token');
select is((select public.live_push('a1000000-0000-4000-8000-000000000001', array[run_link, friends], 'running', jsonb_build_array(pg_temp.fix(0, 67.0050, 24.8620))) -> 'links' ->> run_link from t),
          'ok', 'one push from the phone reaches a live link');
reset role;
select is((select count(*)::int from internal.live_positions where token = (select run_link from t)), 1, 'and stores the fix for it');
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.live_push('a1000000-0000-4000-8000-000000000001', array['a','b','c','d'], 'running', '[]')$$, '22023', null, 'a push names at most three links');

-- Turning sharing off ends the share in progress.
update public.user_settings set friends_live_mode = 'off' where user_id = 'f1000000-0000-4000-8000-000000000001';
select is((select public.live_link_push(friends, 'a1000000-0000-4000-8000-000000000001', 'running', '[]') ->> 'reason' from t), 'ended', 'turning sharing off ends it at once');
reset role;
update public.app_config set value = '1' where key = 'friends_live_max_people';
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.set_live_share_people(array['f2000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000004']::uuid[])$$,
                 '22023', null, 'a runner chooses no more friends than the limit');
reset role;
update public.app_config set value = '50' where key = 'friends_live_max_people';
update public.app_config set value = 'false' where key = 'friends_live_enabled';
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
update public.user_settings set friends_live_mode = 'all' where user_id = 'f1000000-0000-4000-8000-000000000001';
select throws_ok($$select public.friends_live_start('a2000000-0000-4000-8000-000000000002')$$, '55000', null, 'nothing is shared while the feature is switched off');
reset role;
update public.app_config set value = 'true' where key = 'friends_live_enabled';

-- Runners out right now ---------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select is(public.running_now_ping('b1000000-0000-4000-8000-000000000001') ->> 'ok', 'true', 'a run checks in without any position');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select public.running_now_ping('b2000000-0000-4000-8000-000000000002');
select pg_temp.as_user('f3000000-0000-4000-8000-000000000003');
select public.running_now_ping('b3000000-0000-4000-8000-000000000003');
select pg_temp.as_user('f5000000-0000-4000-8000-000000000005');
select public.running_now_ping('b5000000-0000-4000-8000-000000000005');
select pg_temp.as_user('f7000000-0000-4000-8000-000000000007');
select public.running_now_ping('b7000000-0000-4000-8000-000000000007');
select pg_temp.as_user('f8000000-0000-4000-8000-000000000008');
select public.running_now_ping('b8000000-0000-4000-8000-000000000008');
select pg_temp.as_user('f9000000-0000-4000-8000-000000000009');
select public.running_now_ping('b9000000-0000-4000-8000-000000000009');
reset role;
select is(internal.running_now_tick(), 7, 'maintenance counts the runners out');
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select is(public.running_now_counts() -> 'city' ->> 'count', '5', 'five out in Karachi, however the city is written on profiles');
select is(public.running_now_counts() -> 'country' ->> 'count', '6', 'six in Pakistan');
select is(public.running_now_counts() ->> 'everywhere', '7', 'seven everywhere');
select pg_temp.as_user('f9000000-0000-4000-8000-000000000009');
select ok(public.running_now_counts() -> 'city' -> 'count' = 'null'::jsonb and public.running_now_counts() -> 'country' -> 'count' = 'null'::jsonb,
          'counts under five are never shown');

-- Opting out takes a runner out at once, and later check-ins are ignored.
select pg_temp.as_user('f5000000-0000-4000-8000-000000000005');
update public.user_settings set running_now_counted = false where user_id = 'f5000000-0000-4000-8000-000000000005';
select is(public.running_now_ping('b5000000-0000-4000-8000-000000000005') ->> 'reason', 'opted_out', 'a runner who opted out is not counted');
reset role;
select internal.running_now_tick();
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select ok(public.running_now_counts() -> 'city' -> 'count' = 'null'::jsonb, 'so Karachi falls under five and is hidden');
select is(public.running_now_counts() -> 'country' ->> 'count', '5', 'while the country still shows');

-- Ending a run, staleness, the smallest count, and the switch.
select pg_temp.as_user('f3000000-0000-4000-8000-000000000003');
select public.running_now_end('b1000000-0000-4000-8000-000000000001');
reset role;
select is((select count(*)::int from internal.running_now where user_id = 'f1000000-0000-4000-8000-000000000001'), 1, 'nobody can end someone else''s run');
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select public.running_now_end('b1000000-0000-4000-8000-000000000001');
reset role;
select is((select count(*)::int from internal.running_now where user_id = 'f1000000-0000-4000-8000-000000000001'), 0, 'finishing a run takes the runner out');
update internal.running_now set last_ping_at = now() - interval '20 minutes' where user_id = 'f8000000-0000-4000-8000-000000000008';
select is(internal.running_now_tick(), 4, 'a run that stopped checking in drops out');
update public.app_config set value = '3' where key = 'running_now_min_count';
set local role authenticated;
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select ok(public.running_now_counts() -> 'country' -> 'count' = 'null'::jsonb, 'the smallest count shown never goes below five');
reset role;
update public.app_config set value = '5' where key = 'running_now_min_count';
select ok((select peak >= 7 from internal.running_now_peaks where day = (now() at time zone 'utc')::date), 'the day''s peak is kept for the daily metric');
select ok(internal.run_maintenance() ? 'running_now', 'the every-minute maintenance counts runners out');
update public.app_config set value = 'false' where key = 'running_now_enabled';
select internal.running_now_tick();
select is((select count(*)::int from internal.running_now), 0, 'switching the feature off clears the counts');
set local role authenticated;
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select is(public.running_now_counts() ->> 'enabled', 'false', 'and the app hides them');
select throws_ok($$select internal.running_now_tick()$$, '42501', null, 'the app cannot run the count itself');
set local role anon;
select throws_ok($$select public.running_now_ping('b9000000-0000-4000-8000-000000000009')$$, '42501', null, 'signed-out callers cannot check in');
reset role;
update public.app_config set value = 'true' where key = 'running_now_enabled';

select * from finish();
rollback;
