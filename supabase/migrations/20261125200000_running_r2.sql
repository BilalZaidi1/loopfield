-- Running features, stage 2 (R2): run highlights (on the phone, one switch), runners out right now (counts by
-- the city and country on a runner's profile, never positions) and live runs with people you know (mutual
-- followers who opt in). Training load and race predictions are worked out on the phone and need nothing here.
-- Builds on stage 1's live links: a run shared with friends is a live link of kind 'friends', which the public
-- page refuses, and one push from the phone now serves every link of a run.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings and switches
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('run_summaries_enabled', 'true', true, 'Off hides run highlights after a run and on share cards.'),
  ('running_now_enabled', 'true', true, 'Off hides runners-out-right-now counts and stops counting.'),
  ('running_now_min_count', '5', true, 'The smallest runners-out-right-now count ever shown.'),
  ('running_now_stale_minutes', '15', false, 'Minutes a run can go without checking in before it stops counting.'),
  ('friends_live_enabled', 'true', true, 'Off stops live runs with friends; shares in progress end within a minute.'),
  ('friends_live_max_people', '50', true, 'Most friends a runner can choose to share live runs with.'),
  ('friends_live_trail_minutes', '10', false, 'Minutes of recent path friends see.')
on conflict (key) do nothing;

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('run_summaries_enabled', 'Run highlights', 'switch', 'boolean', null, null, null, 'territory_operator', 25, 'Off hides the highlight lines after a run and the share-card option.'),
  ('running_now_enabled', 'Runners out right now', 'switch', 'boolean', null, null, null, 'territory_operator', 26, 'Off hides the counts and stops counting runners.'),
  ('friends_live_enabled', 'Live runs with friends', 'switch', 'boolean', null, null, null, 'territory_operator', 27, 'Off stops friends seeing each other live; shares in progress end within a minute.'),
  ('running_now_min_count', 'Runners out right now: smallest count shown', 'sharing', 'integer', 5, 100, null, 'config', 79, 'Counts below this are never shown. It can only go up from 5.'),
  ('running_now_stale_minutes', 'Runners out right now: drop-out time (min)', 'tunable', 'integer', 5, 60, null, 'config', 43, 'A run that stops checking in for this long stops counting.'),
  ('friends_live_max_people', 'Friends a runner can choose', 'limits', 'integer', 1, 200, null, 'config', 97, null),
  ('friends_live_trail_minutes', 'Friends see this much recent path (min)', 'sharing', 'integer', 0, 30, null, 'config', 80, 'Minutes of recent path shown with a friend on the map.')
on conflict (key) do update set label = excluded.label, category = excluded.category, value_type = excluded.value_type, min_value = excluded.min_value,
  max_value = excluded.max_value, allowed = excluded.allowed, min_role = excluded.min_role, sort = excluded.sort, help = excluded.help;

insert into internal.rate_limit_catalog (action, label, default_limit, window_seconds, sort) values
  ('running_now', 'Runners-out-right-now check-ins', 40, 3600, 126),
  ('friends_live', 'Runs shared with friends', 30, 86400, 127)
on conflict (action) do nothing;
update internal.config_registry
   set allowed = (select array_agg(action order by sort) from internal.rate_limit_catalog)
 where key = 'rate_limits';

-- ---------------------------------------------------------------------------------------------
-- 2. The runner's choices: counted in runners out right now (on), live runs with friends (off)
-- ---------------------------------------------------------------------------------------------
alter table public.user_settings
  add column running_now_counted boolean not null default true,
  add column friends_live_mode text not null default 'off' check (friends_live_mode in ('off', 'chosen', 'all'));
grant update (running_now_counted, friends_live_mode) on public.user_settings to authenticated;

/** Friends: each follows the other (both accepted), neither has blocked the other, and both accounts are active. */
create or replace function internal.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select a is not null and b is not null and a <> b
     and authz.follows(a, b) and authz.follows(b, a)
     and not authz.is_blocked(a, b)
     and authz.is_active_profile(a) and authz.is_active_profile(b);
$$;

-- The friends a runner chose (when sharing with "Friends I choose"). Only the runner sees their own list.
create table public.live_share_people (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index live_share_people_friend_idx on public.live_share_people (friend_id);
alter table public.live_share_people enable row level security;
revoke all on public.live_share_people from anon, authenticated;
grant select on public.live_share_people to authenticated;
create policy live_share_people_own on public.live_share_people for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- 3. Live links gain kind 'friends'; one push serves every link of a run
-- ---------------------------------------------------------------------------------------------
alter table public.live_links drop constraint live_links_kind_check;
alter table public.live_links add constraint live_links_kind_check check (kind in ('run', 'standing', 'friends'));

-- A friends link follows its own switch; the others follow the live-link switch.
create or replace function internal.live_link_open(l public.live_links) returns boolean
language sql stable set search_path = pg_catalog, internal as $$
  select l.revoked_at is null and l.ended_at is null and (l.expires_at is null or l.expires_at > now())
     and case when l.kind = 'friends' then internal.config_bool('friends_live_enabled', true)
              else internal.config_bool('live_links_enabled', true) end;
$$;

/**
 * One link's share of a push (stage 1's rules, unchanged): up to ten fixes since the last push, at most one
 * push per update interval. A link for one run, or a friends link, carries one run; a new run session on a
 * standing link starts a new shared run. Inaccurate, old, future or out-of-order fixes are dropped.
 */
create or replace function internal.live_push_one(p_user uuid, p_token text, p_session uuid, p_state text, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_every integer := internal.config_int('live_link_push_seconds', 30);
  l public.live_links;
  r internal.live_link_runs;
  pt jsonb;
  v_t timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_added integer := 0;
begin
  select * into l from public.live_links where token = p_token and user_id = p_user for update;
  if not found or not internal.live_link_open(l) then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  select * into r from internal.live_link_runs where token = p_token and session_id = p_session for update;
  if not found then
    if l.kind in ('run', 'friends') and exists (select 1 from internal.live_link_runs where token = p_token) then
      return jsonb_build_object('ok', false, 'reason', 'ended');
    end if;
    update internal.live_link_runs set state = 'finished', ended_at = now() where token = p_token and ended_at is null;
    insert into internal.live_link_runs (token, session_id) values (p_token, p_session) returning * into r;
  elsif r.ended_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ended');
  elsif p_state <> 'finished' and r.last_push_at is not null and r.last_push_at > now() - make_interval(secs => greatest(5, v_every / 2.0)) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'every_seconds', v_every);
  end if;
  if r.started_at < now() - make_interval(hours => internal.config_int('live_link_max_hours', 6)) then
    update internal.live_link_runs set state = 'stopped', ended_at = now() where token = p_token and session_id = p_session;
    return jsonb_build_object('ok', false, 'reason', 'ended');
  end if;
  for pt in select value from jsonb_array_elements(coalesce(p_points, '[]'::jsonb)) with ordinality as e(value, n) order by (value ->> 't')::double precision limit 10 loop
    begin
      v_t := to_timestamp((pt ->> 't')::double precision / 1000.0);
      v_lat := (pt ->> 'lat')::double precision;
      v_lng := (pt ->> 'lng')::double precision;
      v_acc := nullif(pt ->> 'acc', '')::double precision;
    exception when others then
      continue;
    end;
    continue when v_t is null or v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180;
    continue when v_acc is not null and v_acc > 50;
    continue when v_t < now() - interval '10 minutes' or v_t > now() + interval '1 minute';
    continue when r.last_point_at is not null and v_t <= r.last_point_at;
    insert into internal.live_positions (token, session_id, t, lat, lng, acc) values (p_token, p_session, v_t, v_lat, v_lng, v_acc)
    on conflict do nothing;
    if r.last_lat is not null then
      r.distance_m := r.distance_m + internal.geo_distance_m(r.last_lat, r.last_lng, v_lat, v_lng);
    end if;
    r.last_lat := v_lat;
    r.last_lng := v_lng;
    r.last_point_at := v_t;
    v_added := v_added + 1;
  end loop;
  update internal.live_link_runs
     set state = p_state, last_push_at = now(), last_point_at = r.last_point_at, distance_m = r.distance_m,
         last_lat = r.last_lat, last_lng = r.last_lng,
         ended_at = case when p_state = 'finished' then now() end
   where token = p_token and session_id = p_session;
  return jsonb_build_object('ok', true, 'added', v_added, 'every_seconds', v_every);
end $$;

-- Stage 1's single-link push, now through the shared routine (same arguments, same answers).
create or replace function public.live_link_push(p_token text, p_session uuid, p_state text, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_state not in ('running', 'paused', 'finished') or p_session is null then raise exception 'bad push' using errcode = '22023'; end if;
  return internal.live_push_one(auth.uid(), p_token, p_session, p_state, p_points);
end $$;

/**
 * One push from the phone for every link of a run (a live link, a friends share, or both): the same fixes go
 * to each, and each answers for itself. `ok` is true when any link took them.
 */
create or replace function public.live_push(p_session uuid, p_tokens text[], p_state text, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_token text;
  v_r jsonb;
  v_results jsonb := '{}'::jsonb;
  v_ok boolean := false;
  v_every integer := internal.config_int('live_link_push_seconds', 30);
begin
  if p_state not in ('running', 'paused', 'finished') or p_session is null then raise exception 'bad push' using errcode = '22023'; end if;
  if coalesce(cardinality(p_tokens), 0) = 0 or cardinality(p_tokens) > 3 then raise exception 'bad push' using errcode = '22023'; end if;
  foreach v_token in array p_tokens loop
    v_r := internal.live_push_one(v_user, v_token, p_session, p_state, p_points);
    v_ok := v_ok or coalesce((v_r ->> 'ok')::boolean, false);
    v_results := v_results || jsonb_build_object(v_token, coalesce(v_r ->> 'reason', 'ok'));
  end loop;
  return jsonb_build_object('ok', v_ok, 'every_seconds', v_every, 'links', v_results);
end $$;

-- The public page never shows a friends share (stage 1's page otherwise unchanged).
create or replace function public.public_live_link(p_token text, p_first boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  l public.live_links;
  r internal.live_link_runs;
  v_name text;
  v_grace interval := make_interval(mins => internal.config_int('live_link_grace_minutes', 15));
  v_max interval := make_interval(hours => internal.config_int('live_link_max_hours', 6));
  v_status text;
  v_trail jsonb;
  v_last jsonb;
  v_hidden boolean;
  v_count integer;
  v_step integer;
begin
  if p_token is null or length(p_token) not between 22 and 64 then return null; end if;
  select * into l from public.live_links where token = p_token and revoked_at is null and kind <> 'friends';
  if not found then return null; end if;
  select coalesce(p.display_name, p.handle) into v_name from public.profiles p where p.id = l.user_id and p.status = 'active';
  if v_name is null then return null; end if;
  if auth.uid() is not null and authz.is_blocked(l.user_id, auth.uid()) then return null; end if;
  if p_first then update public.live_links set views = views + 1 where token = p_token; end if;
  if not internal.live_link_open(l) then
    return jsonb_build_object('status', 'ended', 'kind', l.kind, 'name', v_name);
  end if;
  select * into r from internal.live_link_runs where token = p_token order by started_at desc limit 1;
  if not found then
    return jsonb_build_object('status', case when l.kind = 'run' then 'waiting' else 'not_running' end, 'kind', l.kind, 'name', v_name,
                              'refresh_seconds', internal.config_int('live_link_push_seconds', 30));
  end if;
  v_status := case
    when r.ended_at is null and r.started_at > now() - v_max then r.state
    when r.ended_at is not null and r.ended_at > now() - v_grace then 'finished'
    else null end;
  if v_status is null then
    return jsonb_build_object('status', case when l.kind = 'run' then 'ended' else 'not_running' end, 'kind', l.kind, 'name', v_name,
                              'refresh_seconds', internal.config_int('live_link_push_seconds', 30));
  end if;
  select count(*) into v_count from internal.live_positions where token = p_token and session_id = r.session_id;
  v_step := greatest(1, ceil(v_count / 500.0)::integer);
  with pts as (
    select t, lat, lng, row_number() over (order by t) as n,
           (not l.show_everywhere and internal.in_protected_area(l.user_id, lat, lng)) as hidden
      from internal.live_positions where token = p_token and session_id = r.session_id
  ), grouped as (
    select t, lat, lng, n, hidden,
           sum(case when hidden then 1 else 0 end) over (order by t rows unbounded preceding) as grp,
           max(n) over () as last_n
      from pts
  ), segs as (
    select grp, jsonb_agg(jsonb_build_array(round(lng::numeric, 6), round(lat::numeric, 6)) order by t) as seg
      from grouped where not hidden and ((n - 1) % v_step = 0 or n = last_n)
     group by grp
  )
  select coalesce(jsonb_agg(seg order by grp), '[]'::jsonb) into v_trail from segs;
  select (not l.show_everywhere and internal.in_protected_area(l.user_id, p.lat, p.lng)),
         jsonb_build_object('lat', round(p.lat::numeric, 6), 'lng', round(p.lng::numeric, 6))
    into v_hidden, v_last
    from internal.live_positions p where p.token = p_token and p.session_id = r.session_id order by p.t desc limit 1;
  return jsonb_build_object(
    'status', v_status,
    'kind', l.kind,
    'name', v_name,
    'started_at', r.started_at,
    'last_update', r.last_point_at,
    'distance_m', round(r.distance_m),
    'hidden', coalesce(v_hidden, false),
    'last', case when coalesce(v_hidden, false) then null else v_last end,
    'trail', v_trail,
    'refresh_seconds', internal.config_int('live_link_push_seconds', 30));
end $$;

-- The runner's open links in Privacy settings: live links only (friends shares are managed in their own setting).
create or replace function public.my_live_links() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'token', l.token, 'kind', l.kind, 'show_everywhere', l.show_everywhere, 'views', l.views,
           'created_at', l.created_at, 'expires_at', l.expires_at,
           'run', (select jsonb_build_object('session_id', r.session_id, 'state', r.state, 'started_at', r.started_at, 'ended_at', r.ended_at)
                     from internal.live_link_runs r where r.token = l.token order by r.started_at desc limit 1))
         order by l.created_at desc), '[]'::jsonb)
    from public.live_links l
   where l.user_id = auth.uid() and l.kind <> 'friends' and internal.live_link_open(l);
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Live runs with friends
-- ---------------------------------------------------------------------------------------------
/** Sharing this run with friends: a friends link bound to the run, or nothing when sharing is off. */
create or replace function public.friends_live_start(p_session uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_mode text;
  v_token text;
begin
  if p_session is null then raise exception 'bad session' using errcode = '22023'; end if;
  if not internal.config_bool('friends_live_enabled', true) then
    raise exception 'feature_paused' using errcode = '55000', detail = 'friends_live_enabled', hint = 'This is switched off for now. Please try again later.';
  end if;
  select friends_live_mode into v_mode from public.user_settings where user_id = v_user;
  if coalesce(v_mode, 'off') = 'off' then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if v_mode = 'chosen' and not exists (select 1 from public.live_share_people where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'nobody');
  end if;
  select l.token into v_token
    from public.live_links l join internal.live_link_runs r on r.token = l.token
   where l.user_id = v_user and l.kind = 'friends' and r.session_id = p_session and l.revoked_at is null and l.ended_at is null;
  if v_token is null then
    perform internal.enforce_rate_limit(v_user::text, 'friends_live', 30, 86400);
    insert into public.live_links (token, user_id, kind, show_everywhere, expires_at)
    values (internal.new_link_token(), v_user, 'friends', false, now() + make_interval(hours => internal.config_int('live_link_max_hours', 6)))
    returning token into v_token;
    insert into internal.live_link_runs (token, session_id) values (v_token, p_session);
  end if;
  return jsonb_build_object('ok', true, 'token', v_token, 'mode', v_mode, 'every_seconds', internal.config_int('live_link_push_seconds', 30));
end $$;

/** The friends chosen for "Friends I choose", replaced as a whole. Only current friends are kept. */
create or replace function public.set_live_share_people(p_people uuid[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_max integer := internal.config_int('friends_live_max_people', 50);
  v_wanted uuid[] := array(select distinct x from unnest(coalesce(p_people, '{}')) x where x is not null and x <> v_user);
  v_saved integer;
begin
  if cardinality(v_wanted) > v_max then
    raise exception 'too many friends' using errcode = '22023', detail = 'friends_live_max_people', hint = format('You can choose up to %s friends.', v_max);
  end if;
  delete from public.live_share_people where user_id = v_user and friend_id <> all (v_wanted);
  insert into public.live_share_people (user_id, friend_id)
  select v_user, x from unnest(v_wanted) x where internal.are_friends(v_user, x)
  on conflict do nothing;
  delete from public.live_share_people sp where sp.user_id = v_user and not internal.are_friends(v_user, sp.friend_id);
  select count(*) into v_saved from public.live_share_people where user_id = v_user;
  return jsonb_build_object('saved', v_saved, 'skipped', cardinality(v_wanted) - v_saved);
end $$;

/** The runner's friends, for choosing who sees their live runs (name, handle and picture; chosen or not). */
create or replace function public.live_share_candidates() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal, authz as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'display_name', p.display_name, 'handle', p.handle, 'avatar_path', p.avatar_path,
           'chosen', exists (select 1 from public.live_share_people sp where sp.user_id = auth.uid() and sp.friend_id = p.id))
         order by lower(coalesce(p.display_name, p.handle))), '[]'::jsonb)
    from public.follows f
    join public.profiles p on p.id = f.followee_id
   where f.follower_id = auth.uid() and f.state = 'accepted'
     and internal.are_friends(auth.uid(), f.followee_id);
$$;

/** Bearing in degrees (0 = north, clockwise) from one point to another. */
create or replace function internal.bearing_deg(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = pg_catalog as $$
  select (((degrees(atan2(sin(radians(b_lng - a_lng)) * cos(radians(b_lat)),
                          cos(radians(a_lat)) * sin(radians(b_lat)) - sin(radians(a_lat)) * cos(radians(b_lat)) * cos(radians(b_lng - a_lng)))) + 360)::numeric % 360))::double precision;
$$;

/**
 * Friends running now who share with the caller: name, picture, where they are unless that is inside one of
 * their protected areas (always held back for friends; there is no override), direction, start time, last
 * update and a simplified path of the last few minutes. Friendship, blocks and account status are checked on
 * every call, so unfollowing or blocking stops sharing at once.
 */
create or replace function public.friends_live_now() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
  v_trail interval := make_interval(mins => least(greatest(internal.config_int('friends_live_trail_minutes', 10), 0), 30));
  v_max interval := make_interval(hours => internal.config_int('live_link_max_hours', 6));
  v_out jsonb := '[]'::jsonb;
  c record;
  v_segs jsonb;
  v_last record;
  v_prev record;
  v_count integer;
  v_step integer;
begin
  if not internal.config_bool('friends_live_enabled', true) then return v_out; end if;
  for c in
    select l.token, l.user_id, r.session_id, r.started_at, r.last_point_at, r.state, p.display_name, p.handle, p.avatar_path
      from public.live_links l
      join internal.live_link_runs r on r.token = l.token
      join public.user_settings s on s.user_id = l.user_id
      join public.profiles p on p.id = l.user_id
     where l.kind = 'friends' and l.revoked_at is null and l.ended_at is null and (l.expires_at is null or l.expires_at > now())
       and r.ended_at is null and r.state in ('running', 'paused') and r.started_at > now() - v_max
       and l.user_id <> v_user
       and (s.friends_live_mode = 'all'
            or (s.friends_live_mode = 'chosen' and exists (select 1 from public.live_share_people sp where sp.user_id = l.user_id and sp.friend_id = v_user)))
       and internal.are_friends(v_user, l.user_id)
     order by r.started_at
     limit 50
  loop
    -- The visible part of the recent path, thinned to about 60 points, split where a stretch was held back.
    select count(*) into v_count from internal.live_positions
     where token = c.token and session_id = c.session_id and t > now() - v_trail;
    v_step := greatest(1, ceil(v_count / 60.0)::integer);
    with pts as (
      select t, lat, lng, row_number() over (order by t) as n, internal.in_protected_area(c.user_id, lat, lng) as hidden
        from internal.live_positions where token = c.token and session_id = c.session_id and t > now() - v_trail
    ), grouped as (
      select t, lat, lng, n, hidden, max(n) over () as last_n,
             sum(case when hidden then 1 else 0 end) over (order by t rows unbounded preceding) as grp
        from pts
    ), segs as (
      select grp, jsonb_agg(jsonb_build_array(round(lng::numeric, 6), round(lat::numeric, 6)) order by t) as seg
        from grouped where not hidden and ((n - 1) % v_step = 0 or n = last_n)
       group by grp
    )
    select coalesce(jsonb_agg(seg order by grp), '[]'::jsonb) into v_segs from segs;
    select p.lat, p.lng, internal.in_protected_area(c.user_id, p.lat, p.lng) as hidden into v_last
      from internal.live_positions p where p.token = c.token and p.session_id = c.session_id order by p.t desc limit 1;
    select p.lat, p.lng into v_prev
      from internal.live_positions p
     where p.token = c.token and p.session_id = c.session_id and v_last.lat is not null
       and internal.geo_distance_m(p.lat, p.lng, v_last.lat, v_last.lng) >= 10
     order by p.t desc limit 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', c.user_id,
      'display_name', c.display_name,
      'handle', c.handle,
      'avatar_path', c.avatar_path,
      'state', c.state,
      'started_at', c.started_at,
      'last_update', c.last_point_at,
      'hidden', coalesce(v_last.hidden, false),
      'position', case when v_last.lat is null or v_last.hidden then null
                       else jsonb_build_object('lat', round(v_last.lat::numeric, 6), 'lng', round(v_last.lng::numeric, 6)) end,
      'bearing', case when v_last.lat is null or v_last.hidden or v_prev.lat is null then null
                      else round(internal.bearing_deg(v_prev.lat, v_prev.lng, v_last.lat, v_last.lng)) end,
      'trail', v_segs));
  end loop;
  return v_out;
end $$;

/** Turning sharing off, or emptying "Friends I choose", ends friends shares in progress at once. */
create or replace function internal.user_settings_running_changed() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.friends_live_mode = 'off' and old.friends_live_mode <> 'off' then
    update internal.live_link_runs r set state = 'stopped', ended_at = now()
      from public.live_links l
     where r.token = l.token and l.user_id = new.user_id and l.kind = 'friends' and r.ended_at is null;
    update public.live_links set ended_at = now() where user_id = new.user_id and kind = 'friends' and ended_at is null;
  end if;
  if not new.running_now_counted and old.running_now_counted then
    delete from internal.running_now where user_id = new.user_id;
  end if;
  return new;
end $$;
create trigger user_settings_running_changed after update of friends_live_mode, running_now_counted on public.user_settings
  for each row execute function internal.user_settings_running_changed();

-- ---------------------------------------------------------------------------------------------
-- 5. Runners out right now: check-ins without positions, counted by profile city and country
-- ---------------------------------------------------------------------------------------------
create table internal.running_now (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  session_id uuid not null,
  city_key text,
  country_code text,
  started_at timestamptz not null default now(),
  last_ping_at timestamptz not null default now()
);
create index running_now_ping_idx on internal.running_now (last_ping_at);

-- Worked out once a minute by maintenance, so reading the counts is cheap.
create table internal.running_now_summary (
  scope text not null check (scope in ('all', 'country', 'city')),
  key text not null,
  runners integer not null,
  computed_at timestamptz not null default now(),
  primary key (scope, key)
);

-- The most runners out at once each day, for the back office's daily metric.
create table internal.running_now_peaks (
  day date primary key,
  peak integer not null
);

/** A city's key: country, then the city name without case or extra spaces (as Discover matches cities). */
create or replace function internal.city_key(p_country text, p_city text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when p_country is null or nullif(btrim(coalesce(p_city, '')), '') is null then null
              else upper(p_country) || ':' || lower(regexp_replace(btrim(p_city), '\s+', ' ', 'g')) end;
$$;

/** "I'm still running": no position, only the run. Skipped when the runner opted out or the feature is off. */
create or replace function public.running_now_ping(p_session uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_city text;
  v_country text;
begin
  if p_session is null then raise exception 'bad session' using errcode = '22023'; end if;
  if not internal.config_bool('running_now_enabled', true) then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;
  if exists (select 1 from public.user_settings where user_id = v_user and not running_now_counted) then
    delete from internal.running_now where user_id = v_user;
    return jsonb_build_object('ok', false, 'reason', 'opted_out');
  end if;
  select city_label, country_code into v_city, v_country from public.profiles where id = v_user and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  perform internal.enforce_rate_limit(v_user::text, 'running_now', 40, 3600);
  insert into internal.running_now (user_id, session_id, city_key, country_code)
  values (v_user, p_session, internal.city_key(v_country, v_city), upper(v_country))
  on conflict (user_id) do update
     set session_id = excluded.session_id, city_key = excluded.city_key, country_code = excluded.country_code, last_ping_at = now(),
         started_at = case when internal.running_now.session_id = excluded.session_id then internal.running_now.started_at else now() end;
  return jsonb_build_object('ok', true, 'every_seconds', 300);
end $$;

/** The run finished or was discarded: the runner stops counting at once. */
create or replace function public.running_now_end(p_session uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  delete from internal.running_now where user_id = v_user and session_id = p_session;
end $$;

/** The caller's city, country and everywhere counts; each blank below the smallest count ever shown. */
create or replace function public.running_now_counts() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_min integer := greatest(internal.config_int('running_now_min_count', 5), 5);
  v_city text;
  v_country text;
  v_city_n integer;
  v_country_n integer;
  v_all_n integer;
  v_at timestamptz;
begin
  if not internal.config_bool('running_now_enabled', true) then return jsonb_build_object('enabled', false); end if;
  select city_label, upper(country_code) into v_city, v_country from public.profiles where id = v_user;
  select runners, computed_at into v_all_n, v_at from internal.running_now_summary where scope = 'all' and key = '';
  select runners into v_country_n from internal.running_now_summary where scope = 'country' and key = v_country;
  select runners into v_city_n from internal.running_now_summary where scope = 'city' and key = internal.city_key(v_country, v_city);
  return jsonb_build_object(
    'enabled', true,
    'min_count', v_min,
    'city', case when internal.city_key(v_country, v_city) is null then null
                 else jsonb_build_object('name', btrim(v_city), 'count', case when v_city_n >= v_min then v_city_n end) end,
    'country', case when v_country is null then null
                    else jsonb_build_object('code', v_country, 'count', case when v_country_n >= v_min then v_country_n end) end,
    'everywhere', case when v_all_n >= v_min then v_all_n end,
    'computed_at', v_at);
end $$;

/** Every minute: drop stale and opted-out runners, then count by city, country and everywhere. */
create or replace function internal.running_now_tick() returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_total integer;
begin
  if not internal.config_bool('running_now_enabled', true) then
    delete from internal.running_now where true;
    delete from internal.running_now_summary where true;
    return 0;
  end if;
  delete from internal.running_now
   where last_ping_at < now() - make_interval(mins => internal.config_int('running_now_stale_minutes', 15))
      or started_at < now() - interval '12 hours'
      or user_id in (select user_id from public.user_settings where not running_now_counted)
      or user_id in (select id from public.profiles where status <> 'active');
  delete from internal.running_now_summary where true;
  insert into internal.running_now_summary (scope, key, runners)
  select 'all', '', count(*) from internal.running_now
  union all
  select 'country', country_code, count(*) from internal.running_now where country_code is not null group by country_code
  union all
  select 'city', city_key, count(*) from internal.running_now where city_key is not null group by city_key;
  select runners into v_total from internal.running_now_summary where scope = 'all' and key = '';
  insert into internal.running_now_peaks (day, peak) values ((now() at time zone 'utc')::date, coalesce(v_total, 0))
  on conflict (day) do update set peak = greatest(internal.running_now_peaks.peak, excluded.peak);
  return coalesce(v_total, 0);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Live-link upkeep knows friends shares; maintenance gains the runners-out-right-now count
-- ---------------------------------------------------------------------------------------------
create or replace function internal.live_links_tick() returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_grace interval := make_interval(mins => internal.config_int('live_link_grace_minutes', 15));
  v_max interval := make_interval(hours => internal.config_int('live_link_max_hours', 6));
  v_keep interval := make_interval(hours => least(internal.config_int('live_link_keep_hours', 24), 24));
  v_n integer := 0;
  v_c integer;
begin
  if not internal.config_bool('live_links_enabled', true) then
    update internal.live_link_runs r set state = 'stopped', ended_at = now()
      from public.live_links l where r.token = l.token and l.kind <> 'friends' and r.ended_at is null;
    update public.live_links set ended_at = now() where kind = 'run' and ended_at is null and revoked_at is null;
  end if;
  if not internal.config_bool('friends_live_enabled', true) then
    update internal.live_link_runs r set state = 'stopped', ended_at = now()
      from public.live_links l where r.token = l.token and l.kind = 'friends' and r.ended_at is null;
    update public.live_links set ended_at = now() where kind = 'friends' and ended_at is null and revoked_at is null;
  end if;
  update internal.live_link_runs set state = 'stopped', ended_at = now() where ended_at is null and started_at < now() - v_max;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.live_links l set ended_at = now()
   where l.kind in ('run', 'friends') and l.ended_at is null and l.revoked_at is null
     and (l.expires_at < now() or exists (select 1 from internal.live_link_runs r where r.token = l.token and r.ended_at < now() - v_grace));
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from internal.live_link_runs where ended_at < now() - v_keep;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from public.live_links where kind in ('run', 'friends') and coalesce(ended_at, revoked_at) < now() - interval '30 days';
  return v_n;
end $$;

-- The every-minute maintenance (unchanged from stage 1, plus runners out right now).
create or replace function internal.run_maintenance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_t integer;
  v_s integer;
  v_a integer;
  v_m integer;
  v_l integer;
  v_live integer;
  v_now integer;
begin
  perform internal.maintain_seasons();
  v_t := internal.publish_due_territory(500);
  v_s := internal.publish_due_titles(500);
  v_a := internal.evaluate_dirty_achievements(300);
  v_m := internal.enqueue_missing_movement(100);
  v_l := internal.enqueue_waiting_layers(50);
  v_live := internal.live_links_tick();
  v_now := internal.running_now_tick();
  -- Digest dispatch is per user local time; the worker groups pending items (see notifications job).
  if exists (select 1 from internal.digest_items where digested_at is null) then
    perform internal.enqueue_job('notifications', 'dispatch_digests', '{}', 'digests', now());
  end if;
  return jsonb_build_object('territory_events', v_t, 'titles', v_s, 'achievements', v_a, 'movement_jobs', v_m, 'layer_jobs', v_l,
                            'live_links', v_live, 'running_now', v_now);
end $$;

-- Daily: also drop peaks older than about 13 months (the metrics keep their own history).
create or replace function internal.running_tools_daily() returns integer
language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v integer;
  w integer;
begin
  delete from internal.route_snap_usage where day < (now() at time zone 'utc')::date - 90;
  get diagnostics v = row_count;
  delete from internal.running_now_peaks where day < (now() at time zone 'utc')::date - 400;
  get diagnostics w = row_count;
  return v + w;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function internal.are_friends(uuid, uuid), internal.live_push_one(uuid, text, uuid, text, jsonb),
  internal.bearing_deg(double precision, double precision, double precision, double precision), internal.user_settings_running_changed(),
  internal.city_key(text, text), internal.running_now_tick() from public, anon, authenticated;
grant execute on function internal.are_friends(uuid, uuid), internal.live_push_one(uuid, text, uuid, text, jsonb),
  internal.bearing_deg(double precision, double precision, double precision, double precision), internal.user_settings_running_changed(),
  internal.city_key(text, text), internal.running_now_tick() to service_role;
do $$
declare
  f text;
  rpc text[] := array['live_push', 'friends_live_start', 'set_live_share_people', 'live_share_candidates', 'friends_live_now',
                      'running_now_ping', 'running_now_end', 'running_now_counts'];
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (rpc)
  loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
grant execute on all functions in schema public to service_role;
