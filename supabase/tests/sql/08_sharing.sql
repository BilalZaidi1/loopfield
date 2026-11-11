-- Shared routes (trimmed ends, private areas removed), land on cards, and public activity links.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('a8100000-0000-4000-8000-000000000001', 'sharer@example.test'),
  ('a8200000-0000-4000-8000-000000000002', 'viewer@example.test');
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
-- A 2 km run due north from a point in the development region, finished three hours ago.
create temp table run as select 'a8000000-0000-4000-8000-0000000000a1'::uuid id,
  extensions.st_makeline(extensions.st_makepoint(67.02, 24.86), extensions.st_makepoint(67.02, 24.86 + 2000 / 111320.0)) line;
grant select on run to authenticated, anon;
insert into public.activities (id, user_id, started_at, ended_at, status, distance_m, elapsed_ms, avg_pace_s_per_km, personal_route)
select id, 'a8100000-0000-4000-8000-000000000001', now() - interval '4 hours', now() - interval '3 hours', 'processed', 2000, 720000, 360,
       extensions.st_asencodedpolyline(extensions.st_segmentize(line::extensions.geography, 20)::extensions.geometry, 5) from run;

-- The route as others may see it
select ok(abs((select sum(extensions.st_length(extensions.st_linefromencodedpolyline(x #>> '{}', 5)::extensions.geography)) from jsonb_array_elements(internal.share_route((select id from run), 'a8100000-0000-4000-8000-000000000001')) x) - 1600) < 40,
          'the shared route leaves out the first and last 200 m');
select ok((select extensions.st_distance(extensions.st_startpoint(extensions.st_linefromencodedpolyline(internal.share_route((select id from run), 'a8100000-0000-4000-8000-000000000001') ->> 0, 5))::extensions.geography,
                                          extensions.st_makepoint(67.02, 24.86)::extensions.geography)) between 180 and 230,
          'it starts about 200 m from where the run started');
insert into public.protected_areas (user_id, label, center, radius_m, geom)
values ('a8100000-0000-4000-8000-000000000001', 'Work', extensions.st_makepoint(67.02, 24.86 + 1000 / 111320.0)::extensions.geography, 100,
        extensions.st_buffer(extensions.st_makepoint(67.02, 24.86 + 1000 / 111320.0)::extensions.geography, 100)::extensions.geography);
select is(jsonb_array_length(internal.share_route((select id from run), 'a8100000-0000-4000-8000-000000000001')), 2, 'nothing inside the runner''s private areas is shown');
update public.activities set personal_route = extensions.st_asencodedpolyline(extensions.st_setsrid(extensions.st_makeline(extensions.st_makepoint(67.03, 24.86), extensions.st_makepoint(67.03, 24.86 + 500 / 111320.0)), 4326), 5)
 where id = 'a8000000-0000-4000-8000-0000000000a1';
select is(internal.share_route((select id from run), 'a8100000-0000-4000-8000-000000000001'), null, 'a route too short to hide its ends is never shared');
update public.activities a set personal_route = extensions.st_asencodedpolyline(extensions.st_segmentize(r.line::extensions.geography, 20)::extensions.geometry, 5)
  from run r where a.id = r.id;
delete from public.protected_areas where user_id = 'a8100000-0000-4000-8000-000000000001';

-- Posts carry it, never before the publication delay
set local role authenticated;
select pg_temp.as_user('a8100000-0000-4000-8000-000000000001');
create temp table made as select (public.create_post('public', 'Morning run', null, (select id from run), array['distance', 'duration', 'pace', 'route']) ->> 'post_id')::uuid post;
reset role;
select ok((select shared_route is not null and jsonb_array_length(shared_route) = 1 from public.posts where id = (select post from made)), 'the post carries the trimmed route');
select ok((select publish_after >= (select ended_at from public.activities where id = (select id from run)) + interval '30 minutes' from public.posts where id = (select post from made)),
          'a shared route waits for the 30-minute publication delay');
select is((select (shared_summary ->> 'avg_pace_s_per_km')::numeric from public.posts where id = (select post from made)), 360::numeric, 'pace and duration come from the server''s record');
set local role authenticated;
select pg_temp.as_user('a8200000-0000-4000-8000-000000000002');
select ok((select public.post_detail((select post from made)) -> 'post' -> 'shared_route' is not null) or (select public.post_detail((select post from made)) -> 'shared_route' is not null),
          'viewers of the post see the route');
reset role;

-- Public links show only the chosen fields
set local role authenticated;
select pg_temp.as_user('a8100000-0000-4000-8000-000000000001');
create temp table link as select (public.create_activity_link((select id from run), array['distance', 'route']) ->> 'token') token;
reset role;
grant select on link to anon, authenticated;
set local role anon;
select pg_temp.as_user(null);
select is((public.public_activity((select token from link)) -> 'summary' ->> 'distance_m')::int, 2000, 'anyone with the link sees the run (signed out too)');
select is(public.public_activity((select token from link)) -> 'summary' -> 'elapsed_ms', null, 'fields the runner left out are not there');
select is(public.public_activity('not-a-real-token-at-all-0000'), null, 'unknown links show nothing');
reset role;
select ok((select views from public.activity_links where token = (select token from link)) >= 1, 'views are counted');
update public.user_settings set full_private_mode = true where user_id = 'a8100000-0000-4000-8000-000000000001';
select is(public.public_activity((select token from link)), null, 'full private mode closes every public link');
update public.user_settings set full_private_mode = false where user_id = 'a8100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('a8100000-0000-4000-8000-000000000001');
select public.revoke_activity_link((select token from link));
reset role;
select is(public.public_activity((select token from link)), null, 'a revoked link shows nothing');

-- Deleting the run withdraws the route from posts
set local role authenticated;
select pg_temp.as_user('a8100000-0000-4000-8000-000000000001');
select public.delete_activity((select id from run));
reset role;
select is((select shared_route from public.posts where id = (select post from made)), null, 'deleting the run removes its route from posts at once');
set local role authenticated;
select pg_temp.as_user('a8100000-0000-4000-8000-000000000001');
select throws_ok($$select public.create_activity_link((select id from run), array['distance'])$$, null, null, 'a deleted run cannot be shared again');
reset role;

select * from finish();
rollback;
