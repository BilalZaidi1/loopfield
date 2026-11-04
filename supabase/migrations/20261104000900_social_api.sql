-- Client RPCs for consent, follows, blocks, posts, comments, reactions, clubs, reports, appeals,
-- notifications, route proposals, activities and account lifecycle. Every function re-checks
-- authorization server-side; hiding UI is never the control.

create or replace function internal.require_user() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v uuid := auth.uid();
begin
  if v is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v and status = 'active') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function internal.notify(p_user uuid, p_category text, p_kind text, p_actor uuid, p_object_type text, p_object_id text, p_data jsonb default '{}', p_dedupe text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and (authz.is_blocked(p_user, p_actor) or exists (select 1 from public.user_mutes where muter_id = p_user and muted_id = p_actor)) then
    return;
  end if;
  insert into public.notifications (user_id, category, kind, actor_id, object_type, object_id, data, dedupe_key)
  values (p_user, p_category, p_kind, p_actor, p_object_type, p_object_id, coalesce(p_data, '{}'::jsonb), p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
  perform internal.enqueue_job('notifications', 'push_pending', jsonb_build_object('user_id', p_user), 'push:' || p_user::text, now() + interval '5 seconds');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Consent (FR01). Withdrawing contest consent removes affected results (PRD §6 Deletion corrections).
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_consent(p_kind text, p_granted boolean, p_version text)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  insert into public.consents (user_id, kind, version, granted) values (v_user, p_kind, p_version, p_granted);
  if p_kind = 'territory_competition' then
    update public.user_settings set territory_competition_enabled = p_granted where user_id = v_user;
  elsif p_kind = 'speed_competition' then
    update public.user_settings set speed_competition_enabled = p_granted where user_id = v_user;
  elsif p_kind = 'analytics' then
    update public.user_settings set analytics_enabled = p_granted where user_id = v_user;
  end if;
  if not p_granted and p_kind in ('territory_competition', 'speed_competition') then
    perform internal.enqueue_job('account', 'withdraw_competition', jsonb_build_object('user_id', v_user, 'kind', p_kind), 'withdraw:' || v_user || ':' || p_kind);
  end if;
end $$;

create or replace function public.set_full_private_mode(p_enabled boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.user_settings set full_private_mode = p_enabled where user_id = v_user;
  if p_enabled then
    update public.profiles set discoverable = false where id = v_user;
    perform public.set_consent('territory_competition', false, 'full-private-mode');
    perform public.set_consent('speed_competition', false, 'full-private-mode');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Follows, blocks, mutes (FR37). Following never implies club membership or messaging rights.
-- ---------------------------------------------------------------------------------------------
create or replace function public.follow(p_target uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_vis text;
  v_state text;
begin
  if p_target = v_user then raise exception 'cannot follow yourself'; end if;
  if authz.is_blocked(v_user, p_target) then raise exception 'not allowed' using errcode = '42501'; end if;
  select visibility into v_vis from public.profiles where id = p_target and status = 'active';
  if not found then raise exception 'profile unavailable'; end if;
  perform internal.enforce_rate_limit(v_user::text, 'follow', 60, 3600);
  v_state := case when v_vis = 'public' then 'accepted' else 'pending' end;
  insert into public.follows (follower_id, followee_id, state, accepted_at)
  values (v_user, p_target, v_state, case when v_state = 'accepted' then now() end)
  on conflict (follower_id, followee_id) do nothing;
  select state into v_state from public.follows where follower_id = v_user and followee_id = p_target;
  perform internal.notify(p_target, 'social', case when v_state = 'accepted' then 'new_follower' else 'follow_request' end, v_user, 'profile', v_user::text, '{}', 'follow:' || v_user);
  return v_state;
end $$;

create or replace function public.unfollow(p_target uuid) returns void
language sql security definer set search_path = pg_catalog, public as $$
  delete from public.follows where follower_id = auth.uid() and followee_id = p_target;
$$;

create or replace function public.respond_follow_request(p_follower uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  if p_accept then
    update public.follows set state = 'accepted', accepted_at = now() where follower_id = p_follower and followee_id = v_user and state = 'pending';
    if found then perform internal.notify(p_follower, 'social', 'follow_accepted', v_user, 'profile', v_user::text, '{}', 'follow_ok:' || v_user); end if;
  else
    delete from public.follows where follower_id = p_follower and followee_id = v_user and state = 'pending';
  end if;
end $$;

create or replace function public.remove_follower(p_follower uuid) returns void
language sql security definer set search_path = pg_catalog, public as $$
  delete from public.follows where follower_id = p_follower and followee_id = auth.uid();
$$;

create or replace function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  if p_target = v_user then raise exception 'cannot block yourself'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_user, p_target) on conflict do nothing;
  delete from public.follows where (follower_id = v_user and followee_id = p_target) or (follower_id = p_target and followee_id = v_user);
  delete from public.reactions r using public.posts p where r.post_id = p.id and p.author_id = v_user and r.user_id = p_target;
  -- Stop new message delivery in Stream (server-side freeze), independently retryable.
  perform internal.enqueue_job('chat', 'sync_block', jsonb_build_object('a', v_user, 'b', p_target), 'block:' || least(v_user::text, p_target::text) || greatest(v_user::text, p_target::text));
end $$;

create or replace function public.unblock_user(p_target uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  delete from public.blocks where blocker_id = v_user and blocked_id = p_target;
  perform internal.enqueue_job('chat', 'sync_block', jsonb_build_object('a', v_user, 'b', p_target), 'block:' || least(v_user::text, p_target::text) || greatest(v_user::text, p_target::text));
end $$;

create or replace function public.mute_user(p_target uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  if p_muted then insert into public.user_mutes (muter_id, muted_id) values (v_user, p_target) on conflict do nothing;
  else delete from public.user_mutes where muter_id = v_user and muted_id = p_target; end if;
end $$;

create or replace function public.profile_card(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
  p public.profiles;
  v_follow text;
  v_followed_by text;
  v_can_see boolean;
  v_settings public.user_settings;
begin
  if not authz.can_view_profile(p_profile, v_user) then return null; end if;
  select * into p from public.profiles where id = p_profile;
  select state into v_follow from public.follows where follower_id = v_user and followee_id = p_profile;
  select state into v_followed_by from public.follows where follower_id = p_profile and followee_id = v_user;
  select * into v_settings from public.user_settings where user_id = p_profile;
  v_can_see := p.id = v_user or p.visibility = 'public' or v_follow = 'accepted';
  return jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'bio', case when v_can_see then p.bio end, 'city_label', case when v_can_see then p.city_label end,
    'visibility', p.visibility, 'is_me', p.id = v_user,
    'follow_state', coalesce(v_follow, 'none'), 'follows_me', coalesce(v_followed_by = 'accepted', false),
    'muted', exists (select 1 from public.user_mutes where muter_id = v_user and muted_id = p_profile),
    'blocked', exists (select 1 from public.blocks where blocker_id = v_user and blocked_id = p_profile),
    'followers', (select count(*) from public.follows where followee_id = p_profile and state = 'accepted'),
    'following', (select count(*) from public.follows where follower_id = p_profile and state = 'accepted'),
    'can_view_content', v_can_see,
    'can_message', case
      when p.id = v_user then false
      when v_settings.messages_from = 'nobody' then false
      when v_settings.messages_from = 'followers' then coalesce(v_follow = 'accepted', false)
      else coalesce(v_follow = 'accepted', false) and coalesce(v_followed_by = 'accepted', false) end,
    'titles', case when v_can_see then (select count(*) from internal.speed_titles t where t.published_champion_id = p_profile) end
  );
end $$;

create or replace function public.connections(p_profile uuid, p_kind text, p_before timestamptz default null, p_limit integer default 50)
returns table (user_id uuid, handle text, display_name text, avatar_path text, state text, since timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, authz as $$
declare
  v_user uuid := auth.uid();
  v_vis text;
begin
  select visibility into v_vis from public.profiles where id = p_profile and status = 'active';
  if not found or not authz.can_view_profile(p_profile, v_user) then return; end if;
  if p_kind = 'requests' and p_profile <> v_user then return; end if;
  if p_profile <> v_user and v_vis = 'private' and not authz.follows(v_user, p_profile) then return; end if;
  return query
  select pr.id, pr.handle::text, pr.display_name, pr.avatar_path, f.state, f.created_at
    from public.follows f
    join public.profiles pr on pr.id = case when p_kind = 'following' then f.followee_id else f.follower_id end
   where (case when p_kind = 'following' then f.follower_id else f.followee_id end) = p_profile
     and f.state = case when p_kind = 'requests' then 'pending' else 'accepted' end
     and pr.status = 'active' and not authz.is_blocked(pr.id, v_user)
     and (p_before is null or f.created_at < p_before)
   order by f.created_at desc
   limit least(p_limit, 100);
end $$;

create or replace function public.search_profiles(p_query text, p_district uuid default null, p_limit integer default 30)
returns table (user_id uuid, handle text, display_name text, avatar_path text, city_label text, follow_state text)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select p.id, p.handle::text, p.display_name, p.avatar_path, p.city_label,
         coalesce((select f.state from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id), 'none')
    from public.profiles p
   where auth.uid() is not null and p.status = 'active' and p.discoverable and p.id <> auth.uid()
     and not authz.is_blocked(p.id, auth.uid())
     and (p_district is null or p.district_id = p_district)
     and (coalesce(p_query, '') = '' or p.handle ilike replace(replace(p_query, '%', ''), '_', '\_') || '%' or p.display_name ilike '%' || replace(p_query, '%', '') || '%')
   order by p.handle
   limit least(p_limit, 50);
$$;

-- ---------------------------------------------------------------------------------------------
-- Posts (FR38–FR40, FR43)
-- ---------------------------------------------------------------------------------------------
create or replace function internal.post_row_json(p public.posts, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select jsonb_build_object(
    'id', p.id, 'audience', p.audience, 'body', p.body, 'status', p.status,
    'author', jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name, 'avatar_path', a.avatar_path),
    'club', case when p.club_id is null then null else (select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind) from public.clubs c where c.id = p.club_id) end,
    'shared_summary', p.shared_summary,
    'route', case when p.route_course_id is null then null else (select jsonb_build_object('id', c.id, 'name', c.name) from public.courses c where c.id = p.route_course_id and c.status = 'active') end,
    'comments_enabled', p.comments_enabled, 'is_announcement', p.is_announcement,
    'published_at', coalesce(p.published_at, p.created_at), 'edited_at', p.edited_at,
    'reaction_count', (select count(*) from public.reactions r where r.post_id = p.id and not authz.is_blocked(r.user_id, p_viewer)),
    'i_reacted', exists (select 1 from public.reactions r where r.post_id = p.id and r.user_id = p_viewer),
    'comment_count', (select count(*) from public.comments cm where cm.post_id = p.id and cm.status = 'visible' and not authz.is_blocked(cm.author_id, p_viewer)),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.derivative_path, 'alt', m.alt_text, 'width', m.width, 'height', m.height, 'status', m.status) order by m.position)
                         from public.post_media m where m.post_id = p.id and (m.status = 'ready' or p.author_id = p_viewer)), '[]'::jsonb),
    'is_mine', p.author_id = p_viewer
  )
  from public.profiles a where a.id = p.author_id;
$$;

create or replace function public.create_post(
  p_audience text, p_body text default null, p_club uuid default null, p_activity uuid default null,
  p_share_fields text[] default '{}', p_route_course uuid default null, p_comments_enabled boolean default true,
  p_media_count integer default 0, p_is_announcement boolean default false)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_post uuid := gen_random_uuid();
  v_summary jsonb;
  v_act public.activities;
  v_publish_after timestamptz := now();
  v_claim public.loop_claims;
  v_attempt public.speed_attempts;
  v_slots jsonb := '[]'::jsonb;
  v_handle text;
  i integer;
begin
  perform internal.enforce_rate_limit(v_user::text, 'post', 10, 3600);
  if p_audience not in ('only_me', 'followers', 'public', 'club') then raise exception 'invalid audience'; end if;
  if coalesce(btrim(p_body), '') = '' and p_activity is null and p_media_count = 0 and p_route_course is null then raise exception 'empty post'; end if;
  if p_media_count < 0 or p_media_count > 5 then raise exception 'at most five photos'; end if;
  if p_media_count > 0 and not internal.config_bool('photo_uploads_enabled') then raise exception 'photo uploads are temporarily unavailable' using errcode = 'P0503'; end if;
  if p_audience = 'club' then
    if p_club is null or not authz.is_active_member(p_club, v_user) then raise exception 'not a member' using errcode = '42501'; end if;
    if exists (select 1 from public.clubs where id = p_club and posting_policy = 'organizers') and not authz.is_organizer(p_club, v_user) then
      raise exception 'only organizers can post here' using errcode = '42501';
    end if;
  elsif p_club is not null then raise exception 'club given for a non-club audience';
  end if;
  if p_is_announcement and (p_audience <> 'club' or not authz.is_organizer(p_club, v_user)) then raise exception 'only organizers can announce' using errcode = '42501'; end if;

  -- Shared activity fields are copied from the server's own record, never from the client.
  if p_activity is not null then
    select * into v_act from public.activities where id = p_activity and user_id = v_user and deleted_at is null;
    if not found then raise exception 'activity not found'; end if;
    v_summary := jsonb_strip_nulls(jsonb_build_object(
      'distance_m', case when 'distance' = any (p_share_fields) then round(v_act.distance_m::numeric) end,
      'elapsed_ms', case when 'duration' = any (p_share_fields) then v_act.elapsed_ms end,
      'avg_pace_s_per_km', case when 'pace' = any (p_share_fields) then v_act.avg_pace_s_per_km end,
      'activity_date', case when 'date' = any (p_share_fields) then to_char(v_act.started_at at time zone 'UTC', 'YYYY-MM-DD') end));
    if 'land' = any (p_share_fields) then
      select * into v_claim from public.loop_claims where activity_id = p_activity and status = 'eligible';
      if found then
        v_summary := v_summary || jsonb_build_object('achievement', 'land_claimed', 'area_m2', round(v_claim.eligible_area_m2::numeric, -2));
        v_publish_after := greatest(v_publish_after, v_claim.publish_after);
      end if;
    end if;
    if 'title' = any (p_share_fields) then
      select sa.* into v_attempt from public.speed_attempts sa
        join internal.speed_titles t on t.benchmark_attempt_id = sa.id
       where sa.activity_id = p_activity and sa.status = 'eligible' limit 1;
      if found then
        v_summary := v_summary || jsonb_build_object('achievement_title', 'route_title');
        v_publish_after := greatest(v_publish_after, v_attempt.publish_after);
      end if;
    end if;
    if v_summary = '{}'::jsonb then v_summary := null; end if;
  end if;
  if p_route_course is not null and not exists (select 1 from public.courses where id = p_route_course and status = 'active') then
    raise exception 'route unavailable';
  end if;

  insert into public.posts (id, author_id, audience, club_id, body, activity_id, shared_summary, route_course_id, comments_enabled, is_announcement, status, publish_after, published_at)
  values (v_post, v_user, p_audience, p_club, nullif(btrim(p_body), ''), p_activity, v_summary, p_route_course, p_comments_enabled, p_is_announcement,
          case when p_media_count > 0 then 'processing' else 'published' end, v_publish_after,
          case when p_media_count > 0 then null else now() end);

  for i in 0 .. p_media_count - 1 loop
    insert into public.post_media (post_id, owner_id, position, upload_path) values (v_post, v_user, i, v_user || '/' || v_post || '/' || i || '.jpg');
    v_slots := v_slots || jsonb_build_object('position', i, 'bucket', 'media-uploads', 'path', v_user || '/' || v_post || '/' || i || '.jpg');
  end loop;

  -- Mentions never grant access; only users who can already see the post are notified.
  for v_handle in select unnest(regexp_matches(coalesce(p_body, ''), '@([A-Za-z0-9_]{3,24})', 'g')) limit 10 loop
    insert into public.mentions (post_id, mentioned_user_id, author_id)
    select v_post, pr.id, v_user from public.profiles pr where pr.handle = v_handle and pr.status = 'active' and pr.id <> v_user;
  end loop;
  if p_media_count = 0 then perform internal.notify_post_mentions(v_post); end if;
  return jsonb_build_object('post_id', v_post, 'upload_slots', v_slots, 'status', case when p_media_count > 0 then 'processing' else 'published' end);
end $$;

create or replace function internal.notify_post_mentions(p_post uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  m record;
begin
  for m in select mn.mentioned_user_id, mn.author_id from public.mentions mn where mn.post_id = p_post loop
    if authz.can_view_post(p_post, m.mentioned_user_id) then
      perform internal.notify(m.mentioned_user_id, 'social', 'mention', m.author_id, 'post', p_post::text, '{}', 'mention:' || p_post);
    end if;
  end loop;
end $$;

create or replace function public.finalize_post_media(p_post uuid, p_alt_texts text[] default '{}') returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  i integer;
begin
  if not exists (select 1 from public.posts where id = p_post and author_id = v_user and status = 'processing') then raise exception 'post not awaiting media'; end if;
  for i in 1 .. coalesce(array_length(p_alt_texts, 1), 0) loop
    update public.post_media set alt_text = left(p_alt_texts[i], 500) where post_id = p_post and position = i - 1;
  end loop;
  update public.post_media set status = 'processing' where post_id = p_post and status = 'uploaded';
  perform internal.enqueue_job('media', 'process_post_media', jsonb_build_object('post_id', p_post), 'media:' || p_post);
end $$;

create or replace function public.update_post(p_post uuid, p_body text default null, p_audience text default null, p_comments_enabled boolean default null) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v public.posts;
begin
  select * into v from public.posts where id = p_post and author_id = v_user and status in ('published', 'processing') for update;
  if not found then raise exception 'post not found'; end if;
  if p_audience is not null and p_audience <> v.audience then
    if v.audience = 'club' or p_audience = 'club' then raise exception 'club posts cannot change audience'; end if;
    if p_audience not in ('only_me', 'followers', 'public') then raise exception 'invalid audience'; end if;
  end if;
  update public.posts
     set body = case when p_body is null then body else nullif(btrim(p_body), '') end,
         audience = coalesce(p_audience, audience),
         comments_enabled = coalesce(p_comments_enabled, comments_enabled),
         edited_at = case when p_body is not null and p_body is distinct from v.body then now() else edited_at end
   where id = p_post;
end $$;

create or replace function public.delete_post(p_post uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.posts set status = 'deleted' where id = p_post and author_id = v_user and status <> 'deleted';
  if found then
    delete from public.club_pins where post_id = p_post;
    perform internal.enqueue_job('media', 'delete_post_media', jsonb_build_object('post_id', p_post), 'media-del:' || p_post);
  end if;
end $$;

-- Keyset-paginated feeds; every row passes the same authorization as direct reads.
create or replace function public.feed_following(p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  return query
  select internal.post_row_json(p, v_user)
    from public.posts p
   where (p.author_id = v_user
          or p.author_id in (select followee_id from public.follows where follower_id = v_user and state = 'accepted')
          or (p.audience = 'club' and p.club_id in (select club_id from public.club_memberships where user_id = v_user and state = 'active')))
     and authz.can_view_post_row(p.author_id, p.audience, p.club_id, p.status, p.publish_after, v_user)
     and p.status in ('published', 'processing')
     and not exists (select 1 from public.user_mutes mu where mu.muter_id = v_user and mu.muted_id = p.author_id)
     and (p_before is null or (coalesce(p.published_at, p.created_at), p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by coalesce(p.published_at, p.created_at) desc, p.id desc
   limit least(p_limit, 50);
end $$;

-- Discover: opted-in public posts by discoverable authors in a manually selected district; never
-- private clubs, never derived from live location (FR38).
create or replace function public.feed_discover(p_district uuid, p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  return query
  select internal.post_row_json(p, v_user)
    from public.posts p join public.profiles a on a.id = p.author_id
   where p.audience = 'public' and p.status = 'published' and p.publish_after <= now()
     and a.discoverable and a.status = 'active' and a.district_id = p_district
     and not authz.is_blocked(a.id, v_user)
     and not exists (select 1 from public.user_mutes mu where mu.muter_id = v_user and mu.muted_id = p.author_id)
     and (p_before is null or (p.published_at, p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(p_limit, 50);
end $$;

create or replace function public.club_feed(p_club uuid, p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not authz.is_active_member(p_club, v_user) then return; end if;
  return query
  select internal.post_row_json(p, v_user) || jsonb_build_object('pinned', exists (select 1 from public.club_pins cp where cp.club_id = p_club and cp.post_id = p.id))
    from public.posts p
   where p.club_id = p_club and p.audience = 'club'
     and authz.can_view_post_row(p.author_id, p.audience, p.club_id, p.status, p.publish_after, v_user)
     and (p_before is null or (coalesce(p.published_at, p.created_at), p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by (exists (select 1 from public.club_pins cp where cp.club_id = p_club and cp.post_id = p.id)) desc, coalesce(p.published_at, p.created_at) desc, p.id desc
   limit least(p_limit, 50);
end $$;

create or replace function public.profile_posts(p_profile uuid, p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  return query
  select internal.post_row_json(p, v_user)
    from public.posts p
   where p.author_id = p_profile and p.audience <> 'club'
     and authz.can_view_post_row(p.author_id, p.audience, p.club_id, p.status, p.publish_after, v_user)
     and (p_before is null or (coalesce(p.published_at, p.created_at), p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by coalesce(p.published_at, p.created_at) desc, p.id desc
   limit least(p_limit, 50);
end $$;

create or replace function public.post_detail(p_post uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal, authz as $$
  select internal.post_row_json(p, auth.uid()) from public.posts p
   where p.id = p_post and authz.can_view_post_row(p.author_id, p.audience, p.club_id, p.status, p.publish_after, auth.uid());
$$;

-- Internal content links resolve against the viewer's current permissions (PRD §9).
create or replace function public.resolve_content_link(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
begin
  if p_kind = 'post' then
    return coalesce(public.post_detail(p_id), jsonb_build_object('unavailable', true));
  elsif p_kind = 'route' then
    return coalesce((select jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status) from public.courses c where c.id = p_id and c.status = 'active'), jsonb_build_object('unavailable', true));
  elsif p_kind = 'club' then
    return coalesce((select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'visibility', c.visibility) from public.clubs c where c.id = p_id and authz.can_view_club(c.id, auth.uid())), jsonb_build_object('unavailable', true));
  elsif p_kind = 'profile' then
    return coalesce((select jsonb_build_object('id', pr.id, 'handle', pr.handle, 'display_name', pr.display_name) from public.profiles pr where pr.id = p_id and authz.can_view_profile(pr.id, auth.uid())), jsonb_build_object('unavailable', true));
  end if;
  return jsonb_build_object('unavailable', true);
end $$;

-- Comments and reactions inherit the parent audience; blocks are enforced both ways.
create or replace function public.add_comment(p_post uuid, p_body text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_post public.posts;
  v_id uuid;
  v_handle text;
  v_mentioned uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'comment', 60, 3600);
  select * into v_post from public.posts where id = p_post;
  if not found or not authz.can_view_post(p_post, v_user) then raise exception 'post unavailable' using errcode = '42501'; end if;
  if not v_post.comments_enabled then raise exception 'comments are disabled'; end if;
  if authz.is_blocked(v_post.author_id, v_user) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.comments (post_id, author_id, body) values (p_post, v_user, btrim(p_body)) returning id into v_id;
  perform internal.notify(v_post.author_id, 'social', 'comment', v_user, 'post', p_post::text, '{}', 'comment:' || v_id);
  for v_handle in select unnest(regexp_matches(p_body, '@([A-Za-z0-9_]{3,24})', 'g')) limit 10 loop
    insert into public.mentions (comment_id, mentioned_user_id, author_id)
    select v_id, pr.id, v_user from public.profiles pr where pr.handle = v_handle and pr.status = 'active' and pr.id <> v_user
    returning mentioned_user_id into v_mentioned;
    if found and authz.can_view_post(p_post, v_mentioned) then
      perform internal.notify(v_mentioned, 'social', 'mention', v_user, 'post', p_post::text, '{}', 'cmention:' || v_id || ':' || v_mentioned);
    end if;
  end loop;
  return v_id;
end $$;

create or replace function public.delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.comments c set status = 'deleted'
    from public.posts p
   where c.id = p_comment and p.id = c.post_id and (c.author_id = v_user or p.author_id = v_user) and c.status <> 'deleted';
end $$;

create or replace function public.post_comments(p_post uuid, p_after timestamptz default null, p_limit integer default 50)
returns table (id uuid, author_id uuid, handle text, display_name text, avatar_path text, body text, created_at timestamptz, is_mine boolean, can_delete boolean)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select c.id, c.author_id, a.handle::text, a.display_name, a.avatar_path, c.body, c.created_at, c.author_id = auth.uid(),
         c.author_id = auth.uid() or p.author_id = auth.uid()
    from public.comments c join public.posts p on p.id = c.post_id join public.profiles a on a.id = c.author_id
   where c.post_id = p_post and c.status = 'visible' and authz.can_view_post(p_post, auth.uid())
     and not authz.is_blocked(c.author_id, auth.uid()) and a.status = 'active'
     and (p_after is null or c.created_at > p_after)
   order by c.created_at
   limit least(p_limit, 100);
$$;

create or replace function public.toggle_reaction(p_post uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = p_post;
  if v_author is null or not authz.can_view_post(p_post, v_user) or authz.is_blocked(v_author, v_user) then raise exception 'post unavailable' using errcode = '42501'; end if;
  delete from public.reactions where post_id = p_post and user_id = v_user;
  if found then return false; end if;
  insert into public.reactions (post_id, user_id) values (p_post, v_user);
  perform internal.notify(v_author, 'social', 'reaction', v_user, 'post', p_post::text, '{}', 'reaction:' || p_post || ':' || v_user);
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Clubs and local communities (FR20, FR42). Membership is explicit and revocable.
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_club(p_kind text, p_name text, p_visibility text, p_join_policy text, p_description text default null,
  p_rules text default null, p_posting_policy text default 'members', p_region uuid default null, p_district uuid default null, p_city_label text default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_club uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'club_create', 3, 86400);
  if p_kind = 'community' and p_visibility <> 'public' then raise exception 'communities are public'; end if;
  insert into public.clubs (kind, name, description, rules, visibility, join_policy, posting_policy, region_id, district_id, city_label, created_by)
  values (p_kind, btrim(p_name), p_description, p_rules, p_visibility, p_join_policy, p_posting_policy, p_region, p_district, p_city_label, v_user)
  returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, state) values (v_club, v_user, 'owner', 'active');
  if p_region is not null then
    insert into public.competitions (kind, region_id, club_id, name) values ('club', p_region, v_club, btrim(p_name) || ' season');
  end if;
  perform internal.audit(v_user, 'organizer', 'club_created', 'club', v_club::text, '{}');
  return v_club;
end $$;

create or replace function public.update_club(p_club uuid, p_name text default null, p_description text default null, p_rules text default null,
  p_posting_policy text default null, p_join_policy text default null, p_city_label text default null) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  update public.clubs set name = coalesce(btrim(p_name), name), description = coalesce(p_description, description), rules = coalesce(p_rules, rules),
         posting_policy = coalesce(p_posting_policy, posting_policy), join_policy = coalesce(p_join_policy, join_policy), city_label = coalesce(p_city_label, city_label)
   where id = p_club;
  perform internal.audit(v_user, 'organizer', 'club_updated', 'club', p_club::text, '{}');
end $$;

create or replace function public.join_club(p_club uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_club public.clubs;
  v_state text;
  r record;
begin
  select * into v_club from public.clubs where id = p_club and status = 'active';
  if not found then raise exception 'club unavailable'; end if;
  select state into v_state from public.club_memberships where club_id = p_club and user_id = v_user;
  if v_state = 'active' then return 'active'; end if;
  if v_state = 'invited' then
    update public.club_memberships set state = 'active', decided_by = v_user where club_id = p_club and user_id = v_user;
    return 'active';
  end if;
  if v_club.join_policy = 'invite_only' then raise exception 'invitation required' using errcode = '42501'; end if;
  v_state := case when v_club.join_policy = 'open' then 'active' else 'requested' end;
  insert into public.club_memberships (club_id, user_id, role, state) values (p_club, v_user, 'member', v_state)
  on conflict (club_id, user_id) do update set state = excluded.state, role = 'member', updated_at = now()
    where public.club_memberships.state in ('left', 'declined', 'requested');
  if v_state = 'requested' then
    for r in select user_id from public.club_memberships where club_id = p_club and state = 'active' and role in ('owner', 'organizer') loop
      perform internal.notify(r.user_id, 'club', 'club_join_request', v_user, 'club', p_club::text, '{}', 'clubreq:' || p_club || ':' || v_user);
    end loop;
  end if;
  return v_state;
end $$;

create or replace function public.leave_club(p_club uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  if exists (select 1 from public.club_memberships where club_id = p_club and user_id = v_user and role = 'owner' and state = 'active') then
    raise exception 'transfer ownership before leaving';
  end if;
  update public.club_memberships set state = 'left', role = 'member' where club_id = p_club and user_id = v_user and state in ('active', 'requested', 'invited');
end $$;

create or replace function public.invite_to_club(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  if authz.is_blocked(v_user, p_user) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform internal.enforce_rate_limit(v_user::text, 'club_invite', 100, 86400);
  insert into public.club_memberships (club_id, user_id, role, state, invited_by) values (p_club, p_user, 'member', 'invited', v_user)
  on conflict (club_id, user_id) do update set state = 'invited', invited_by = v_user, updated_at = now()
    where public.club_memberships.state in ('left', 'declined', 'removed', 'requested');
  perform internal.notify(p_user, 'club', 'club_invite', v_user, 'club', p_club::text, '{}', 'clubinv:' || p_club);
end $$;

create or replace function public.invite_to_club_by_email(p_club uuid, p_email text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
declare
  v_user uuid := internal.require_user();
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_hash text := encode(digest(lower(btrim(p_email)), 'sha256'), 'hex');
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  perform internal.enforce_rate_limit(v_user::text, 'club_email_invite', 50, 86400);
  insert into internal.club_email_invitations (club_id, inviter_id, email_hash, token_hash, expires_at)
  values (p_club, v_user, v_hash, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '14 days')
  on conflict (club_id, email_hash) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, status = 'pending', inviter_id = v_user;
  -- The raw address and token exist only inside the job payload, which is cleared once sent.
  perform internal.enqueue_job('email', 'club_invitation', jsonb_build_object('club_id', p_club, 'inviter_id', v_user, 'to', lower(btrim(p_email)), 'token', v_token), null);
end $$;

create or replace function public.accept_club_email_invite(p_token text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_user uuid := internal.require_user();
  v_inv internal.club_email_invitations;
begin
  select * into v_inv from internal.club_email_invitations
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'invitation invalid or expired'; end if;
  update internal.club_email_invitations set status = 'accepted', accepted_by = v_user where id = v_inv.id;
  insert into public.club_memberships (club_id, user_id, role, state, invited_by) values (v_inv.club_id, v_user, 'member', 'active', v_inv.inviter_id)
  on conflict (club_id, user_id) do update set state = 'active', updated_at = now() where public.club_memberships.state <> 'active';
  return v_inv.club_id;
end $$;

create or replace function public.respond_club_invite(p_club uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.club_memberships set state = case when p_accept then 'active' else 'declined' end, decided_by = v_user
   where club_id = p_club and user_id = v_user and state = 'invited';
  if not found then raise exception 'no pending invitation'; end if;
end $$;

create or replace function public.decide_join_request(p_club uuid, p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  update public.club_memberships set state = case when p_approve then 'active' else 'declined' end, decided_by = v_user
   where club_id = p_club and user_id = p_user and state = 'requested';
  if found and p_approve then perform internal.notify(p_user, 'club', 'club_request_approved', v_user, 'club', p_club::text, '{}', 'clubok:' || p_club); end if;
  perform internal.audit(v_user, 'organizer', case when p_approve then 'join_approved' else 'join_declined' end, 'club', p_club::text, jsonb_build_object('user', p_user));
end $$;

create or replace function public.remove_club_member(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_actor_role text := authz.club_role(p_club, v_user);
  v_target_role text;
begin
  select role into v_target_role from public.club_memberships where club_id = p_club and user_id = p_user and state = 'active';
  if v_actor_role is null or v_actor_role = 'member' then raise exception 'organizers only' using errcode = '42501'; end if;
  if v_target_role = 'owner' or (v_target_role = 'organizer' and v_actor_role <> 'owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  -- Removal revokes private feed and media access immediately (RLS evaluates membership at read time).
  update public.club_memberships set state = 'removed', role = 'member', decided_by = v_user where club_id = p_club and user_id = p_user;
  delete from public.club_pins where club_id = p_club and post_id in (select id from public.posts where author_id = p_user);
  perform internal.audit(v_user, 'organizer', 'member_removed', 'club', p_club::text, jsonb_build_object('user', p_user));
end $$;

create or replace function public.set_club_role(p_club uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if authz.club_role(p_club, v_user) <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  if p_role not in ('organizer', 'member', 'owner') then raise exception 'invalid role'; end if;
  if p_role = 'owner' then
    update public.club_memberships set role = 'organizer' where club_id = p_club and user_id = v_user;
  end if;
  update public.club_memberships set role = p_role where club_id = p_club and user_id = p_user and state = 'active';
  if not found then raise exception 'not an active member'; end if;
  perform internal.audit(v_user, 'organizer', 'role_changed', 'club', p_club::text, jsonb_build_object('user', p_user, 'role', p_role));
end $$;

create or replace function public.pin_club_post(p_club uuid, p_post uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  if p_pinned then
    if not exists (select 1 from public.posts where id = p_post and club_id = p_club and status = 'published') then raise exception 'post not in club'; end if;
    insert into public.club_pins (club_id, post_id, pinned_by) values (p_club, p_post, v_user) on conflict do nothing;
  else
    delete from public.club_pins where club_id = p_club and post_id = p_post;
  end if;
end $$;

-- Scoped organizer moderation inside their own club; organizers have no scoring powers (FR24).
create or replace function public.club_remove_post(p_club uuid, p_post uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  update public.posts set status = 'removed', removed_reason = left(p_reason, 200) where id = p_post and club_id = p_club and status = 'published';
  if found then
    delete from public.club_pins where post_id = p_post;
    perform internal.audit(v_user, 'organizer', 'club_post_removed', 'post', p_post::text, jsonb_build_object('club', p_club, 'reason', p_reason));
  end if;
end $$;

create or replace function public.club_detail(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
  c public.clubs;
  m public.club_memberships;
begin
  if not authz.can_view_club(p_club, v_user) then return null; end if;
  select * into c from public.clubs where id = p_club;
  select * into m from public.club_memberships where club_id = p_club and user_id = v_user;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'name', c.name, 'description', c.description, 'rules', c.rules,
    'visibility', c.visibility, 'join_policy', c.join_policy, 'posting_policy', c.posting_policy,
    'city_label', c.city_label, 'avatar_path', c.avatar_path, 'status', c.status,
    'my_role', case when m.state = 'active' then m.role end, 'my_state', coalesce(m.state, 'none'),
    'member_count', (select count(*) from public.club_memberships where club_id = p_club and state = 'active'),
    'pending_requests', case when authz.is_organizer(p_club, v_user) then (select count(*) from public.club_memberships where club_id = p_club and state = 'requested') end,
    'competition_id', (select id from public.competitions where club_id = p_club and status = 'active'),
    'organizers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'role', cm.role)), '[]'::jsonb)
                     from public.club_memberships cm join public.profiles p on p.id = cm.user_id
                    where cm.club_id = p_club and cm.state = 'active' and cm.role in ('owner', 'organizer') and p.status = 'active')
  );
end $$;

create or replace function public.club_members(p_club uuid, p_state text default 'active', p_limit integer default 100)
returns table (user_id uuid, handle text, display_name text, avatar_path text, role text, state text, since timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, authz as $$
begin
  if p_state = 'active' and not authz.is_active_member(p_club, auth.uid()) then return; end if;
  if p_state <> 'active' and not authz.is_organizer(p_club, auth.uid()) then return; end if;
  return query
  select p.id, p.handle::text, p.display_name, p.avatar_path, m.role, m.state, m.updated_at
    from public.club_memberships m join public.profiles p on p.id = m.user_id
   where m.club_id = p_club and m.state = p_state and p.status = 'active' and not authz.is_blocked(p.id, auth.uid())
   order by case m.role when 'owner' then 0 when 'organizer' then 1 else 2 end, p.handle
   limit least(p_limit, 500);
end $$;

create or replace function public.discover_clubs(p_district uuid default null, p_query text default null, p_limit integer default 30)
returns table (id uuid, kind text, name text, city_label text, visibility text, join_policy text, member_count bigint, my_state text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.kind, c.name, c.city_label, c.visibility, c.join_policy,
         (select count(*) from public.club_memberships m where m.club_id = c.id and m.state = 'active'),
         coalesce((select m.state from public.club_memberships m where m.club_id = c.id and m.user_id = auth.uid()), 'none')
    from public.clubs c
   where auth.uid() is not null and c.status = 'active' and c.visibility = 'public'
     and (p_district is null or c.district_id = p_district)
     and (coalesce(p_query, '') = '' or c.name ilike '%' || replace(p_query, '%', '') || '%')
   order by c.name limit least(p_limit, 50);
$$;

create or replace function public.my_clubs()
returns table (id uuid, kind text, name text, visibility text, role text, state text, member_count bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.kind, c.name, c.visibility, m.role, m.state,
         (select count(*) from public.club_memberships x where x.club_id = c.id and x.state = 'active')
    from public.club_memberships m join public.clubs c on c.id = m.club_id
   where m.user_id = auth.uid() and m.state in ('active', 'invited', 'requested') and c.status <> 'archived'
   order by m.state, c.name;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reports and appeals (FR44, PRD §12)
-- ---------------------------------------------------------------------------------------------
create or replace function internal.open_moderation_case(p_object_type text, p_object_id text, p_category text, p_subject uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_case uuid;
begin
  select id into v_case from public.moderation_cases where object_type = p_object_type and object_id = p_object_id and status in ('open', 'in_review');
  if v_case is null then
    insert into public.moderation_cases (object_type, object_id, subject_user_id, priority)
    values (p_object_type, p_object_id, p_subject, case when p_category in ('self_harm', 'violence', 'unsafe_area', 'privacy', 'sexual') then 'urgent' else 'normal' end)
    returning id into v_case;
  end if;
  update public.moderation_cases set report_count = report_count + 1,
         priority = case when p_category in ('self_harm', 'violence', 'unsafe_area', 'privacy', 'sexual') then 'urgent' else priority end
   where id = v_case;
  return v_case;
end $$;

create or replace function public.submit_report(p_object_type text, p_object_id text, p_category text, p_details text default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_subject uuid;
  v_case uuid;
  v_report uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'report', 20, 86400);
  if p_object_type = 'message' then raise exception 'report messages through the chat endpoint so evidence can be captured'; end if;
  v_subject := case p_object_type
    when 'post' then (select author_id from public.posts where id = p_object_id::uuid)
    when 'comment' then (select author_id from public.comments where id = p_object_id::uuid)
    when 'profile' then p_object_id::uuid
    when 'club' then (select created_by from public.clubs where id = p_object_id::uuid)
    when 'route' then (select creator_id from public.courses where id = p_object_id::uuid)
    else null end;
  v_case := internal.open_moderation_case(p_object_type, p_object_id, p_category, v_subject);
  insert into public.reports (reporter_id, object_type, object_id, category, details, case_id)
  values (v_user, p_object_type, p_object_id, p_category, left(p_details, 1000), v_case) returning id into v_report;
  return v_report;
end $$;

create or replace function public.submit_appeal(p_object_type text, p_object_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_decided timestamptz;
  v_id uuid;
begin
  v_decided := case p_object_type
    when 'loop_claim' then (select coalesce(invalidated_at, validated_at) from public.loop_claims where id = p_object_id and user_id = v_user)
    when 'speed_attempt' then (select coalesce(validated_at, updated_at) from public.speed_attempts where id = p_object_id and user_id = v_user)
    when 'post' then (select updated_at from public.posts where id = p_object_id and author_id = v_user and status = 'removed')
    when 'comment' then (select coalesce(edited_at, created_at) from public.comments where id = p_object_id and author_id = v_user and status = 'removed')
    when 'route_proposal' then (select decided_at from public.route_proposals where id = p_object_id and creator_id = v_user)
    when 'moderation_case' then (select resolved_at from public.moderation_cases where id = p_object_id and subject_user_id = v_user)
    else null end;
  if v_decided is null then raise exception 'nothing to appeal' using errcode = '42501'; end if;
  if v_decided < now() - interval '7 days' then raise exception 'the seven-day appeal window has closed'; end if;
  insert into public.appeals (user_id, object_type, object_id, reason) values (v_user, p_object_type, p_object_id, btrim(p_reason)) returning id into v_id;
  if p_object_type in ('loop_claim', 'speed_attempt') then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by) values (p_object_type, p_object_id, v_user, 'appeal');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = pg_catalog, public as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

create or replace function public.badge_counts() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'follow_requests', (select count(*) from public.follows where followee_id = auth.uid() and state = 'pending'),
    'club_invites', (select count(*) from public.club_memberships where user_id = auth.uid() and state = 'invited'));
$$;

create or replace function public.messaging_eligibility(p_target uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, authz as $$
declare
  v_user uuid := auth.uid();
  v_setting text;
  v_ok boolean;
begin
  if not internal.config_bool('messaging_enabled') then return jsonb_build_object('allowed', false, 'reason', 'messaging_suspended'); end if;
  if v_user is null or p_target = v_user then return jsonb_build_object('allowed', false, 'reason', 'self'); end if;
  if authz.is_blocked(v_user, p_target) then return jsonb_build_object('allowed', false, 'reason', 'blocked'); end if;
  select messages_from into v_setting from public.user_settings where user_id = p_target;
  v_ok := case v_setting
    when 'nobody' then false
    when 'followers' then authz.follows(v_user, p_target)
    else authz.follows(v_user, p_target) and authz.follows(p_target, v_user) end;
  return jsonb_build_object('allowed', coalesce(v_ok, false), 'reason', case when coalesce(v_ok, false) then 'ok' else 'not_allowed' end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Activities, route proposals and account lifecycle
-- ---------------------------------------------------------------------------------------------
create or replace function public.activity_detail(p_activity uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select jsonb_build_object(
    'activity', to_jsonb(a) - 'events' - 'evidence_digest' - 'device',
    'claim', (select to_jsonb(lc) - 'polygon' || jsonb_build_object('polygon', extensions.st_asgeojson(lc.polygon, 6)::jsonb)
                from public.loop_claims lc where lc.activity_id = a.id),
    'attempts', coalesce((select jsonb_agg(to_jsonb(sa) || jsonb_build_object('course_name', c.name,
                   'is_benchmark', exists (select 1 from internal.speed_titles t where t.benchmark_attempt_id = sa.id),
                   'is_published_champion', exists (select 1 from internal.speed_titles t where t.published_benchmark_attempt_id = sa.id)))
                from public.speed_attempts sa join public.course_versions cv on cv.id = sa.course_version_id join public.courses c on c.id = cv.course_id
               where sa.activity_id = a.id), '[]'::jsonb),
    'title_context', coalesce((select jsonb_agg(jsonb_build_object('attempt_id', sa.id, 'benchmark_ms', t.benchmark_ms, 'champion_is_me', t.champion_id = auth.uid()))
                from public.speed_attempts sa join internal.speed_titles t on t.course_version_id = sa.course_version_id and t.competition_id = sa.competition_id and t.season_id = sa.season_id
               where sa.activity_id = a.id), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', rp.id, 'status', rp.status, 'name', rp.name)) from public.route_proposals rp where rp.source_activity_id = a.id), '[]'::jsonb)
  )
  from public.activities a where a.id = p_activity and a.user_id = auth.uid() and a.deleted_at is null;
$$;

create or replace function public.delete_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.activities set deleted_at = now(), status = 'deleted' where id = p_activity and user_id = v_user and deleted_at is null;
  if not found then raise exception 'activity not found'; end if;
  -- Shared summaries referencing this run are withdrawn immediately (PRD §11).
  update public.posts set shared_summary = null, activity_id = null where activity_id = p_activity;
  perform internal.enqueue_job('account', 'delete_activity', jsonb_build_object('activity_id', p_activity, 'user_id', v_user), 'delact:' || p_activity);
end $$;

create or replace function public.propose_route(p_activity uuid, p_name text, p_consent_version text, p_score_founding_run boolean default false) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_id uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'route_proposal', 5, 86400);
  if not exists (select 1 from public.activities where id = p_activity and user_id = v_user and deleted_at is null and status = 'processed') then
    raise exception 'activity must be processed before proposing a route';
  end if;
  if exists (select 1 from public.route_proposals where source_activity_id = p_activity and status in ('processing', 'pending_review', 'approved')) then
    raise exception 'a proposal for this activity already exists';
  end if;
  insert into public.consents (user_id, kind, version, granted) values (v_user, 'route_publication', p_consent_version, true);
  insert into public.route_proposals (creator_id, source_activity_id, name, consent_version, score_founding_run)
  values (v_user, p_activity, btrim(p_name), p_consent_version, p_score_founding_run) returning id into v_id;
  perform internal.enqueue_job('speed', 'build_route_proposal', jsonb_build_object('proposal_id', v_id), 'proposal:' || v_id);
  return v_id;
end $$;

create or replace function public.withdraw_route_proposal(p_proposal uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v public.route_proposals;
begin
  select * into v from public.route_proposals where id = p_proposal and creator_id = v_user for update;
  if not found then raise exception 'proposal not found'; end if;
  insert into public.consents (user_id, kind, version, granted) values (v_user, 'route_publication', v.consent_version, false);
  update public.route_proposals set status = 'withdrawn', decided_at = coalesce(decided_at, now()) where id = p_proposal;
  -- Withdrawing publication permission withdraws the published geometry and dependent displays.
  if v.status = 'approved' and v.canonical_course_id is not null
     and exists (select 1 from public.courses where id = v.canonical_course_id and creator_id = v_user) then
    perform internal.withdraw_course(v.canonical_course_id, 'creator_withdrew_consent', v_user);
  end if;
end $$;

create or replace function public.request_data_export() returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_id uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'export', 3, 86400);
  insert into public.data_exports (user_id) values (v_user) returning id into v_id;
  perform internal.enqueue_job('account', 'export_data', jsonb_build_object('export_id', v_id, 'user_id', v_user), 'export:' || v_id);
  return v_id;
end $$;

create or replace function public.request_account_deletion(p_confirmation text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_confirmation <> 'DELETE' then raise exception 'type DELETE to confirm'; end if;
  select id into v_id from public.deletion_requests where user_id = v_user and status in ('queued', 'running');
  if v_id is not null then return v_id; end if;
  insert into public.deletion_requests (user_id) values (v_user) returning id into v_id;
  -- Public identity disappears immediately; the job removes everything else.
  update public.profiles set status = 'deleted', discoverable = false, display_name = 'Deleted runner', bio = null, avatar_path = null where id = v_user;
  perform internal.enqueue_job('account', 'delete_account', jsonb_build_object('request_id', v_id, 'user_id', v_user), 'delacct:' || v_user, now(), 20);
  return v_id;
end $$;
