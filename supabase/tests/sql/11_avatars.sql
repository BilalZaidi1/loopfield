-- Avatars: cartoon parts are validated, pictures must live in the runner's own folder, and the map lists the
-- runners holding land in view with their picture and their totals in that layer (blocked runners anonymous).
begin;
select plan(11);

insert into auth.users (id, email) values
  ('a1210000-0000-4000-8000-000000000001', 'cartoon@example.test'),
  ('a1220000-0000-4000-8000-000000000002', 'photo@example.test'),
  ('a1230000-0000-4000-8000-000000000003', 'viewer@example.test');
update public.user_settings set territory_competition_enabled = true;
update public.profiles set display_name = 'cartoon' where id = 'a1210000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'photo' where id = 'a1220000-0000-4000-8000-000000000002';
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- ---- Cartoon parts and picture paths -------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a1210000-0000-4000-8000-000000000001');
select lives_ok($$update public.profiles set avatar_kind = 'cartoon', avatar_path = 'a1210000-0000-4000-8000-000000000001/avatar-cartoon-1.jpg',
                  avatar_style = '{"bg": "#5B57E3", "skin": "#D0976B", "hair": "curly", "hairColor": "#1E1B18", "face": "grin", "outfit": "hoodie", "outfitColor": "#FF7A1A", "extra": "headscarf", "extraColor": "#0A74E0"}'
                  where id = 'a1210000-0000-4000-8000-000000000001'$$, 'a runner saves a cartoon avatar');
select throws_ok($$update public.profiles set avatar_style = '{"hair": "mohawk-of-doom"}' where id = 'a1210000-0000-4000-8000-000000000001'$$, '23514', null, 'unknown parts are refused');
select throws_ok($$update public.profiles set avatar_style = '{"bg": "red; background:url(x)"}' where id = 'a1210000-0000-4000-8000-000000000001'$$, '23514', null, 'colours must be plain hex');
select throws_ok($$update public.profiles set avatar_style = '{"script": "x"}' where id = 'a1210000-0000-4000-8000-000000000001'$$, '23514', null, 'unknown keys are refused');
select throws_ok($$update public.profiles set avatar_path = 'a1220000-0000-4000-8000-000000000002/avatar-1.jpg' where id = 'a1210000-0000-4000-8000-000000000001'$$, '23514', null,
                 'nobody can point their picture at another runner''s photo');
reset role;

-- ---- Runners on the map ---------------------------------------------------------------------------
update public.profiles set avatar_kind = 'photo', avatar_path = 'a1220000-0000-4000-8000-000000000002/avatar-2.jpg', avatar_photo_path = 'a1220000-0000-4000-8000-000000000002/avatar-2.jpg'
 where id = 'a1220000-0000-4000-8000-000000000002';
create temp table g as select 0.0009::float8 as dlat, 0.001::float8 as dlng, 67.05::float8 as lng0, 24.90::float8 as lat0;
insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7)
select 300000 + i * 100 + j, 11,
       extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326),
       extensions.st_area(extensions.st_makeenvelope(lng0 + j * dlng, lat0 + i * dlat, lng0 + (j + 1) * dlng, lat0 + (i + 1) * dlat, 4326)::extensions.geography),
       9000 + (i / 10) * 10 + (j / 10)
  from g, generate_series(0, 9) i, generate_series(0, 9) j;
-- Published land on the season race: 12 cells for the cartoon runner, 6 for the photo runner.
insert into internal.cell_control_public (competition_id, season_id, cell, controller_id, status)
select '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 300000 + i * 100 + j,
       case when i < 2 then 'a1210000-0000-4000-8000-000000000001'::uuid else 'a1220000-0000-4000-8000-000000000002'::uuid end, 'controlled'
  from generate_series(0, 2) i, generate_series(0, 5) j
 where i < 2 or j < 6;
create temp table v as select * from public.territory_owners_in_view('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 67.04, 24.89, 67.07, 24.92) limit 0;
grant select, insert on v to authenticated;

set local role authenticated;
select pg_temp.as_user('a1230000-0000-4000-8000-000000000003');
insert into v select * from public.territory_owners_in_view('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 67.04, 24.89, 67.07, 24.92);
reset role;
select is((select string_agg(display_name || ':' || cells_in_view || ':' || rank || '/' || runners, ',' order by cells_in_view desc) from v),
          'cartoon:12:1/2,photo:6:2/2', 'the map lists who holds land in view, most first, with their rank in the layer');
select is((select avatar_path from v where display_name = 'photo'), 'a1220000-0000-4000-8000-000000000002/avatar-2.jpg', 'with their picture');
select is((select owner_key from v where display_name = 'cartoon'), md5('a1210000-0000-4000-8000-000000000001'), 'keyed the same way as the land in view');

insert into public.blocks (blocker_id, blocked_id) values ('a1220000-0000-4000-8000-000000000002', 'a1230000-0000-4000-8000-000000000003');
delete from v;
set local role authenticated;
select pg_temp.as_user('a1230000-0000-4000-8000-000000000003');
insert into v select * from public.territory_owners_in_view('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 67.04, 24.89, 67.07, 24.92);
reset role;
select is((select display_name || ':' || coalesce(user_id::text, '-') || ':' || coalesce(avatar_path, '-') from v where cells_in_view = 6), 'A runner:-:-',
          'a runner who blocked you shows no name, profile or picture');

set local role anon;
select throws_ok($$select * from public.territory_owners_in_view('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 67.04, 24.89, 67.07, 24.92)$$,
                 '42501', null, 'signed-out visitors cannot list runners');
reset role;

select ok(not has_function_privilege('authenticated', 'internal.enqueue_email(uuid,text,jsonb,text,timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'internal.notify_land(uuid,text,text,text,jsonb,jsonb,text,boolean)', 'execute')
          and not has_function_privilege('anon', 'internal.email_unsubscribe(text,text)', 'execute')
          and has_function_privilege('authenticated', 'internal.valid_avatar_style(jsonb)', 'execute'),
          'app users cannot run internal email or notification functions; only the avatar check used by a constraint is open');
select * from finish();
rollback;
