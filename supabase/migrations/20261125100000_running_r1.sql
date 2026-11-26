-- Running features, stage 1 (R1): the route builder (planned routes and path following), live links for
-- family and friends, and the runner's picture as their position dot. Settings and switches first, then the
-- tables and functions. Nothing here feeds land, rankings or integrity: following a route is guidance only,
-- and live positions are seen only by the people the runner sends a link to.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings and switches (read by the app and enforced here)
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('route_builder_enabled', 'true', true, 'Off pauses planning and saving routes. Saved routes stay and can still be followed.'),
  ('route_snapping_enabled', 'true', true, 'Off stops path following in the route builder; legs are drawn straight.'),
  ('planned_routes_max', '100', true, 'Most planned routes per runner.'),
  ('route_snap_daily_cap', '200', false, 'Most path-following legs per runner per day.'),
  ('route_snap_monthly_alert', '0', false, 'Path-following requests in a month that raise a back-office alert (0 = no alert).'),
  ('off_route_distance_m', '40', true, 'Distance from a followed route that counts as off route.'),
  ('off_route_seconds', '15', true, 'Seconds off a followed route before the alert.'),
  ('live_links_enabled', 'true', true, 'Off pauses live links; open links end within a minute.'),
  ('live_link_push_seconds', '30', true, 'How often a phone sends its position to a live link.'),
  ('live_link_grace_minutes', '15', true, 'How long a live link keeps showing the last position after the run ends.'),
  ('live_link_max_hours', '6', true, 'The longest a single run is shared live.'),
  ('live_link_keep_hours', '24', false, 'Hours live positions are kept after sharing ends.'),
  ('avatar_marker_enabled', 'true', true, 'Off shows the plain position dot instead of the runner''s picture on the run map.')
on conflict (key) do nothing;

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('route_builder_enabled', 'Route builder', 'switch', 'boolean', null, null, null, 'territory_operator', 21, 'Off stops planning and saving routes. Saved routes stay, and runners can still follow them.'),
  ('route_snapping_enabled', 'Path following in the route builder', 'switch', 'boolean', null, null, null, 'territory_operator', 22, 'Off draws straight lines between points instead of asking Mapbox. Stops path-following costs at once.'),
  ('live_links_enabled', 'Live links', 'switch', 'boolean', null, null, null, 'territory_operator', 23, 'Off stops new live links; links already open end within a minute.'),
  ('avatar_marker_enabled', 'Picture as the position dot', 'switch', 'boolean', null, null, null, 'territory_operator', 24, 'Off shows the plain position dot on the run map for everyone.'),
  ('planned_routes_max', 'Planned routes per runner', 'limits', 'integer', 10, 500, null, 'config', 95, null),
  ('route_snap_daily_cap', 'Path-following legs per runner per day', 'limits', 'integer', 0, 2000, null, 'config', 96, 'Each tapped point is one request to Mapbox. 0 stops path following for everyone.'),
  ('route_snap_monthly_alert', 'Path-following alert (requests per month)', 'system', 'integer', 0, 10000000, null, 'config', 30, 'The Overview warns when the month''s path-following requests pass this. 0 means no alert.'),
  ('off_route_distance_m', 'Off-route distance (m)', 'tunable', 'integer', 20, 150, null, 'config', 40, 'How far from a followed route a runner can be before it counts as off route.'),
  ('off_route_seconds', 'Off-route wait (s)', 'tunable', 'integer', 5, 60, null, 'config', 41, 'How long a runner must stay off a followed route before the alert.'),
  ('live_link_push_seconds', 'Live link update interval (s)', 'tunable', 'integer', 15, 120, null, 'config', 42, 'How often a phone sends its position to an open live link.'),
  ('live_link_grace_minutes', 'Live link after the run (min)', 'sharing', 'integer', 0, 60, null, 'config', 76, 'How long a live link keeps showing the last position after the run ends.'),
  ('live_link_max_hours', 'Longest live sharing (hours)', 'sharing', 'integer', 1, 12, null, 'config', 77, 'No single run is shared live for longer than this.'),
  ('live_link_keep_hours', 'Live positions kept for (hours)', 'sharing', 'integer', 1, 24, null, 'config', 78, 'Positions are deleted this long after sharing ends. Can only go down from 24.')
on conflict (key) do update set label = excluded.label, category = excluded.category, value_type = excluded.value_type, min_value = excluded.min_value,
  max_value = excluded.max_value, allowed = excluded.allowed, min_role = excluded.min_role, sort = excluded.sort, help = excluded.help;

insert into internal.rate_limit_catalog (action, label, default_limit, window_seconds, sort)
values ('live_link', 'Live links', 20, 86400, 125)
on conflict (action) do nothing;
update internal.config_registry
   set allowed = (select array_agg(action order by sort) from internal.rate_limit_catalog)
 where key = 'rate_limits';

-- ---------------------------------------------------------------------------------------------
-- 2. Planned routes: owner-only, checked and measured by the database
-- ---------------------------------------------------------------------------------------------
create table public.planned_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Google encoded polyline, precision 5 (the app's format for personal routes).
  path text not null check (char_length(path) between 4 and 60000),
  distance_m integer not null default 0,
  point_count integer not null default 0,
  is_loop boolean not null default false,
  snapped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planned_routes_user_idx on public.planned_routes (user_id, updated_at desc);
alter table public.planned_routes enable row level security;
create policy planned_routes_select_own on public.planned_routes for select to authenticated using (user_id = auth.uid());
create policy planned_routes_insert_own on public.planned_routes for insert to authenticated
  with check (user_id = auth.uid() and authz.feature_enabled('route_builder_enabled'));
create policy planned_routes_update_own on public.planned_routes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and authz.feature_enabled('route_builder_enabled'));
create policy planned_routes_delete_own on public.planned_routes for delete to authenticated using (user_id = auth.uid());
revoke all on public.planned_routes from anon, authenticated;
grant select, delete on public.planned_routes to authenticated;
grant insert (name, path, snapped), update (name, path, snapped) on public.planned_routes to authenticated;

/** Measures the line (distance, points, loop or not) from the path itself and keeps the limits. */
create or replace function internal.planned_routes_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_line extensions.geometry;
  v_len double precision;
begin
  if tg_op = 'INSERT' and (select count(*) from public.planned_routes where user_id = new.user_id) >= internal.config_int('planned_routes_max', 100) then
    raise exception 'planned_routes_limit' using errcode = '54000', hint = 'Delete a planned route to save a new one.';
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'INSERT' or new.path is distinct from old.path then
    begin
      v_line := extensions.st_setsrid(extensions.st_linefromencodedpolyline(new.path, 5), 4326);
    exception when others then
      raise exception 'planned_route_invalid' using errcode = '22023', hint = 'The route line could not be read.';
    end;
    if v_line is null or extensions.st_npoints(v_line) < 2 or extensions.st_npoints(v_line) > 5000
       or not extensions.st_isvalid(v_line)
       or extensions.st_xmin(v_line) < -180 or extensions.st_xmax(v_line) > 180 or extensions.st_ymin(v_line) < -90 or extensions.st_ymax(v_line) > 90 then
      raise exception 'planned_route_invalid' using errcode = '22023', hint = 'The route line could not be read.';
    end if;
    v_len := extensions.st_length(v_line::extensions.geography);
    if v_len < 50 or v_len > 200000 then
      raise exception 'planned_route_length' using errcode = '22023', hint = 'A route is between 50 m and 200 km.';
    end if;
    new.distance_m := round(v_len);
    new.point_count := extensions.st_npoints(v_line);
    new.is_loop := v_len > 180
      and extensions.st_distance(extensions.st_startpoint(v_line)::extensions.geography, extensions.st_endpoint(v_line)::extensions.geography) <= 60;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger planned_routes_guard before insert or update on public.planned_routes
  for each row execute function internal.planned_routes_guard();

-- ---------------------------------------------------------------------------------------------
-- 3. Path following: a daily count per runner (never coordinates), checked by the route-snap function
-- ---------------------------------------------------------------------------------------------
create table internal.route_snap_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  primary key (user_id, day)
);

/** One path-following request: 'ok', 'paused' (switched off or the account isn't active) or 'capped'. */
create or replace function internal.take_route_snap(p_user uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_cap integer := internal.config_int('route_snap_daily_cap', 200);
  v_n integer;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user and status = 'active') then return 'paused'; end if;
  if v_cap <= 0 or not internal.config_bool('route_snapping_enabled', true) or not internal.config_bool('route_builder_enabled', true) then
    return 'paused';
  end if;
  insert into internal.route_snap_usage (user_id, day, requests) values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set requests = internal.route_snap_usage.requests + 1
   where internal.route_snap_usage.requests < v_cap
  returning requests into v_n;
  return case when v_n is null then 'capped' else 'ok' end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Live links: a link the runner sends, the runs shared through it, and their positions
-- ---------------------------------------------------------------------------------------------
create table public.live_links (
  token text primary key check (length(token) between 22 and 64),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('run', 'standing')),
  show_everywhere boolean not null default false,
  created_at timestamptz not null default now(),
  -- A run link lasts for one run at most; a standing link has no end of its own.
  expires_at timestamptz,
  ended_at timestamptz,
  revoked_at timestamptz,
  views integer not null default 0
);
create index live_links_user_idx on public.live_links (user_id, created_at desc);
create unique index live_links_one_standing on public.live_links (user_id) where kind = 'standing' and revoked_at is null;
alter table public.live_links enable row level security;
revoke all on public.live_links from anon, authenticated;
-- No direct table access: the functions below are the only way in.

create table internal.live_link_runs (
  token text not null references public.live_links (token) on delete cascade,
  session_id uuid not null,
  started_at timestamptz not null default now(),
  state text not null default 'running' check (state in ('running', 'paused', 'finished', 'stopped')),
  ended_at timestamptz,
  last_point_at timestamptz,
  last_push_at timestamptz,
  distance_m double precision not null default 0,
  last_lat double precision,
  last_lng double precision,
  primary key (token, session_id)
);
create index live_link_runs_ended_idx on internal.live_link_runs (ended_at) where ended_at is not null;
create index live_link_runs_open_idx on internal.live_link_runs (started_at) where ended_at is null;

create table internal.live_positions (
  token text not null,
  session_id uuid not null,
  t timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  acc real,
  primary key (token, session_id, t),
  foreign key (token, session_id) references internal.live_link_runs (token, session_id) on delete cascade
);

create or replace function internal.new_link_token() returns text
language sql volatile set search_path = pg_catalog as $$
  select rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
$$;

/** Distance in metres between two points (on the sphere PostGIS uses for geography). */
create or replace function internal.geo_distance_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = pg_catalog, extensions as $$
  select extensions.st_distance(extensions.st_setsrid(extensions.st_makepoint(a_lng, a_lat), 4326)::extensions.geography,
                                extensions.st_setsrid(extensions.st_makepoint(b_lng, b_lat), 4326)::extensions.geography, false);
$$;

/** Whether a point lies inside one of the runner's protected areas, with the usual sharing margin. */
create or replace function internal.in_protected_area(p_user uuid, p_lat double precision, p_lng double precision) returns boolean
language sql stable security definer set search_path = pg_catalog, public, internal, extensions as $$
  select exists (
    select 1 from public.protected_areas pa
     where pa.user_id = p_user
       and extensions.st_dwithin(pa.center, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
                                 pa.radius_m + greatest(internal.config_int('privacy_zone_margin_m', 50), 50)));
$$;

create or replace function internal.live_link_open(l public.live_links) returns boolean
language sql stable set search_path = pg_catalog, internal as $$
  select l.revoked_at is null and l.ended_at is null and (l.expires_at is null or l.expires_at > now())
     and internal.config_bool('live_links_enabled', true);
$$;

/** Starts a live link: a new one for this run, or the runner's standing link (created the first time). */
create or replace function public.live_link_create(p_kind text, p_show_everywhere boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  l public.live_links;
begin
  if p_kind not in ('run', 'standing') then raise exception 'unknown link kind' using errcode = '22023'; end if;
  if not internal.config_bool('live_links_enabled', true) then
    raise exception 'feature_paused' using errcode = '55000', detail = 'live_links_enabled', hint = 'This is switched off for now. Please try again later.';
  end if;
  if p_kind = 'standing' then
    select * into l from public.live_links where user_id = v_user and kind = 'standing' and revoked_at is null;
    if found then
      if l.show_everywhere is distinct from coalesce(p_show_everywhere, false) then
        update public.live_links set show_everywhere = coalesce(p_show_everywhere, false) where token = l.token returning * into l;
      end if;
      return jsonb_build_object('token', l.token, 'kind', l.kind, 'show_everywhere', l.show_everywhere, 'expires_at', l.expires_at, 'created', false);
    end if;
  end if;
  perform internal.enforce_rate_limit(v_user::text, 'live_link', 20, 86400);
  insert into public.live_links (token, user_id, kind, show_everywhere, expires_at)
  values (internal.new_link_token(), v_user, p_kind, coalesce(p_show_everywhere, false),
          case when p_kind = 'run' then now() + make_interval(hours => internal.config_int('live_link_max_hours', 6)) end)
  returning * into l;
  return jsonb_build_object('token', l.token, 'kind', l.kind, 'show_everywhere', l.show_everywhere, 'expires_at', l.expires_at, 'created', true);
end $$;

/**
 * The phone's position for an open link: up to ten fixes since the last push, at most one push per
 * update interval. A new run session on a standing link starts a new shared run; a run link carries one run.
 * Fixes that are inaccurate, old, in the future or out of order are dropped. `p_state` is the run's state.
 */
create or replace function public.live_link_push(p_token text, p_session uuid, p_state text, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := auth.uid();
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
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_state not in ('running', 'paused', 'finished') or p_session is null then raise exception 'bad push' using errcode = '22023'; end if;
  select * into l from public.live_links where token = p_token and user_id = v_user for update;
  if not found or not internal.live_link_open(l) then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  select * into r from internal.live_link_runs where token = p_token and session_id = p_session for update;
  if not found then
    if l.kind = 'run' and exists (select 1 from internal.live_link_runs where token = p_token) then
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

/** Stop sharing: a run link ends; on a standing link the current run stops showing (the link stays). */
create or replace function public.live_link_end(p_token text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  l public.live_links;
begin
  select * into l from public.live_links where token = p_token and user_id = v_user;
  if not found then return; end if;
  update internal.live_link_runs set state = 'stopped', ended_at = now() - make_interval(mins => internal.config_int('live_link_grace_minutes', 15) + 1)
   where token = p_token and ended_at is null;
  if l.kind = 'run' then
    update public.live_links set ended_at = now() where token = p_token and ended_at is null;
  end if;
end $$;

/** Turns a link off for good. Its positions are deleted at once. */
create or replace function public.live_link_revoke(p_token text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.live_links set revoked_at = now() where token = p_token and user_id = v_user and revoked_at is null;
  delete from internal.live_link_runs where token = p_token and exists (select 1 from public.live_links l where l.token = p_token and l.user_id = v_user);
end $$;

/** A new address for the standing link; the old one stops working at once. */
create or replace function public.live_link_rotate() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_show boolean := false;
  v_old text;
begin
  select token, show_everywhere into v_old, v_show from public.live_links where user_id = v_user and kind = 'standing' and revoked_at is null;
  if v_old is not null then perform public.live_link_revoke(v_old); end if;
  return public.live_link_create('standing', v_show);
end $$;

create or replace function public.live_link_set_show_everywhere(p_token text, p_value boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  update public.live_links set show_everywhere = coalesce(p_value, false) where token = p_token and user_id = v_user and revoked_at is null;
end $$;

/** The runner's own open links, with how often each was opened (no positions, no viewers). */
create or replace function public.my_live_links() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'token', l.token, 'kind', l.kind, 'show_everywhere', l.show_everywhere, 'views', l.views,
           'created_at', l.created_at, 'expires_at', l.expires_at,
           'run', (select jsonb_build_object('session_id', r.session_id, 'state', r.state, 'started_at', r.started_at, 'ended_at', r.ended_at)
                     from internal.live_link_runs r where r.token = l.token order by r.started_at desc limit 1))
         order by l.created_at desc), '[]'::jsonb)
    from public.live_links l
   where l.user_id = auth.uid() and internal.live_link_open(l);
$$;

/**
 * The live page (signed in or not, by unguessable link). Shows the runner's display name, the current
 * run's trail and last position, time running and distance so far. Positions inside the runner's
 * protected areas are left out unless they chose to show everything for this link. Nothing at all for an
 * unknown or revoked link, a blocked viewer or an inactive account; once sharing is over, only its state.
 */
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
  select * into l from public.live_links where token = p_token and revoked_at is null;
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
  -- Visible points, in order, split where a stretch was hidden; thinned to about 500 points.
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

/**
 * Every minute (from run_maintenance): run links end after their run plus the grace period or at their
 * expiry; a switched-off feature ends everything open; no run is shared longer than the longest time; and
 * positions go once sharing has been over for longer than the keep time.
 */
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
    update internal.live_link_runs set state = 'stopped', ended_at = now() where ended_at is null;
    update public.live_links set ended_at = now() where kind = 'run' and ended_at is null and revoked_at is null;
  end if;
  update internal.live_link_runs set state = 'stopped', ended_at = now() where ended_at is null and started_at < now() - v_max;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update public.live_links l set ended_at = now()
   where l.kind = 'run' and l.ended_at is null and l.revoked_at is null
     and (l.expires_at < now() or exists (select 1 from internal.live_link_runs r where r.token = l.token and r.ended_at < now() - v_grace));
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from internal.live_link_runs where ended_at < now() - v_keep;
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  delete from public.live_links where kind = 'run' and coalesce(ended_at, revoked_at) < now() - interval '30 days';
  return v_n;
end $$;

-- The every-minute maintenance gains the live-link tick (the rest is unchanged from 20261111000100).
create or replace function internal.run_maintenance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_t integer;
  v_s integer;
  v_a integer;
  v_m integer;
  v_l integer;
  v_live integer;
begin
  perform internal.maintain_seasons();
  v_t := internal.publish_due_territory(500);
  v_s := internal.publish_due_titles(500);
  v_a := internal.evaluate_dirty_achievements(300);
  v_m := internal.enqueue_missing_movement(100);
  v_l := internal.enqueue_waiting_layers(50);
  v_live := internal.live_links_tick();
  -- Digest dispatch is per user local time; the worker groups pending items (see notifications job).
  if exists (select 1 from internal.digest_items where digested_at is null) then
    perform internal.enqueue_job('notifications', 'dispatch_digests', '{}', 'digests', now());
  end if;
  return jsonb_build_object('territory_events', v_t, 'titles', v_s, 'achievements', v_a, 'movement_jobs', v_m, 'layer_jobs', v_l, 'live_links', v_live);
end $$;

/** Once a day: path-following counts older than 90 days go (the daily totals stay in the metrics). */
create or replace function internal.running_tools_daily() returns integer
language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v integer;
begin
  delete from internal.route_snap_usage where day < (now() at time zone 'utc')::date - 90;
  get diagnostics v = row_count;
  return v;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('loopfield-running-daily', '29 3 * * *', 'select internal.running_tools_daily()');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Grants: the runner functions for signed-in users, the live page for anyone with the link
-- ---------------------------------------------------------------------------------------------
-- New internal helpers are reached only through the functions above, triggers and the maintenance job.
revoke execute on function internal.planned_routes_guard(), internal.take_route_snap(uuid), internal.new_link_token(),
  internal.geo_distance_m(double precision, double precision, double precision, double precision),
  internal.in_protected_area(uuid, double precision, double precision), internal.live_link_open(public.live_links),
  internal.live_links_tick(), internal.running_tools_daily() from public, anon, authenticated;
grant execute on function internal.planned_routes_guard(), internal.take_route_snap(uuid), internal.new_link_token(),
  internal.geo_distance_m(double precision, double precision, double precision, double precision),
  internal.in_protected_area(uuid, double precision, double precision), internal.live_link_open(public.live_links),
  internal.live_links_tick(), internal.running_tools_daily() to service_role;
do $$
declare
  f text;
  rpc text[] := array['live_link_create', 'live_link_push', 'live_link_end', 'live_link_revoke', 'live_link_rotate',
                      'live_link_set_show_everywhere', 'my_live_links', 'public_live_link'];
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
grant execute on function public.public_live_link(text, boolean) to anon;
