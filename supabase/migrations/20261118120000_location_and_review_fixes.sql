-- Location for a global app, and three fixes found while the app followed the back office (18 Nov).
--   * Profiles carry a country (ISO 3166-1 alpha-2) and a city name, found once on the runner's phone by
--     the phone's own geocoder and editable. Country and city rankings, Discover and the community lists
--     use them instead of drawn districts. The neighbourhood stays private (user_settings, readable only
--     by its owner) and shows on the profile only when the runner chooses to show it.
--     Drawn districts stay for the territory game; a profile's district is now set only when the phone
--     finds the runner inside one, never picked by hand.
--   * Drawn avatars can be saved while profile photo uploads are paused, as the switch promises.
--   * Suspended runners can ask for a review of their suspension (once per suspension) and of other
--     decisions; deleted accounts cannot.
--   * Lost land says "reclaim_paused" when reclaiming is switched off, not "season_closed".

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists country_code text check (country_code ~ '^[A-Z]{2}$'),
  -- When the account last changed status (for example the start of a suspension); set by a trigger.
  add column if not exists status_changed_at timestamptz;
grant update (country_code) on public.profiles to authenticated;

alter table public.user_settings
  add column if not exists area_label text check (char_length(btrim(area_label)) between 1 and 60),
  add column if not exists show_area boolean not null default false;
grant update (area_label, show_area) on public.user_settings to authenticated;

alter table public.clubs
  add column if not exists country_code text check (country_code ~ '^[A-Z]{2}$');

-- Existing rows: a profile with a district takes its region's country; clubs take their region's
-- country, else their creator's; suspended accounts date their suspension from the audit log.
update public.profiles p set country_code = r.country_code
  from public.districts d join public.regions r on r.id = d.region_id
 where d.id = p.district_id and p.country_code is null and r.country_code ~ '^[A-Z]{2}$';
update public.clubs c set country_code = coalesce(
    (select r.country_code from public.regions r where r.id = c.region_id and r.country_code ~ '^[A-Z]{2}$'),
    (select p.country_code from public.profiles p where p.id = c.created_by))
 where c.country_code is null;
update public.profiles p set status_changed_at = coalesce(
    (select max(a.created_at) from internal.audit_log a
      where a.action = 'user_suspended' and a.object_type = 'profile' and a.object_id = p.id::text),
    p.updated_at)
 where p.status <> 'active' and p.status_changed_at is null;

create or replace function internal.stamp_status_change() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := clock_timestamp(); end if;
  return new;
end $$;
drop trigger if exists profiles_status_changed on public.profiles;
create trigger profiles_status_changed before update of status on public.profiles
  for each row execute function internal.stamp_status_change();

-- No city, no neighbourhood inside it: clearing a profile's city (the runner, or staff resetting the
-- field) also clears the private area and stops showing it.
create or replace function internal.clear_area_with_city() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.user_settings set area_label = null, show_area = false
   where user_id = new.id and (area_label is not null or show_area);
  return null;
end $$;
drop trigger if exists profiles_city_cleared on public.profiles;
create trigger profiles_city_cleared after update of city_label on public.profiles
  for each row when (new.city_label is null and old.city_label is not null) execute function internal.clear_area_with_city();

-- A community's home country: its region's, else its creator's (the app sends the creator's city).
create or replace function internal.club_home_country() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.country_code is null then
    new.country_code := coalesce(
      (select r.country_code from public.regions r where r.id = new.region_id and r.country_code ~ '^[A-Z]{2}$'),
      (select p.country_code from public.profiles p where p.id = new.created_by));
  end if;
  return new;
end $$;
drop trigger if exists clubs_home_country on public.clubs;
create trigger clubs_home_country before insert on public.clubs
  for each row execute function internal.club_home_country();

/** A city name for matching: trimmed, inner spaces collapsed, lower case; null when blank. */
create or replace function internal.city_key(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

-- ---------------------------------------------------------------------------------------------
-- Profile card: country with the city; the area only when its owner shows it
-- ---------------------------------------------------------------------------------------------
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
    'country_code', case when v_can_see then p.country_code end,
    'area_label', case when v_can_see and p.city_label is not null and (p.id = v_user or coalesce(v_settings.show_area, false)) then v_settings.area_label end,
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

-- ---------------------------------------------------------------------------------------------
-- Discover by country and city (the district filter stays for app versions that still send it)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.search_profiles(text, uuid, integer);
create function public.search_profiles(p_query text, p_district uuid default null, p_limit integer default 30,
                                       p_country text default null, p_city text default null)
returns table (user_id uuid, handle text, display_name text, avatar_path text, city_label text, follow_state text, country_code text)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select p.id, p.handle::text, p.display_name, p.avatar_path, p.city_label,
         coalesce((select f.state from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id), 'none'),
         p.country_code
    from public.profiles p
   where auth.uid() is not null and p.status = 'active' and p.discoverable and p.id <> auth.uid()
     and not authz.is_blocked(p.id, auth.uid())
     and (p_district is null or p.district_id = p_district)
     and (p_country is null or p.country_code = upper(btrim(p_country)))
     and (p_city is null or internal.city_key(p.city_label) = internal.city_key(p_city))
     and (coalesce(p_query, '') = '' or p.handle ilike replace(replace(p_query, '%', ''), '_', '\_') || '%' or p.display_name ilike '%' || replace(p_query, '%', '') || '%')
   order by p.handle
   limit least(p_limit, 50);
$$;

-- Discover feed: opted-in public posts by discoverable authors in a place the runner chose (their
-- profile's city and country, or an older app's district); never private clubs, never live location.
drop function if exists public.feed_discover(uuid, timestamptz, uuid, integer);
create function public.feed_discover(p_district uuid default null, p_before timestamptz default null, p_before_id uuid default null,
                                     p_limit integer default 20, p_country text default null, p_city text default null)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or (p_district is null and p_country is null) then return; end if;
  return query
  select internal.post_row_json(p, v_user)
    from public.posts p join public.profiles a on a.id = p.author_id
   where p.audience = 'public' and p.status = 'published' and p.publish_after <= now()
     and a.discoverable and a.status = 'active'
     and (p_district is null or a.district_id = p_district)
     and (p_country is null or a.country_code = upper(btrim(p_country)))
     and (p_city is null or internal.city_key(a.city_label) = internal.city_key(p_city))
     and not authz.is_blocked(a.id, v_user)
     and not exists (select 1 from public.user_mutes mu where mu.muter_id = v_user and mu.muted_id = p.author_id)
     and (p_before is null or (p.published_at, p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(p_limit, 50);
end $$;

drop function if exists public.discover_clubs(uuid, text, integer);
create function public.discover_clubs(p_district uuid default null, p_query text default null, p_limit integer default 30,
                                      p_country text default null, p_city text default null)
returns table (id uuid, kind text, name text, city_label text, visibility text, join_policy text, member_count bigint, my_state text, avatar_path text, artwork text, tone text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.kind, c.name, c.city_label, c.visibility, c.join_policy,
         (select count(*) from public.club_memberships m where m.club_id = c.id and m.state = 'active'),
         coalesce((select m.state from public.club_memberships m where m.club_id = c.id and m.user_id = auth.uid()), 'none'),
         c.avatar_path, c.artwork, c.tone
    from public.clubs c
   where auth.uid() is not null and c.status = 'active' and c.visibility = 'public' and c.kind = 'community'
     and (p_district is null or c.district_id = p_district)
     and (p_country is null or c.country_code = upper(btrim(p_country)))
     and (p_city is null or internal.city_key(c.city_label) = internal.city_key(p_city))
     and (coalesce(p_query, '') = '' or c.name ilike '%' || replace(p_query, '%', '') || '%')
   order by c.name limit least(p_limit, 50);
$$;

-- ---------------------------------------------------------------------------------------------
-- Achievement ranking: country and city from the profile ('region' is the older name of 'city')
-- ---------------------------------------------------------------------------------------------
/**
 * Global achievement leaderboard. Scope: everyone, country or city (from the viewer's profile; a
 * profile without a country falls back to its district's region), friends (mutual follows) or club
 * (members of a club the viewer belongs to). Movement points never count. Runners the viewer may not
 * identify are ranked as "Private runner".
 */
create or replace function public.achievement_leaderboard(p_scope text default 'everyone', p_club uuid default null, p_limit integer default 50)
returns table (rank bigint, user_id uuid, handle text, display_name text, avatar_path text, score integer, badges integer,
               categories integer, top_tier text, is_me boolean, hidden boolean, total bigint)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_viewer uuid := auth.uid();
  v_scope text := case when p_scope = 'region' then 'city' else p_scope end;
  v_country text;
  v_city text;
begin
  if v_viewer is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_scope not in ('everyone', 'country', 'city', 'friends', 'club') then raise exception 'bad scope' using errcode = '22023'; end if;
  select coalesce(p.country_code, r.country_code), internal.city_key(p.city_label) into v_country, v_city
    from public.profiles p left join public.districts d on d.id = p.district_id left join public.regions r on r.id = d.region_id
   where p.id = v_viewer;
  if v_scope = 'city' and (v_city is null or v_country is null) then raise exception 'set_city' using errcode = 'P0404'; end if;
  if v_scope = 'country' and v_country is null then raise exception 'no_country' using errcode = 'P0404'; end if;
  if v_scope = 'club' and (p_club is null or not authz.is_active_member(p_club, v_viewer)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with pool as (
    select s.user_id, s.score, s.badges, s.categories
      from internal.achievement_scores s
      join public.profiles p on p.id = s.user_id and p.status = 'active'
      left join public.user_settings us on us.user_id = s.user_id
      left join public.districts d on d.id = p.district_id
      left join public.regions rg on rg.id = d.region_id
     where s.score > 0 and not coalesce(us.full_private_mode, false)
       and not authz.is_blocked(s.user_id, v_viewer)
       and (v_scope = 'everyone'
         or (v_scope = 'country' and coalesce(p.country_code, rg.country_code) = v_country)
         or (v_scope = 'city' and coalesce(p.country_code, rg.country_code) = v_country and internal.city_key(p.city_label) = v_city)
         or (v_scope = 'friends' and (s.user_id = v_viewer or (authz.follows(v_viewer, s.user_id) and authz.follows(s.user_id, v_viewer))))
         or (v_scope = 'club' and authz.is_active_member(p_club, s.user_id)))
  ), ranked as (
    select pool.*, rank() over (order by pool.score desc) as r, count(*) over () as n from pool
  )
  select rk.r,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then rk.user_id end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.handle::text end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.display_name else 'Private runner' end,
         case when internal.can_see_achievements(rk.user_id, v_viewer) then pr.avatar_path end,
         rk.score, rk.badges, rk.categories,
         (select c.tier from internal.user_challenges uc join public.challenges c on c.id = uc.challenge_id
           where uc.user_id = rk.user_id and uc.completed_at is not null and c.active
           order by array_position(array['platinum', 'gold', 'silver', 'bronze'], c.tier) limit 1),
         rk.user_id = v_viewer,
         not internal.can_see_achievements(rk.user_id, v_viewer),
         rk.n
    from ranked rk join public.profiles pr on pr.id = rk.user_id
   where rk.r <= least(greatest(p_limit, 1), 200) or rk.user_id = v_viewer
   order by rk.r, rk.user_id = v_viewer desc, pr.handle;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Drawn avatars while photo uploads are paused
-- ---------------------------------------------------------------------------------------------
-- The app draws the avatar from its parts and saves it as <user>/avatar-cartoon-<time>.jpg. Only that
-- name, directly in the runner's own folder, is let through while 'avatar_uploads_enabled' is off.
drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (authz.feature_enabled('avatar_uploads_enabled') or name like (select auth.uid())::text || '/avatar-cartoon-%.jpg'));
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (authz.feature_enabled('avatar_uploads_enabled') or name like (select auth.uid())::text || '/avatar-cartoon-%.jpg'));

-- ---------------------------------------------------------------------------------------------
-- Appeals from suspended accounts, including the suspension itself
-- ---------------------------------------------------------------------------------------------
create or replace function public.submit_appeal(p_object_type text, p_object_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_decided timestamptz;
  v_object uuid := p_object_id;
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  -- Suspended runners can still ask for reviews; deleted accounts cannot.
  select status into v_status from public.profiles where id = v_user;
  if v_status is null or v_status not in ('active', 'suspended') then raise exception 'account not active' using errcode = '42501'; end if;
  if p_object_type = 'account_action' then
    -- The runner's own suspension, while it lasts, once. The stored id names this suspension, so the
    -- unique key refuses a second request for it and a later suspension can be appealed again.
    if p_object_id is distinct from v_user or v_status <> 'suspended' then raise exception 'nothing to appeal' using errcode = '42501'; end if;
    select coalesce(status_changed_at, updated_at) into v_decided from public.profiles where id = v_user;
    v_object := md5('suspension:' || v_user::text || ':' || extract(epoch from v_decided)::text)::uuid;
  else
    v_decided := case p_object_type
      when 'loop_claim' then (select coalesce(invalidated_at, validated_at) from public.loop_claims where id = p_object_id and user_id = v_user)
      when 'speed_attempt' then (select coalesce(validated_at, updated_at) from public.speed_attempts where id = p_object_id and user_id = v_user)
      when 'post' then (select updated_at from public.posts where id = p_object_id and author_id = v_user and status = 'removed')
      when 'comment' then (select coalesce(edited_at, created_at) from public.comments where id = p_object_id and author_id = v_user and status = 'removed')
      when 'route_proposal' then (select decided_at from public.route_proposals where id = p_object_id and creator_id = v_user)
      when 'moderation_case' then (select resolved_at from public.moderation_cases where id = p_object_id and subject_user_id = v_user)
      when 'activity' then (select updated_at from public.activities where id = p_object_id and user_id = v_user and deleted_at is null and cardinality(integrity_flags) > 0)
      else null end;
    if v_decided is null then raise exception 'nothing to appeal' using errcode = '42501'; end if;
    if v_decided < now() - interval '7 days' then raise exception 'the seven-day appeal window has closed'; end if;
  end if;
  begin
    insert into public.appeals (user_id, object_type, object_id, reason) values (v_user, p_object_type, v_object, btrim(p_reason)) returning id into v_id;
  exception when unique_violation then
    raise exception 'already_appealed' using errcode = '23505';
  end;
  if p_object_type in ('loop_claim', 'speed_attempt', 'activity') then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by) values (p_object_type, p_object_id, v_user, 'appeal');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lost land: a paused reclaim is not a closed season
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_lost_cells(p_competition uuid, p_season uuid,
  p_min_lng double precision default null, p_min_lat double precision default null,
  p_max_lng double precision default null, p_max_lat double precision default null)
returns table (cell text, controller_key text, controller_name text, lost_on date, reclaimable boolean, blocked_reason text, cost integer)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
declare
  v_user uuid := auth.uid();
  v_season public.seasons;
  v_env geometry;
  v_season_open boolean;
  v_switched_on boolean;
  v_cost integer;
  v_participating boolean;
begin
  if v_user is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_season from public.seasons where id = p_season and competition_id = p_competition;
  if not found then return; end if;
  if p_min_lng is not null then
    if (p_max_lng - p_min_lng) * (p_max_lat - p_min_lat) > 0.06 then raise exception 'zoom_in' using errcode = 'P0413'; end if;
    v_env := st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
  end if;
  v_season_open := v_season.status = 'active' and now() >= v_season.starts_at and now() < v_season.ends_at;
  v_switched_on := internal.config_bool('reclaim_enabled') and internal.config_bool('territory_capture_enabled');
  v_participating := coalesce((select territory_competition_enabled from public.user_settings where user_id = v_user), false);
  v_cost := internal.reclaim_cost(v_season.grid_resolution);
  return query
  with lost as (
    select p.cell, p.controller_id, p.claim_id, p.published_at
      from internal.cell_control_public p
      join internal.territory_cells tc on tc.cell = p.cell
     where p.competition_id = p_competition and p.season_id = p_season and p.status = 'controlled'
       and p.controller_id is not null and p.controller_id <> v_user
       and (v_env is null or tc.geom && v_env)
  )
  select l.cell::text,
         case when authz.is_blocked(l.controller_id, v_user) then 'hidden' else md5(l.controller_id::text) end,
         case when authz.is_blocked(l.controller_id, v_user) then 'A runner' else pr.display_name end,
         (l.published_at at time zone 'UTC')::date,
         v_season_open and v_switched_on and v_participating and lc.source = 'loop',
         case when not v_season_open then 'season_closed'
              when not v_switched_on then 'reclaim_paused'
              when not v_participating then 'not_participating'
              when lc.source = 'reclaim' then 'taken_with_points' end,
         v_cost
    from lost l
    join internal.held_basis(v_user, p_competition, p_season, (select array_agg(lost.cell) from lost)) hb on hb.cell = l.cell
    join public.loop_claims lc on lc.id = l.claim_id
    left join public.profiles pr on pr.id = l.controller_id
   order by l.published_at desc, l.cell
   limit 2000;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants: recreated RPCs start with the default grants, so close them and open them to signed-in
-- users; the new internal helpers are reached only through the RPCs and triggers above.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('profile_card', 'search_profiles', 'feed_discover', 'discover_clubs',
                                                  'achievement_leaderboard', 'submit_appeal', 'my_lost_cells')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke execute on function internal.stamp_status_change(), internal.clear_area_with_city(), internal.club_home_country(),
  internal.city_key(text) from public, anon, authenticated;
