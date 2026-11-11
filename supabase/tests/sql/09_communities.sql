-- Communities and groups: kinds, group limits, branding, ownership offers, succession, deletion, chat sync.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('a9100000-0000-4000-8000-000000000001', 'owner@example.test'),
  ('a9200000-0000-4000-8000-000000000002', 'admin@example.test'),
  ('a9300000-0000-4000-8000-000000000003', 'member@example.test'),
  ('a9400000-0000-4000-8000-000000000004', 'outsider@example.test');
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table k (community uuid, grp uuid, legacy uuid);
grant select, update, insert on k to authenticated;
insert into k values (null, null, null);

set local role authenticated;
select pg_temp.as_user('a9100000-0000-4000-8000-000000000001');
update k set community = public.create_club('community', 'Harbour Striders', 'public', 'request', 'Dawn runs by the sea', null, 'members', '00000000-0000-4000-8000-000000000001'),
             grp = public.create_club('group', 'Tuesday Crew', 'public', 'open'),
             legacy = public.create_club('club', 'Old Club Name', 'public', 'open');
reset role;

-- Kinds
select is((select visibility || '/' || join_policy from public.clubs where id = (select grp from k)), 'private/invite_only', 'groups are always private and by invitation');
select is((select kind from public.clubs where id = (select legacy from k)), 'community', 'older app builds asking for a "club" get a community');
select is((select count(*)::int from public.competitions where club_id = (select community from k) and kind = 'club'), 1, 'a community with an area gets its own race');

-- Members and admins
insert into public.club_memberships (club_id, user_id, role, state, created_at) values
  ((select community from k), 'a9200000-0000-4000-8000-000000000002', 'organizer', 'active', now() - interval '3 days'),
  ((select community from k), 'a9300000-0000-4000-8000-000000000003', 'member', 'active', now() - interval '5 days'),
  ((select grp from k), 'a9300000-0000-4000-8000-000000000003', 'member', 'active', now());
select ok(exists (select 1 from internal.jobs where kind = 'sync_group_chat' and payload ->> 'club_id' = (select grp from k)::text), 'joining a group queues its chat membership update');
update public.app_config set value = '2'::jsonb where key = 'group_max_members';
select throws_ok($$insert into public.club_memberships (club_id, user_id, role, state) values ((select grp from k), 'a9200000-0000-4000-8000-000000000002', 'member', 'active')$$,
                 'P0409', null, 'a full group refuses new members');
update public.app_config set value = '100'::jsonb where key = 'group_max_members';

-- Branding
set local role authenticated;
select pg_temp.as_user('a9300000-0000-4000-8000-000000000003');
select throws_ok($$select public.set_club_branding((select community from k), (select community from k)::text || '/logo-1.jpg')$$, '42501', null, 'members cannot change the branding');
select pg_temp.as_user('a9200000-0000-4000-8000-000000000002');
select lives_ok($$select public.set_club_branding((select community from k), (select community from k)::text || '/logo-1.jpg', null, 'tide')$$, 'an admin sets the logo and an artwork');
select throws_ok($$select public.set_club_branding((select community from k), 'someone-else/logo.jpg')$$, '22023', null, 'images must be in the club''s own folder');
reset role;
select is((select avatar_path || ' ' || artwork from public.clubs where id = (select community from k)), (select community from k)::text || '/logo-1.jpg tide', 'the logo and artwork are saved');
select ok(exists (select 1 from public.discover_clubs() where id = (select community from k)) and not exists (select 1 from public.discover_clubs() where id = (select grp from k)),
          'communities can be discovered; groups never are');

-- Ownership moves only when the new owner accepts
set local role authenticated;
select pg_temp.as_user('a9100000-0000-4000-8000-000000000001');
select throws_ok($$select public.set_club_role((select community from k), 'a9300000-0000-4000-8000-000000000003', 'owner')$$, '22023', null, 'ownership is never just assigned');
select lives_ok($$select public.offer_club_ownership((select community from k), 'a9300000-0000-4000-8000-000000000003')$$, 'the owner offers ownership to a member');
reset role;
select is((select role from public.club_memberships where club_id = (select community from k) and user_id = 'a9100000-0000-4000-8000-000000000001'), 'owner', 'nothing changes before the member accepts');
select ok(exists (select 1 from public.notifications where user_id = 'a9300000-0000-4000-8000-000000000003' and kind = 'club_ownership_offer'), 'the member is asked');
set local role authenticated;
select pg_temp.as_user('a9300000-0000-4000-8000-000000000003');
select public.respond_club_ownership((select community from k), true);
reset role;
set constraints all immediate;
select is((select string_agg(user_id::text || ':' || role, ',' order by user_id) from public.club_memberships where club_id = (select community from k) and state = 'active'),
          'a9100000-0000-4000-8000-000000000001:organizer,a9200000-0000-4000-8000-000000000002:organizer,a9300000-0000-4000-8000-000000000003:owner',
          'after accepting, the member owns it and the previous owner stays as an admin');

-- An owner hands over before leaving; succession covers owners who disappear
set local role authenticated;
select pg_temp.as_user('a9300000-0000-4000-8000-000000000003');
select throws_ok($$select public.leave_club((select community from k))$$, 'P0409', 'owner_must_transfer', 'an owner with members must choose a new owner before leaving');
reset role;
-- The owner's account is deleted (the account job ends their memberships).
update public.club_memberships set state = 'left', role = 'member' where club_id = (select community from k) and user_id = 'a9300000-0000-4000-8000-000000000003';
set constraints all immediate;
select is((select user_id from public.club_memberships where club_id = (select community from k) and role = 'owner' and state = 'active'), 'a9200000-0000-4000-8000-000000000002'::uuid,
          'the longest-serving admin takes over when the owner disappears');
select ok(exists (select 1 from public.notifications where user_id = 'a9200000-0000-4000-8000-000000000002' and kind = 'club_ownership_received'), 'and is told');
set local role authenticated;
select pg_temp.as_user('a9100000-0000-4000-8000-000000000001');
select public.leave_club((select legacy from k));
reset role;
set constraints all immediate;
select is((select status from public.clubs where id = (select legacy from k)), 'archived', 'a club whose last member leaves is closed');

-- Deleting a community
set local role authenticated;
select pg_temp.as_user('a9200000-0000-4000-8000-000000000002');
select throws_ok($$select public.delete_club((select community from k), 'Harbour')$$, '22023', null, 'deleting needs the exact name');
select lives_ok($$select public.delete_club((select community from k), 'harbour striders')$$, 'the owner deletes it after typing the name');
reset role;
select is((select status || ':' || (select count(*) from public.club_memberships where club_id = (select community from k) and state = 'active')
             || ':' || (select status from public.competitions where club_id = (select community from k))
           from public.clubs where id = (select community from k)), 'archived:0:archived', 'it is closed, members are removed and its race ends');
select ok(exists (select 1 from public.notifications where user_id = 'a9100000-0000-4000-8000-000000000001' and kind = 'club_deleted'), 'members are told it was deleted');
select is((select count(*)::int from internal.jobs where kind = 'close_club' and payload ->> 'club_id' = (select community from k)::text), 1, 'its images and chat are cleaned up by a job');

select * from finish();
rollback;
