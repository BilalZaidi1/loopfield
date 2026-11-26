-- Running features R4: a speed route from part of a run (stretches, overlaps, older apps), shoe mileage (private
-- pairs, the default pair, totals, reminders, retiring, deleting, photos, the switch) and the replay switch.
begin;
select plan(77);

insert into auth.users (id, email) values
  ('c4a00000-0000-4000-8000-000000000001', 'shoes@run.test'),
  ('c4b00000-0000-4000-8000-000000000002', 'other@run.test'),
  ('c4c00000-0000-4000-8000-000000000003', 'leaving@run.test');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
-- A processed run of `km` kilometres (the database's own pair choice unless one is given).
create function pg_temp.run(p_id uuid, p_user uuid, km double precision, p_gear uuid default null) returns uuid language sql as $$
  insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms, gear_id)
  values (p_id, p_user, now() - interval '2 hours', now() - interval '1 hour', 'processed', km * 1000, 3600000, p_gear) returning id;
$$;
create function pg_temp.reminders(p_gear uuid) returns text language sql as $$
  select coalesce(string_agg(data ->> 'percent', ',' order by (data ->> 'percent')::int), '')
    from public.notifications where kind = 'gear_reminder' and object_id = p_gear::text;
$$;
create temp table g (a uuid, b uuid);
insert into g values (null, null);
grant select, update on g to authenticated;

-- Settings ----------------------------------------------------------------------------------------
select is((select count(*)::int from public.app_config where is_public and key in ('route_proposals_a_to_b', 'gear_enabled', 'gear_max_items',
          'gear_reminder_default_km', 'replay_enabled')), 5, 'the R4 settings exist and the app can read them');
select is((select count(*)::int from internal.config_registry where key in ('route_proposals_a_to_b', 'gear_enabled', 'gear_max_items',
          'gear_reminder_default_km', 'replay_enabled')), 5, 'and each appears in App control');
select is((select value from public.app_config where key = 'route_proposals_a_to_b'), 'false'::jsonb, 'start-to-finish routes stay off until the owner decides');
select is((select (category, min_role)::text from internal.config_registry where key = 'gear_enabled'), '(switch,territory_operator)', 'shoe mileage is a switch');
select is((select value from public.app_config where key = 'replay_enabled'), 'true'::jsonb, 'replay is on');
select is((select help from internal.config_registry where key = 'photo_uploads_enabled'), 'Off blocks new photos on posts and shoes.',
          'the photo switch says it covers shoe photos too');

-- A speed route from part of a run --------------------------------------------------------------------
select pg_temp.run('c4100000-0000-4000-8000-000000000001', 'c4a00000-0000-4000-8000-000000000001', 6);
select pg_temp.run('c4100000-0000-4000-8000-000000000002', 'c4a00000-0000-4000-8000-000000000001', 8);
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000001', 'Park loop', 'route-v1', false)$$,
                'older apps propose a whole run as before');
select ok((select from_m is null and to_m is null from public.route_proposals where name = 'Park loop'), 'and it covers the whole run');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000001', 'Park part', 'route-v1', false, 1000, 2500)$$,
                 'P0001', 'a proposal for this activity already exists', 'a part of a run already proposed whole is refused');
select lives_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Riverside', 'route-v1', false, 1200, 4600)$$,
                'a runner proposes part of a run');
select is((select (from_m, to_m)::text from public.route_proposals where name = 'Riverside'), '(1200,4600)', 'the proposal keeps where the part starts and ends');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Overlap', 'route-v1', false, 4000, 6000)$$,
                 'P0001', 'a proposal for this activity already exists', 'a part that overlaps one already proposed is refused');
select lives_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Bridges', 'route-v1', false, 4600, 7500)$$,
                'a part that starts where the other ends is fine');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Whole', 'route-v1')$$,
                 'P0001', 'a proposal for this activity already exists', 'the whole run is refused once parts of it are proposed');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Half', 'route-v1', false, 1000, null)$$,
                 '22023', null, 'a part needs a start and an end');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Backwards', 'route-v1', false, 3000, 2000)$$,
                 '22023', null, 'and must start before it ends');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Beyond', 'route-v1', false, 9000, 20000)$$,
                 '22023', null, 'and lie within the run');
select lives_ok($$select public.withdraw_route_proposal((select id from public.route_proposals where name = 'Bridges'))$$, 'a part can be withdrawn');
select lives_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Bridges again', 'route-v1', false, 5000, 7000)$$,
                'and that stretch proposed again');
select pg_temp.as_user('c4b00000-0000-4000-8000-000000000002');
select throws_ok($$select public.propose_route('c4100000-0000-4000-8000-000000000002', 'Not mine', 'route-v1', false, 0, 2000)$$,
                 'P0001', 'activity must be processed before proposing a route', 'nobody can propose part of someone else''s run');
reset role;
insert into public.protected_areas (user_id, label, center, radius_m)
values ('c4a00000-0000-4000-8000-000000000001', 'Home', 'SRID=4326;POINT(67.0011 24.8607)', 200);
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select is((select (label, radius_m, round(lat::numeric, 4), round(lng::numeric, 4))::text from public.my_protected_areas()), '(Home,200,24.8607,67.0011)',
          'the phone can read the runner''s own protected areas to check a part before submitting');
select pg_temp.as_user('c4b00000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.my_protected_areas()), 0, 'but nobody else''s');
reset role;
select is((select count(*)::int from internal.jobs where kind = 'build_route_proposal'
            and payload ->> 'proposal_id' in (select id::text from public.route_proposals where source_activity_id = 'c4100000-0000-4000-8000-000000000002')), 3,
          'each part goes to the checks, which cut it from the run''s evidence');

-- Shoes: adding, the default pair, privacy ----------------------------------------------------------
update public.app_config set value = '2' where key = 'gear_max_items';
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$update g set a = public.save_gear(null, '  Blue trainers ', 0, null, true)$$, 'a runner adds a pair of shoes');
select is((select (name, reminder_m, is_default)::text from public.gear where id = (select a from g)), '("Blue trainers",700000,t)',
          'the name is tidied, the reminder distance comes from the setting, and it is the default');
select throws_ok($$select public.save_gear(null, '   ', 0, null, false)$$, '23514', null, 'a pair needs a name');
select lives_ok($$update g set b = public.save_gear(null, 'Pegasus 41', 120000, 800000, true)$$, 'a second pair, with its own distances');
select is((select string_agg(name, ',') from public.gear where is_default), 'Pegasus 41', 'there is one default pair at a time');
select throws_ok($$select public.save_gear(null, 'Spikes', 0, null, false)$$, '23514', null, 'at most the set number of pairs are in use');
select throws_ok($$insert into public.gear (user_id, name, reminder_m) values ('c4a00000-0000-4000-8000-000000000001', 'Sneaky', 700000)$$,
                 '42501', null, 'pairs change only through the app''s functions');

reset role;
select pg_temp.run('c4200000-0000-4000-8000-000000000001', 'c4a00000-0000-4000-8000-000000000001', 10);
select pg_temp.run('c4200000-0000-4000-8000-000000000005', 'c4b00000-0000-4000-8000-000000000002', 5);
select is((select gear_id from public.activities where id = 'c4200000-0000-4000-8000-000000000001'), (select b from g),
          'a new run counts towards the default pair by itself');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select is((select (distance_m, runs)::text from public.my_gear() where id = (select b from g)), '(130000,1)',
          'a pair''s total is its starting distance plus its runs');
select lives_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000001', (select a from g))$$, 'the runner changes the pair on a run');
select is((select gear_id from public.activities where id = 'c4200000-0000-4000-8000-000000000001'), (select a from g), 'and the run moves');
select lives_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000001', null)$$, 'or chooses no shoes');
select is((select count(*)::int from public.activities where id = 'c4200000-0000-4000-8000-000000000001' and gear_id is null), 1, 'and the run counts towards none');

select pg_temp.as_user('c4b00000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.gear) + (select count(*)::int from public.my_gear()), 0, 'nobody else can see a runner''s shoes');
select throws_ok($$select public.save_gear((select a from g), 'Mine now', 0, null, false)$$, '42501', null, 'or change them');
select throws_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000001', null)$$, '42501', null, 'or change the pair on their runs');
select throws_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000005', (select a from g))$$, '42501', null, 'or count their own runs towards them');

-- Reminders -----------------------------------------------------------------------------------------
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.save_gear((select a from g), 'Blue trainers', 0, 50000, false)$$, 'the runner sets a 50 km reminder');
reset role;
select pg_temp.run('c4200000-0000-4000-8000-000000000002', 'c4a00000-0000-4000-8000-000000000001', 46, (select a from g));
select is(pg_temp.reminders((select a from g)), '90', 'a reminder comes when runs take the pair past 90%');
select is((select (category, object_type)::text from public.notifications where kind = 'gear_reminder' limit 1), '(system,gear)', 'as a system notification about the pair');
select pg_temp.run('c4200000-0000-4000-8000-000000000003', 'c4a00000-0000-4000-8000-000000000001', 2, (select a from g));
select is(pg_temp.reminders((select a from g)), '90', 'only once');
select pg_temp.run('c4200000-0000-4000-8000-000000000004', 'c4a00000-0000-4000-8000-000000000001', 3, (select a from g));
select is(pg_temp.reminders((select a from g)), '90,100', 'and again at 100%');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.save_gear((select a from g), 'Blue trainers', 0, 100000, false)$$, 'a longer reminder distance');
reset role;
select ok((select reminded_90_at is null and reminded_100_at is null from public.gear where id = (select a from g)), 'starts the reminders again');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.save_gear((select a from g), 'Blue trainers', 0, 50000, false)$$, 'a shorter one that the pair is already past');
reset role;
select is(pg_temp.reminders((select a from g)), '90,100', 'sends nothing: the runner is looking at the number');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.save_gear((select b from g), 'Pegasus 41', 120000, 150000, true)$$, 'the other pair gets a 150 km reminder');
reset role;
select pg_temp.run('c4200000-0000-4000-8000-000000000006', 'c4a00000-0000-4000-8000-000000000001', 40);
select is(pg_temp.reminders((select b from g)), '100', 'a run that passes 90% and 100% at once sends only the 100% reminder');

-- Retiring --------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.retire_gear((select b from g))$$, 'a pair is retired');
select ok((select retired_at is not null and not is_default from public.gear where id = (select b from g)), 'and is no longer the default');
reset role;
select pg_temp.run('c4200000-0000-4000-8000-000000000007', 'c4a00000-0000-4000-8000-000000000001', 5);
select is((select gear_id from public.activities where id = 'c4200000-0000-4000-8000-000000000007'), null, 'so new runs count towards no pair');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select throws_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000007', (select b from g))$$, '42501', null, 'a retired pair takes no new runs');
select lives_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000006', (select b from g))$$, 'but keeps the runs it has');
select is((select string_agg(name, ',') from public.my_gear()), 'Blue trainers,Pegasus 41', 'pairs in use come first, then retired ones');
select lives_ok($$select public.retire_gear((select b from g), false)$$, 'a retired pair can go back in use');

-- The switch ------------------------------------------------------------------------------------------
select lives_ok($$select public.save_gear((select a from g), 'Blue trainers', 0, 50000, true)$$, 'the first pair is the default again');
reset role;
update public.app_config set value = 'false' where key = 'gear_enabled';
select pg_temp.run('c4200000-0000-4000-8000-000000000008', 'c4a00000-0000-4000-8000-000000000001', 5);
select is((select gear_id from public.activities where id = 'c4200000-0000-4000-8000-000000000008'), null, 'while shoes are switched off, new runs count towards no pair');
select ok((select count(*) from public.activities where gear_id is not null) > 0, 'and runs keep their pairs');
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select throws_ok($$select public.save_gear(null, 'New pair', 0, null, false)$$, '55000', null, 'no pairs are added');
select throws_ok($$select public.set_run_gear('c4200000-0000-4000-8000-000000000008', (select a from g))$$, '55000', null, 'or changed on runs');
reset role;
update public.app_config set value = 'true' where key = 'gear_enabled';

-- Photos ----------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.set_gear_photo((select a from g), 'c4a00000-0000-4000-8000-000000000001/' || (select a from g) || '-1.jpg')$$,
                'a pair gets a photo from the runner''s own folder');
select throws_ok($$select public.set_gear_photo((select a from g), 'c4b00000-0000-4000-8000-000000000002/' || (select a from g) || '-1.jpg')$$,
                 '42501', null, 'never from someone else''s');
reset role;
update public.app_config set value = 'false' where key = 'photo_uploads_enabled';
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select throws_ok($$select public.set_gear_photo((select a from g), 'c4a00000-0000-4000-8000-000000000001/' || (select a from g) || '-2.jpg')$$,
                 '55000', null, 'new photos follow the photo-upload switch');
select lives_ok($$select public.set_gear_photo((select a from g), null)$$, 'removing one always works');
reset role;
select is((select public from storage.buckets where id = 'gear-photos'), false, 'shoe photos are private');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'gear\_photos\_%'), 4,
          'and reachable only in the runner''s own folder');

-- Deleting ----------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c4a00000-0000-4000-8000-000000000001');
select lives_ok($$select public.delete_gear((select a from g))$$, 'a pair is deleted');
reset role;
select is((select count(*)::int from public.activities where user_id = 'c4a00000-0000-4000-8000-000000000001' and gear_id = (select a from g)), 0,
          'its runs count towards nothing');
select is((select count(*)::int from public.activities where id in ('c4200000-0000-4000-8000-000000000002', 'c4200000-0000-4000-8000-000000000004')), 2,
          'and keep their distances');
set local role authenticated;
select pg_temp.as_user('c4c00000-0000-4000-8000-000000000003');
select lives_ok($$select public.save_gear(null, 'Old faithfuls', 300000, null, true)$$, 'another runner adds a pair');
reset role;
delete from auth.users where id = 'c4c00000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.gear where user_id = 'c4c00000-0000-4000-8000-000000000003'), 0, 'deleting an account deletes its shoes');

-- Grants -------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.save_gear(uuid, text, double precision, double precision, boolean)', 'execute'),
          'signed-out visitors cannot add shoes');
select ok(has_function_privilege('authenticated', 'public.propose_route(uuid, text, text, boolean, double precision, double precision)', 'execute')
          and not has_function_privilege('anon', 'public.propose_route(uuid, text, text, boolean, double precision, double precision)', 'execute'),
          'only signed-in runners propose routes');
select ok(not has_function_privilege('authenticated', 'internal.check_gear_reminders(uuid)', 'execute'), 'the app cannot send shoe reminders itself');

select * from finish();
rollback;
