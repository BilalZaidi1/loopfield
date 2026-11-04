-- Social authorization matrix: follows, audiences, clubs, removal, blocks, mentions, comments,
-- media objects and messaging eligibility (FR20, FR22, FR37–FR43, Appendix A social cases).
begin;
select plan(30);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'author@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'follower@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'stranger@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'member@example.test');
update public.profiles set handle = 'author1' where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'follower1' where id = 'b0000000-0000-4000-8000-000000000002';
update public.profiles set handle = 'stranger1' where id = 'c0000000-0000-4000-8000-000000000003';
update public.profiles set handle = 'member1' where id = 'd0000000-0000-4000-8000-000000000004';

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Private profile (default): follow requests need approval.
set local role authenticated; select pg_temp.as_user('b0000000-0000-4000-8000-000000000002');
select is(public.follow('a0000000-0000-4000-8000-000000000001'), 'pending', 'following a private profile creates a request');
reset role;
set local role authenticated; select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
select lives_ok($$select public.respond_follow_request('b0000000-0000-4000-8000-000000000002', true)$$, 'author approves the request');
create temp table posts as select
  (public.create_post('followers', 'For followers @stranger1') ->> 'post_id')::uuid as followers_post,
  (public.create_post('public', 'Hello everyone') ->> 'post_id')::uuid as public_post,
  (public.create_post('only_me', 'Note to self') ->> 'post_id')::uuid as private_post;
select is((select count(*)::int from public.mentions where mentioned_user_id = 'c0000000-0000-4000-8000-000000000003'), 1, 'mention recorded');
select is((select count(*)::int from public.notifications where user_id = 'c0000000-0000-4000-8000-000000000003' and kind = 'mention'), 0, 'mention of a non-viewer creates no notification and grants no access');
-- Private club with the author as owner.
create temp table club as select public.create_club('club', 'Dawn Runners', 'private', 'request', 'Early runs', null, 'members', '00000000-0000-4000-8000-000000000001') as id;
select lives_ok($$select public.invite_to_club((select id from club), 'd0000000-0000-4000-8000-000000000004')$$, 'owner invites a member');
create temp table club_post as select (public.create_post('club', 'Saturday 6am loop', (select id from club)) ->> 'post_id')::uuid as id;
reset role;

set local role authenticated; select pg_temp.as_user('d0000000-0000-4000-8000-000000000004');
select lives_ok($$select public.respond_club_invite((select id from club), true)$$, 'member accepts invitation');
reset role;

-- Follower sees followers + public posts, not only-me, not club.
set local role authenticated; select pg_temp.as_user('b0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.posts where id in ((select followers_post from posts), (select public_post from posts))), 2, 'follower sees followers and public posts');
select is((select count(*)::int from public.posts where id = (select private_post from posts)), 0, 'follower cannot see only-me posts');
select is((select count(*)::int from public.posts where id = (select id from club_post)), 0, 'following a club member does not reveal club posts');
select is((select count(*)::int from public.feed_following()), 2, 'following feed returns exactly the authorized posts');
select ok(public.club_detail((select id from club)) is null, 'private club is invisible to non-members without an invitation');
reset role;

-- Stranger sees public only, even though mentioned.
set local role authenticated; select pg_temp.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.posts), 1, 'stranger sees only the public post');
select is(public.post_detail((select followers_post from posts)), null, 'mention does not grant access to the followers-only post');
select throws_ok($$select public.add_comment((select followers_post from posts), 'hi')$$, '42501', null, 'cannot comment on an unauthorized post');
select lives_ok($$select public.add_comment((select public_post from posts), 'nice')$$, 'can comment on a public post');
select is(public.toggle_reaction((select public_post from posts)), true, 'reaction added');
select is(public.toggle_reaction((select public_post from posts)), false, 'reaction is reversible');
select is((public.messaging_eligibility('a0000000-0000-4000-8000-000000000001') ->> 'allowed')::boolean, false, 'no messaging without mutual follow (default)');
reset role;

-- Club member access, then removal revokes it everywhere.
set local role authenticated; select pg_temp.as_user('d0000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.club_feed((select id from club))), 1, 'member sees the club feed');
reset role;
insert into public.post_media (post_id, owner_id, position, upload_path, derivative_path, status)
values ((select id from club_post), 'a0000000-0000-4000-8000-000000000001', 0, 'u/x/0.jpg', (select id from club_post) || '/m0.jpg', 'ready');
insert into storage.objects (bucket_id, name) values ('post-media', (select id from club_post) || '/m0.jpg');
set local role authenticated; select pg_temp.as_user('d0000000-0000-4000-8000-000000000004');
select is((select count(*)::int from storage.objects where bucket_id = 'post-media'), 1, 'member can read the club photo object');
reset role;
set local role authenticated; select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
select lives_ok($$select public.remove_club_member((select id from club), 'd0000000-0000-4000-8000-000000000004')$$, 'organizer removes the member');
reset role;
set local role authenticated; select pg_temp.as_user('d0000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.club_feed((select id from club))), 0, 'removed member loses the private feed');
select is((select count(*)::int from storage.objects where bucket_id = 'post-media'), 0, 'removed member loses media object access');
select is((select count(*)::int from public.posts where club_id = (select id from club)), 0, 'removed member cannot fetch club posts by id');
reset role;

-- Blocks hide identity surfaces and content both ways.
set local role authenticated; select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
select lives_ok($$select public.block_user('c0000000-0000-4000-8000-000000000003')$$, 'author blocks the stranger');
reset role;
set local role authenticated; select pg_temp.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.posts where author_id = 'a0000000-0000-4000-8000-000000000001'), 0, 'blocked user cannot see the author''s public post');
select is((select count(*)::int from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'), 0, 'blocked user cannot see the author''s profile');
select throws_ok($$select public.follow('a0000000-0000-4000-8000-000000000001')$$, '42501', null, 'blocked user cannot follow');
reset role;
select is((select count(*)::int from internal.jobs where kind = 'sync_block'), 1, 'block enqueues a server-side chat freeze');

-- Mutual follow enables messaging by default.
set local role authenticated; select pg_temp.as_user('a0000000-0000-4000-8000-000000000001');
select public.follow('b0000000-0000-4000-8000-000000000002');
reset role;
set local role authenticated; select pg_temp.as_user('b0000000-0000-4000-8000-000000000002');
select public.respond_follow_request('a0000000-0000-4000-8000-000000000001', true);
select is((public.messaging_eligibility('a0000000-0000-4000-8000-000000000001') ->> 'allowed')::boolean, true, 'mutual followers may message');
reset role;

select * from finish();
rollback;
