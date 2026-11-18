-- Location for a global app (country and city on the profile, a private area shown only by choice),
-- Discover and rankings by place, drawn avatars while photo uploads are paused, and appeals from
-- suspended accounts.
begin;
select plan(48);

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'viewer@place.test'),
  ('c2000000-0000-4000-8000-000000000002', 'karachi@place.test'),
  ('c3000000-0000-4000-8000-000000000003', 'lahore@place.test'),
  ('c4000000-0000-4000-8000-000000000004', 'london@place.test'),
  ('c5000000-0000-4000-8000-000000000005', 'suspended@place.test'),
  ('c6000000-0000-4000-8000-000000000006', 'moderator@place.test'),
  ('c7000000-0000-4000-8000-000000000007', 'private@place.test');
update public.profiles set handle = 'viewer_k', visibility = 'public' where id = 'c1000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'karachi_k', visibility = 'public', discoverable = true where id = 'c2000000-0000-4000-8000-000000000002';
update public.profiles set handle = 'lahore_l', visibility = 'public', discoverable = true, country_code = 'PK', city_label = 'Lahore' where id = 'c3000000-0000-4000-8000-000000000003';
update public.profiles set handle = 'london_g', visibility = 'public', discoverable = true, country_code = 'GB', city_label = 'London' where id = 'c4000000-0000-4000-8000-000000000004';
update public.profiles set handle = 'private_p', country_code = 'PK', city_label = 'Karachi' where id = 'c7000000-0000-4000-8000-000000000007';
insert into public.staff_roles (user_id, role) values ('c6000000-0000-4000-8000-000000000006', 'moderator');

create function pg_temp.as_user(p uuid, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table t (club uuid, appeal uuid, post uuid);
grant select, update, insert on t to authenticated;
insert into t values (null, null, null);

-- The runner's place --------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
select lives_ok($$update public.profiles set country_code = 'PK', city_label = 'Karachi' where id = 'c2000000-0000-4000-8000-000000000002'$$,
                'a runner saves their country and city');
select lives_ok($$update public.user_settings set area_label = 'Gulistan-e-Johar' where user_id = 'c2000000-0000-4000-8000-000000000002'$$,
                'and their area, in their own settings');
select throws_ok($$update public.profiles set country_code = 'pk' where id = 'c2000000-0000-4000-8000-000000000002'$$, '23514', null,
                 'a country is a two-letter ISO code');
select throws_ok($$update public.user_settings set area_label = '   ' where user_id = 'c2000000-0000-4000-8000-000000000002'$$, '23514', null,
                 'a blank area is refused (the app sends none)');
select throws_ok($$update public.profiles set status_changed_at = now() where id = 'c2000000-0000-4000-8000-000000000002'$$, '42501', null,
                 'runners cannot set the status date');
select is(public.profile_card('c2000000-0000-4000-8000-000000000002') ->> 'area_label', 'Gulistan-e-Johar', 'runners see their own area');

select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select is(public.profile_card('c2000000-0000-4000-8000-000000000002') ->> 'city_label', 'Karachi', 'others see the city');
select is(public.profile_card('c2000000-0000-4000-8000-000000000002') ->> 'country_code', 'PK', 'and the country');
select ok(public.profile_card('c2000000-0000-4000-8000-000000000002') ->> 'area_label' is null, 'but not the area by default');
select is((select count(*)::int from public.user_settings where user_id = 'c2000000-0000-4000-8000-000000000002'), 0,
          'nobody else can read a runner''s settings, where the area lives');
select ok(public.profile_card('c7000000-0000-4000-8000-000000000007') ->> 'city_label' is null
          and public.profile_card('c7000000-0000-4000-8000-000000000007') ->> 'country_code' is null,
          'a private profile hides its place from people who do not follow it');

select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
update public.user_settings set show_area = true where user_id = 'c2000000-0000-4000-8000-000000000002';
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select is(public.profile_card('c2000000-0000-4000-8000-000000000002') ->> 'area_label', 'Gulistan-e-Johar', 'a runner can choose to show their area');

select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
update public.profiles set city_label = null where id = 'c2000000-0000-4000-8000-000000000002';
select is((select coalesce(area_label, '-') || '/' || show_area from public.user_settings where user_id = 'c2000000-0000-4000-8000-000000000002'), '-/false',
          'clearing the city clears the area and stops showing it');
update public.profiles set city_label = 'Karachi' where id = 'c2000000-0000-4000-8000-000000000002';

-- Discover by place ---------------------------------------------------------------------------
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select is((select array_agg(handle order by handle) from public.search_profiles('', p_country => 'PK', p_city => '  karachi ')), array['karachi_k'],
          'runners near you: same country and city, matched without case or extra spaces');
select is((select array_agg(handle order by handle) from public.search_profiles('', p_country => 'pk')), array['karachi_k', 'lahore_l'],
          'runners in your country');
select is((select count(*)::int from public.search_profiles('')), 3, 'and everywhere');
select is((select country_code from public.search_profiles('kar', p_country => 'PK')), 'PK', 'search results carry the country');

reset role;
insert into public.posts (author_id, audience, body, published_at) values
  ('c2000000-0000-4000-8000-000000000002', 'public', 'Sea view loop', now()),
  ('c3000000-0000-4000-8000-000000000003', 'public', 'Canal run', now()),
  ('c7000000-0000-4000-8000-000000000007', 'public', 'Not discoverable', now());
set local role authenticated;
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select is((select array_agg(p ->> 'body') from public.feed_discover(p_country => 'PK', p_city => 'Karachi') p), array['Sea view loop'],
          'the Discover feed shows public posts by discoverable runners in your city');
select is((select count(*)::int from public.feed_discover(p_country => 'PK')), 2, 'or your country');
select is((select count(*)::int from public.feed_discover()), 0, 'never without a place');

select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
update t set club = public.create_club('community', 'Clifton Striders', 'public', 'open', p_city_label => 'Karachi');
reset role;
select is((select country_code from public.clubs where id = (select club from t)), 'PK', 'a new community takes its creator''s country');
set local role authenticated;
select pg_temp.as_user('c4000000-0000-4000-8000-000000000004');
select ok(exists (select 1 from public.discover_clubs(p_country => 'PK', p_city => 'karachi') where id = (select club from t)), 'communities in a city are found by it');
select ok(not exists (select 1 from public.discover_clubs(p_country => 'GB', p_city => 'London') where id = (select club from t)), 'and not from another city');
select ok(exists (select 1 from public.discover_clubs() where id = (select club from t)), 'everywhere still lists every public community');

-- Rankings by place ---------------------------------------------------------------------------
reset role;
insert into internal.achievement_scores (user_id, score, badges, categories) values
  ('c1000000-0000-4000-8000-000000000001', 30, 2, 1), ('c2000000-0000-4000-8000-000000000002', 20, 1, 1),
  ('c3000000-0000-4000-8000-000000000003', 10, 1, 1), ('c4000000-0000-4000-8000-000000000004', 40, 3, 2);
set local role authenticated;
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select throws_ok($$select * from public.achievement_leaderboard('city')$$, 'P0404', 'set_city', 'city rankings need your city');
select throws_ok($$select * from public.achievement_leaderboard('country')$$, 'P0404', 'no_country', 'country rankings need your country');
reset role;
update public.profiles set country_code = 'PK', city_label = 'Karachi ' where id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select is((select array_agg(handle order by rank) from public.achievement_leaderboard('city')), array['viewer_k', 'karachi_k'], 'city ranking: runners in your city');
select is((select count(*)::int from public.achievement_leaderboard('region')), 2, 'older app versions asking for "region" get the city ranking');
select is((select array_agg(handle order by rank) from public.achievement_leaderboard('country')), array['viewer_k', 'karachi_k', 'lahore_l'], 'country ranking: your country');
select is((select count(*)::int from public.achievement_leaderboard('everyone')), 4, 'everyone ranks everyone');

-- Drawn avatars while photo uploads are paused --------------------------------------------------
reset role;
update public.app_config set value = 'false'::jsonb where key = 'avatar_uploads_enabled';
set local role authenticated;
select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('avatars', 'c2000000-0000-4000-8000-000000000002/avatar-cartoon-1700000000000.jpg')$$,
                'a drawn avatar saves while photos are paused');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('avatars', 'c2000000-0000-4000-8000-000000000002/avatar-1700000000000.jpg')$$, '42501', null,
                 'a photo waits');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('avatars', 'c1000000-0000-4000-8000-000000000001/avatar-cartoon-1.jpg')$$, '42501', null,
                 'nobody saves into another runner''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('avatars', 'c2000000-0000-4000-8000-000000000002/x/avatar-cartoon-1.jpg')$$, '42501', null,
                 'only directly in the runner''s own folder');
reset role;
update public.app_config set value = 'true'::jsonb where key = 'avatar_uploads_enabled';
set local role authenticated;
select pg_temp.as_user('c2000000-0000-4000-8000-000000000002');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('avatars', 'c2000000-0000-4000-8000-000000000002/avatar-1700000000001.jpg')$$,
                'photos save again once uploads are back on');

-- Appeals from suspended accounts ---------------------------------------------------------------
reset role;
update public.profiles set status = 'suspended' where id = 'c5000000-0000-4000-8000-000000000005';
select ok((select status_changed_at is not null from public.profiles where id = 'c5000000-0000-4000-8000-000000000005'), 'a suspension is dated');
insert into public.posts (author_id, audience, body, status, removed_reason) values ('c5000000-0000-4000-8000-000000000005', 'public', 'Removed words', 'removed', 'spam');
update t set post = (select id from public.posts where author_id = 'c5000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.as_user('c5000000-0000-4000-8000-000000000005');
select lives_ok($$update t set appeal = public.submit_appeal('account_action', 'c5000000-0000-4000-8000-000000000005', 'I was suspended by mistake, please look again')$$,
                'a suspended runner asks for a review of the suspension');
select throws_ok($$select public.submit_appeal('account_action', 'c5000000-0000-4000-8000-000000000005', 'Asking a second time for the same')$$, '23505', 'already_appealed',
                 'once per suspension');
select throws_ok($$select public.submit_appeal('account_action', 'c1000000-0000-4000-8000-000000000001', 'Someone else''s account please')$$, '42501', 'nothing to appeal',
                 'only for their own account');
select lives_ok($$select public.submit_appeal('post', (select post from t), 'The post was a race report, not spam')$$, 'and of other decisions while suspended');
select pg_temp.as_user('c1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.submit_appeal('account_action', 'c1000000-0000-4000-8000-000000000001', 'Nothing happened to my account')$$, '42501', 'nothing to appeal',
                 'an active account has no suspension to appeal');

select pg_temp.as_user('c6000000-0000-4000-8000-000000000006');
select is((select count(*)::int from public.ops_appeals_queue('open') where object_type = 'account_action' and user_id = 'c5000000-0000-4000-8000-000000000005'), 1,
          'the request reaches the moderators');
select lives_ok($$select public.ops_decide_account_appeal((select appeal from t), true, 'Reinstated after review')$$, 'a moderator accepts it');
reset role;
select is((select status from public.profiles where id = 'c5000000-0000-4000-8000-000000000005'), 'active', 'which reinstates the account');

update public.profiles set status = 'suspended' where id = 'c5000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.as_user('c5000000-0000-4000-8000-000000000005');
select lives_ok($$select public.submit_appeal('account_action', 'c5000000-0000-4000-8000-000000000005', 'A new suspension, a new request')$$,
                'a later suspension can be appealed again');
reset role;
update public.profiles set status = 'deleted' where id = 'c7000000-0000-4000-8000-000000000007';
set local role authenticated;
select pg_temp.as_user('c7000000-0000-4000-8000-000000000007');
select throws_ok($$select public.submit_appeal('account_action', 'c7000000-0000-4000-8000-000000000007', 'Deleted accounts cannot ask')$$, '42501', 'account not active',
                 'deleted accounts cannot appeal');

-- Grants --------------------------------------------------------------------------------------
reset role;
select ok(has_function_privilege('authenticated', 'public.search_profiles(text, uuid, integer, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.search_profiles(text, uuid, integer, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.feed_discover(uuid, timestamptz, uuid, integer, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.discover_clubs(uuid, text, integer, text, text)', 'execute'),
          'the recreated Discover functions are for signed-in users only');
select ok(not has_function_privilege('authenticated', 'internal.city_key(text)', 'execute')
          and not has_function_privilege('authenticated', 'internal.clear_area_with_city()', 'execute'),
          'the new helpers are not callable by app users');

select * from finish();
rollback;
