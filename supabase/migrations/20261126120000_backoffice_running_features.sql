-- Back office for the running features (R1 to R4): the review queue for stretch and start-to-finish proposals,
-- ending a runner's live links from support, live-sharing status on tickets and runner pages, four Overview
-- figures, twelve daily metrics and the settings the console needs. Only additions: one new setting, two
-- registry rows given options or a different permission, one new staff function and new fields in the
-- results of existing ones. ops_route_queue is recreated because its result gains columns; it keeps its
-- name, argument and permission.
--
-- Staff never see live positions, who a runner shares with, planned routes, heart rate or training, the
-- routes of imported runs, or shoe names and photos. They see counts, and whether sharing is on.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('route_review_target_hours', '48', false, 'Hours a speed-route proposal can wait for review before the console highlights it.')
on conflict (key) do nothing;

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('route_review_target_hours', 'Route review target (hours)', 'system', 'integer', 1, 336, null, 'config', 31,
   'Proposals waiting longer than this are highlighted in the review queue and counted on the Overview.')
on conflict (key) do nothing;

-- The health cards the app can hide, so the Settings screen offers a choice and a misspelt id is refused.
update internal.config_registry
   set allowed = array['heart_rate', 'steps', 'calories', 'sleep', 'resting_hr', 'hrv', 'vo2_max', 'training', 'imported_routes'],
       help = 'Health cards hidden in the app because of a known data-quality fault. Training and maps of imported runs can be hidden here too.'
 where key = 'disabled_health_cards';

-- Start-to-finish routes change the competition, so they need the Edit game rules permission.
update internal.config_registry
   set category = 'tunable', min_role = 'rules.edit', sort = 45,
       help = 'On lets runners propose part of a run with a separate start and finish; reviewers see a start-to-finish badge. Off allows loops only.'
 where key = 'route_proposals_a_to_b';

create or replace function internal.validate_config_value(r internal.config_registry, p_value jsonb) returns void
language plpgsql stable set search_path = pg_catalog, internal as $$
declare
  k text;
  v jsonb;
  n numeric;
  b numeric[];
  -- Core competition, social, health, privacy and deletion features are never premium (PRD §19).
  core text[] := array['territory', 'territory_capture', 'land', 'reclaim', 'speed', 'speed_titles', 'competition', 'seasons', 'events',
                       'clubs', 'social', 'posts', 'comments', 'follows', 'messaging', 'chat', 'health', 'privacy', 'protected_areas',
                       'consent', 'deletion', 'account_deletion', 'data_export', 'export', 'recording', 'appeals', 'reports'];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then raise exception '% needs a value', r.label using errcode = '22023'; end if;
  case r.value_type
    when 'boolean' then
      if jsonb_typeof(p_value) <> 'boolean' then raise exception '% must be on or off', r.label using errcode = '22023'; end if;
    when 'integer', 'number' then
      if jsonb_typeof(p_value) <> 'number' then raise exception '% must be a number', r.label using errcode = '22023'; end if;
      n := (p_value #>> '{}')::numeric;
      if r.value_type = 'integer' and n <> trunc(n) then raise exception '% must be a whole number', r.label using errcode = '22023'; end if;
      if (r.min_value is not null and n < r.min_value) or (r.max_value is not null and n > r.max_value) then
        raise exception '% must be between % and %', r.label, r.min_value, r.max_value using errcode = '22023';
      end if;
    when 'string' then
      if jsonb_typeof(p_value) <> 'string' then raise exception '% must be text', r.label using errcode = '22023'; end if;
      if r.allowed is not null and not ((p_value #>> '{}') = any (r.allowed)) then
        raise exception '% must be one of: %', r.label, array_to_string(r.allowed, ', ') using errcode = '22023';
      end if;
    when 'version' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d+\.\d+\.\d+$' then raise exception '% must look like 1.2.3', r.label using errcode = '22023'; end if;
    when 'string_array' then
      if jsonb_typeof(p_value) <> 'array' then raise exception '% must be a list', r.label using errcode = '22023'; end if;
      for v in select e.value from jsonb_array_elements(p_value) e loop
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-z][a-z0-9_]{1,40}$' then
          raise exception '% entries must be lowercase keys (a-z, 0-9, _)', r.label using errcode = '22023';
        end if;
        if r.key = 'premium_features' and (v #>> '{}') = any (core) then
          raise exception '"%" is a core feature and can never require premium', v #>> '{}' using errcode = '22023';
        end if;
        -- A list with known options (the health cards) takes only those, so a misspelt key cannot silently do nothing.
        if r.allowed is not null and not ((v #>> '{}') = any (r.allowed)) then
          raise exception '"%" is not one of the options for %: %', v #>> '{}', r.label, array_to_string(r.allowed, ', ') using errcode = '22023';
        end if;
      end loop;
    when 'object' then
      if jsonb_typeof(p_value) <> 'object' then raise exception '% must be an object', r.label using errcode = '22023'; end if;
      if r.allowed is not null then
        for k in select jsonb_object_keys(p_value) loop
          if not (k = any (r.allowed)) then raise exception '% has an unknown field "%"', r.label, k using errcode = '22023'; end if;
        end loop;
      end if;
  end case;

  -- Shape rules for structured settings.
  if r.key = 'achievement_tier_points' then
    if (select count(*) from jsonb_object_keys(p_value)) <> 4 then raise exception 'set points for bronze, silver, gold and platinum' using errcode = '22023'; end if;
    for k, v in select e.key, e.value from jsonb_each(p_value) e loop
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 1000 then raise exception 'tier points must be between 0 and 1000' using errcode = '22023'; end if;
    end loop;
  elsif r.key = 'latest_app_version' then
    for k, v in select e.key, e.value from jsonb_each(p_value) e loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d+\.\d+\.\d+$' then raise exception 'versions must look like 1.2.3' using errcode = '22023'; end if;
    end loop;
  elsif r.key = 'maintenance_mode' then
    if jsonb_typeof(p_value -> 'enabled') is distinct from 'boolean' then raise exception 'maintenance mode needs enabled set to true or false' using errcode = '22023'; end if;
    if (p_value -> 'enabled')::boolean and char_length(btrim(coalesce(p_value ->> 'message', ''))) < 5 then
      raise exception 'write a message for users (at least 5 characters) while maintenance is on' using errcode = '22023';
    end if;
    if char_length(coalesce(p_value ->> 'message', '')) > 200 then raise exception 'keep the maintenance message under 200 characters' using errcode = '22023'; end if;
    if jsonb_typeof(p_value -> 'until') = 'string' then perform (p_value ->> 'until')::timestamptz;
    elsif p_value ? 'until' and jsonb_typeof(p_value -> 'until') <> 'null' then raise exception 'until must be a time or empty' using errcode = '22023';
    end if;
  elsif r.key = 'rate_limits' then
    for k, v in select e.key, e.value from jsonb_each(p_value) e loop
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 1 and 10000 then
        raise exception 'each limit must be a whole number from 1 to 10,000' using errcode = '22023';
      end if;
    end loop;
  elsif r.key = 'integrity_overrides' then
    for k, v in select e.key, e.value from jsonb_each(p_value) e loop
      if k = 'version' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 60 then raise exception 'the label must be text under 60 characters' using errcode = '22023'; end if;
        continue;
      end if;
      -- Bounds match integrityRulesWith in packages/core/src/integrity/speed.ts.
      b := case k
             when 'envelopeMargin' then array[1, 1.5] when 'isolatedSpikeMaxFixes' then array[0, 5] when 'smoothingFixes' then array[1, 15]
             when 'liveWarnSeconds' then array[10, 300] when 'liveImpossiblePauseSeconds' then array[20, 600]
             when 'liveVehiclePauseSeconds' then array[30, 900] when 'liveWindowSeconds' then array[60, 900]
             when 'stepsMinSpeedMetersPerSecond' then array[2, 5] when 'stepsMinCadence' then array[40, 160]
             when 'stepsFlagSeconds' then array[30, 600] when 'stepsPauseSeconds' then array[60, 1800] end;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between b[1] and b[2] then
        raise exception '% must be between % and %', k, b[1], b[2] using errcode = '22023';
      end if;
    end loop;
  elsif r.key = 'analytics_time_zone' then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_value #>> '{}') then
      raise exception 'unknown time zone %', p_value #>> '{}' using errcode = '22023';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Live sharing for support: whether it is on, and ending it
-- ---------------------------------------------------------------------------------------------
/**
 * Whether a runner has live links that still work, and whether sharing with friends is on. Counts and
 * yes or no only: never positions, tokens, who received a link or who the runner shares with.
 */
create or replace function internal.live_sharing_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select jsonb_build_object(
    'live_links', (select count(*) from public.live_links l
                    where l.user_id = p_user and l.kind in ('run', 'standing') and l.revoked_at is null and l.ended_at is null
                      and (l.expires_at is null or l.expires_at > now())),
    'friends_sharing', coalesce((select s.friends_live_mode <> 'off' from public.user_settings s where s.user_id = p_user), false),
    'live_links_enabled', internal.config_bool('live_links_enabled', true),
    'friends_live_enabled', internal.config_bool('friends_live_enabled', true));
$$;

/**
 * Support ends every live link of one runner at once, including runs being shared with friends, as the
 * runner can for their own links: each stops working and its positions are deleted. Optionally it also
 * turns off their sharing with friends. Needs the support permission and a reason; writes an audit row and
 * tells the runner in the app. Returns how many links it ended, never what they showed.
 */
create or replace function public.ops_end_live_links(p_user uuid, p_reason text, p_stop_friend_sharing boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_tokens text[];
  v_links integer;
  v_rows integer;
  v_friends boolean := false;
begin
  -- The support permission itself: require_role('support') resolves to runner lookup (users.view).
  if v_actor is null or not ('support' = any (authz.staff_permissions(v_actor))) then
    raise exception 'requires the support permission' using errcode = '42501';
  end if;
  perform internal.require_mfa_if_enabled();
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'runner not found' using errcode = 'P0002'; end if;

  with ended as (
    update public.live_links set revoked_at = now()
     where user_id = p_user and revoked_at is null and ended_at is null
    returning token
  )
  select coalesce(array_agg(token), '{}') into v_tokens from ended;
  delete from internal.live_link_runs where token = any (v_tokens);
  v_links := cardinality(v_tokens);

  if coalesce(p_stop_friend_sharing, false) then
    update public.user_settings set friends_live_mode = 'off' where user_id = p_user and friends_live_mode <> 'off';
    get diagnostics v_rows = row_count;
    v_friends := v_rows > 0;
  end if;

  perform internal.audit(v_actor, 'staff', 'end_live_links', 'profile', p_user::text,
    jsonb_build_object('reason', v_reason, 'links_ended', v_links, 'friend_sharing_off', v_friends));
  if v_links > 0 or v_friends then
    perform internal.notify(p_user, 'system', 'live_links_ended', null, 'profile', p_user::text,
      jsonb_build_object('links', v_links, 'friend_sharing_off', v_friends), null);
  end if;
  return jsonb_build_object('links_ended', v_links, 'friend_sharing_off', v_friends);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Route review queue: stretch and start-to-finish proposals, waiting time and quick checks
-- ---------------------------------------------------------------------------------------------
-- The result gains columns, so the function is recreated; callers that read the old columns are unaffected.
drop function public.ops_route_queue(integer);
create function public.ops_route_queue(p_limit integer default 50)
returns table (id uuid, name text, creator_handle text, length_m double precision, closed boolean, created_at timestamptz, path_geojson jsonb,
               course_geometry jsonb, score_founding_run boolean, from_m double precision, to_m double precision, shape text,
               waited_hours double precision, over_target boolean, checks jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_target integer := internal.config_int('route_review_target_hours', 48);
  v_rules jsonb;
begin
  perform internal.require_role('route_reviewer');
  -- The limits the proposal job used: the speed rules of the running public season race.
  v_rules := internal.effective_rules('speed', (select s.speed_rules_version from public.seasons s join public.competitions c on c.id = s.competition_id
                                                 where c.kind = 'public' and s.status = 'active' order by s.starts_at desc limit 1));
  return query
  select rp.id, rp.name, p.handle::text, rp.length_m, rp.closed, rp.created_at, st_asgeojson(rp.path, 6)::jsonb, rp.course_geometry, rp.score_founding_run,
         rp.from_m, rp.to_m,
         case when rp.closed then 'loop' when not rp.closed then 'a_to_b' end,
         (extract(epoch from now() - rp.created_at) / 3600.0)::double precision,
         rp.created_at < now() - make_interval(hours => v_target),
         -- What the server already checked before the proposal reached review. A proposal touching a protected
         -- area never gets here, and the areas themselves are never shown.
         jsonb_build_object(
           'length_min_m', (v_rules ->> 'minCourseLengthMeters')::double precision,
           'length_max_m', (v_rules ->> 'maxCourseLengthMeters')::double precision,
           'region', (select rg.name from public.regions rg where rg.id = rp.region_id),
           'protected_areas', 'passed',
           'nearby', coalesce((select jsonb_agg(jsonb_build_object('id', n.course_id, 'name', n.course_name, 'distance_m', n.distance_m) order by n.distance_m)
                                 from (select c.id as course_id, c.name as course_name,
                                              round(st_distance(cv.path::geography, rp.path::geography))::integer as distance_m
                                         from public.courses c join public.course_versions cv on cv.id = c.current_version_id
                                        where c.status = 'active' and st_dwithin(cv.path::geography, rp.path::geography, 100)
                                        order by st_distance(cv.path::geography, rp.path::geography) limit 5) n), '[]'::jsonb),
           'nearby_within_m', 100,
           'target_hours', v_target)
    from public.route_proposals rp join public.profiles p on p.id = rp.creator_id
   where rp.status = 'pending_review' order by rp.created_at limit least(p_limit, 200);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Overview, runner page and support ticket
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_overview() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_any_staff();
  v_cron jsonb := '[]'::jsonb;
  v_min integer := greatest(internal.config_int('running_now_min_count', 5), 5);
  v_target integer := internal.config_int('route_review_target_hours', 48);
  v_now internal.running_now_summary;
begin
  select * into v_now from internal.running_now_summary s where s.scope = 'all' and s.key = '';
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_status', d.status, 'last_start', d.start_time, 'last_end', d.end_time) order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (select r.status, r.start_time, r.end_time from cron.job_run_details r
                            where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
    $q$ into v_cron;
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'settings', (select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb) from public.app_config c
                  left join internal.config_registry r on r.key = c.key
                  where r.category = 'switch' or c.key in ('paywall_enabled', 'maintenance_mode', 'ops_require_mfa', 'min_supported_app_version')),
    'jobs', (select coalesce(jsonb_object_agg(q.queue, q.stats), '{}'::jsonb) from (
               select j.queue, jsonb_build_object(
                 'queued', count(*) filter (where j.status = 'queued'),
                 'running', count(*) filter (where j.status = 'running'),
                 'dead', count(*) filter (where j.status = 'dead'),
                 'failed_24h', count(*) filter (where j.status in ('failed', 'dead') and j.updated_at > now() - interval '24 hours'),
                 'oldest_ready_at', min(j.run_at) filter (where j.status = 'queued' and j.run_at <= now())) as stats
                 from internal.jobs j group by j.queue) q),
    'queues', jsonb_build_object(
      'moderation', (select jsonb_build_object('open', count(*), 'urgent', count(*) filter (where m.priority = 'urgent'), 'oldest', min(m.created_at))
                       from public.moderation_cases m where m.status in ('open', 'in_review')),
      'integrity', (select jsonb_build_object('open', count(*), 'held', count(*) filter (where i.hold_from_competition), 'oldest', min(i.created_at))
                      from public.integrity_cases i where i.status <> 'resolved'),
      'appeals', (select jsonb_build_object('open', count(*), 'oldest', min(a.created_at)) from public.appeals a where a.status in ('submitted', 'in_review')),
      'routes', (select jsonb_build_object('open', count(*), 'oldest', min(rp.created_at),
                          'over_target', count(*) filter (where rp.created_at < now() - make_interval(hours => v_target)), 'target_hours', v_target)
                   from public.route_proposals rp where rp.status = 'pending_review'),
      'reports_24h', (select count(*) from public.reports rr where rr.created_at > now() - interval '24 hours'),
      'exports', (select count(*) from public.data_exports de where de.status in ('queued', 'running')),
      'deletions', (select count(*) from public.deletion_requests dr where dr.status in ('queued', 'running', 'failed'))),
    'activity_24h', jsonb_build_object(
      'runs', (select count(*) from public.activities a where a.started_at > now() - interval '24 hours' and a.status <> 'deleted'),
      'claims', (select count(*) from public.loop_claims lc where lc.received_at > now() - interval '24 hours'),
      'sign_ups', (select count(*) from public.profiles p where p.created_at > now() - interval '24 hours'),
      'posts', (select count(*) from public.posts po where po.created_at > now() - interval '24 hours')),
    'totals', jsonb_build_object(
      'runners', (select count(*) from public.profiles p where p.status = 'active'),
      'suspended', (select count(*) from public.profiles p where p.status = 'suspended'),
      'clubs', (select count(*) from public.clubs cl where cl.status = 'active'),
      'staff', (select count(distinct s.user_id) from public.staff_roles s where s.revoked_at is null)),
    'billing', jsonb_build_object('failed_events_7d', (select count(*) from internal.billing_events b where b.status = 'failed' and b.received_at > now() - interval '7 days')),
    'email', jsonb_build_object(
      'bounced_7d', (select count(*) from internal.email_log e where e.status in ('bounced', 'complained') and e.updated_at > now() - interval '7 days'),
      'failed_7d', (select count(*) from internal.email_log e where e.status = 'failed' and e.updated_at > now() - interval '7 days')),
    'seasons', (select coalesce(jsonb_agg(jsonb_build_object('competition', c.name, 'number', s.number, 'status', s.status, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.ends_at), '[]'::jsonb)
                  from public.seasons s join public.competitions c on c.id = s.competition_id where s.status in ('active', 'settling')),
    -- Running tools: counts only. Never positions, who a runner shares with, or anything about one runner.
    'running', jsonb_build_object(
      'live_links_now', (select count(distinct l.token) from public.live_links l join internal.live_link_runs r on r.token = l.token
                          where l.kind in ('run', 'standing') and r.ended_at is null and internal.live_link_open(l)),
      'friends_live_now', (select count(*) from public.live_links l join internal.live_link_runs r on r.token = l.token
                            where l.kind = 'friends' and r.ended_at is null and internal.live_link_open(l)),
      -- Counted per UTC day by the path-following function, so the month is a UTC month too.
      'route_snap_month', (select coalesce(sum(u.requests), 0) from internal.route_snap_usage u
                            where u.day >= date_trunc('month', now() at time zone 'utc')::date),
      'route_snap_alert', internal.config_int('route_snap_monthly_alert', 0),
      -- The same everywhere count runners see: blank below the smallest count ever shown.
      'running_now', jsonb_build_object('enabled', internal.config_bool('running_now_enabled', true), 'min_count', v_min,
                       'everywhere', case when v_now.runners >= v_min then v_now.runners end, 'computed_at', v_now.computed_at)),
    'cron', v_cron);
end $$;

create or replace function public.ops_user_overview(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_role('users.view');
  p public.profiles;
  v_auth jsonb;
begin
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'runner not found' using errcode = 'P0002'; end if;
  -- Sign-in facts without the address itself (columns vary between Auth versions, so read them dynamically).
  execute format('select jsonb_build_object(%s) from auth.users u where u.id = $1',
    concat_ws(', ',
      $f$'email_confirmed', u.email_confirmed_at is not null$f$,
      case when exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at')
           then $f$'last_sign_in_at', u.last_sign_in_at$f$ end,
      case when exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until')
           then $f$'banned_until', u.banned_until$f$ end,
      case when exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous')
           then $f$'is_anonymous', u.is_anonymous$f$ end))
    into v_auth using p_user;

  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'bio', p.bio, 'status', p.status,
                 'visibility', p.visibility, 'discoverable', p.discoverable, 'city_label', p.city_label, 'avatar_kind', p.avatar_kind,
                 'district', (select d.name from public.districts d where d.id = p.district_id),
                 'created_at', p.created_at, 'updated_at', p.updated_at, 'onboarding_completed_at', p.onboarding_completed_at),
    'account', coalesce(v_auth, '{}'::jsonb),
    'stats', (select jsonb_build_object(
                 'runs', count(*), 'runs_30d', count(*) filter (where a.started_at > now() - interval '30 days'),
                 'distance_m', coalesce(sum(a.distance_m), 0), 'distance_30d_m', coalesce(sum(a.distance_m) filter (where a.started_at > now() - interval '30 days'), 0),
                 'moving_ms', coalesce(sum(a.moving_ms), 0), 'first_run_at', min(a.started_at), 'last_run_at', max(a.started_at),
                 'flagged_runs', count(*) filter (where coalesce(cardinality(a.integrity_flags), 0) > 0))
                from public.activities a where a.user_id = p.id and a.deleted_at is null)
             || (select jsonb_build_object(
                 'loops_eligible', count(*) filter (where lc.status = 'eligible'),
                 'loops_rejected', count(*) filter (where lc.status in ('unranked', 'invalid')),
                 'land_cells', coalesce(sum(lc.eligible_cell_count) filter (where lc.status = 'eligible'), 0))
                from public.loop_claims lc where lc.user_id = p.id and lc.parent_claim_id is null)
             || jsonb_build_object(
                 'movement_points', (select coalesce(sum(m.amount), 0) from internal.movement_ledger m where m.user_id = p.id),
                 'followers', (select count(*) from public.follows f where f.followee_id = p.id and f.state = 'accepted'),
                 'following', (select count(*) from public.follows f where f.follower_id = p.id and f.state = 'accepted'),
                 'clubs', (select count(*) from public.club_memberships cm where cm.user_id = p.id and cm.state = 'active'),
                 'posts', (select count(*) from public.posts po where po.author_id = p.id and po.status = 'published'),
                 'reports_against', (select count(*) from public.moderation_cases mc where mc.subject_user_id = p.id),
                 'reports_filed', (select count(*) from public.reports r where r.reporter_id = p.id)),
    'recent_activities', coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at desc) from (
        select a.id, a.started_at, a.distance_m, a.moving_ms, a.status, a.integrity_flags, a.title,
               (select lc.status from public.loop_claims lc where lc.activity_id = a.id and lc.parent_claim_id is null limit 1) as claim_status,
               (select lc.eligible_cell_count from public.loop_claims lc where lc.activity_id = a.id and lc.parent_claim_id is null limit 1) as claim_cells
          from public.activities a where a.user_id = p.id and a.deleted_at is null order by a.started_at desc limit 12) x), '[]'::jsonb),
    'moderation_cases', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select mc.id, mc.object_type, mc.status, mc.priority, mc.outcome, mc.report_count, mc.created_at, mc.resolved_at
          from public.moderation_cases mc where mc.subject_user_id = p.id order by mc.created_at desc limit 10) x), '[]'::jsonb),
    'integrity_cases', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select ic.id, ic.kind, ic.status, ic.resolution, ic.hold_from_competition, ic.created_at, ic.resolved_at
          from public.integrity_cases ic where ic.subject_user_id = p.id order by ic.created_at desc limit 10) x), '[]'::jsonb),
    'support_tickets', coalesce((select jsonb_agg(to_jsonb(x) order by x.last_message_at desc) from (
        select t.id, t.subject, t.category, t.status, t.priority, t.created_at, t.last_message_at
          from public.support_tickets t where t.user_id = p.id order by t.last_message_at desc limit 10) x), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('entitlement', e.entitlement, 'status', e.status, 'is_active', e.is_active,
                      'store', e.store, 'expires_at', e.expires_at, 'source', e.source)) from public.entitlements e where e.user_id = p.id), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('platform', pt.platform, 'last_seen_at', pt.last_seen_at, 'disabled', pt.disabled_at is not null)
                      order by pt.last_seen_at desc nulls last) from public.push_tokens pt where pt.user_id = p.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(x) order by x.kind) from (
        select distinct on (c.kind) c.kind, c.granted, c.version, c.created_at
          from public.consents c where c.user_id = p.id order by c.kind, c.created_at desc) x), '[]'::jsonb),
    'lifecycle', jsonb_build_object(
        'exports', coalesce((select jsonb_agg(jsonb_build_object('status', de.status, 'created_at', de.created_at, 'completed_at', de.completed_at) order by de.created_at desc)
                      from (select * from public.data_exports de where de.user_id = p.id order by de.created_at desc limit 5) de), '[]'::jsonb),
        'deletion', (select jsonb_build_object('status', dr.status, 'requested_at', dr.requested_at, 'completed_at', dr.completed_at)
                      from public.deletion_requests dr where dr.user_id = p.id order by dr.requested_at desc limit 1)),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', sr.role, 'label', d.label, 'granted_at', sr.granted_at))
                      from public.staff_roles sr join internal.staff_role_defs d on d.key = sr.role
                     where sr.user_id = p.id and sr.revoked_at is null), '[]'::jsonb),
    'staff_actions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select al.id, al.action, al.object_type, al.created_at, al.details ->> 'reason' as reason, ap.handle as actor
          from internal.audit_log al left join public.profiles ap on ap.id = al.actor_id
         where al.object_id = p.id::text and al.actor_kind = 'staff' order by al.created_at desc limit 20) x), '[]'::jsonb),
    'sharing', internal.live_sharing_status(p.id),
    'can_manage', authz.has_role(v, 'users.manage'),
    'is_self', v = p.id);
end $$;

create or replace function public.ops_support_ticket(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('support');
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if t.staff_unread then update public.support_tickets set staff_unread = false where id = p_ticket; end if;
  return jsonb_build_object(
    'ticket', to_jsonb(t),
    'runner', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'status', p.status,
                 'joined_at', p.created_at, 'avatar_kind', p.avatar_kind,
                 'runs', (select count(*) from public.activities a where a.user_id = p.id and a.deleted_at is null),
                 'last_run_at', (select max(a.started_at) from public.activities a where a.user_id = p.id and a.deleted_at is null),
                 'tickets', (select count(*) from public.support_tickets o where o.user_id = p.id),
                 'sharing', internal.live_sharing_status(p.id))
               from public.profiles p where p.id = t.user_id),
    'assignee', (select jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name) from public.profiles a where a.id = t.assigned_to),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.author_kind, 'body', m.body, 'internal', m.internal,
                   'at', m.created_at, 'author', case when m.author_kind = 'staff' then (select handle from public.profiles s where s.id = m.author_id) end)
                   order by m.created_at) from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb),
    'other_tickets', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'subject', o.subject, 'status', o.status, 'created_at', o.created_at)
                   order by o.created_at desc) from (select * from public.support_tickets o where o.user_id = t.user_id and o.id <> t.id
                   order by o.created_at desc limit 10) o), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name) order by p.handle)
                   from (select distinct sr.user_id from public.staff_roles sr where sr.revoked_at is null) s
                   join public.profiles p on p.id = s.user_id where authz.has_role(s.user_id, 'support')), '[]'::jsonb),
    'me', v);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Daily metrics
-- ---------------------------------------------------------------------------------------------
/**
 * True when a metric's source rows for that day may already have been purged, so a refresh keeps the
 * value counted while they were there instead of counting what is left. The margins are a little inside
 * each purge: per-runner path-following counts after 90 days and running-now peaks after about 13 months
 * (internal.running_tools_daily), live links 30 days after they end (internal.live_links_tick) and
 * notifications after 180 days.
 */
create or replace function internal.metric_kept(p_metric text, p_day date) returns boolean
language sql stable set search_path = pg_catalog as $$
  select coalesce(p_day < (now() at time zone 'utc')::date - case p_metric
                    when 'route_snap_requests' then 88
                    when 'running_now_peak' then 395
                    when 'live_links_started' then 28
                    when 'live_links_opened' then 28
                    when 'friends_live_runs' then 28
                    when 'gear_reminders_sent' then 178
                  end, false);
$$;

-- The catalog gains the Running tools group and a fixed search path (Supabase advisor: function_search_path_mutable).
create or replace function internal.metric_catalog() returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select '[
    {"key":"active_runners","label":"Active runners","unit":"runners","agg":"distinct","group":"Running"},
    {"key":"runs","label":"Runs","unit":"runs","agg":"sum","group":"Running"},
    {"key":"distance_km","label":"Distance","unit":"km","agg":"sum","group":"Running"},
    {"key":"moving_hours","label":"Time moving","unit":"h","agg":"sum","group":"Running"},
    {"key":"loops_claimed","label":"Loops that claimed land","unit":"loops","agg":"sum","group":"Territory"},
    {"key":"loops_rejected","label":"Loops not counted","unit":"loops","agg":"sum","group":"Territory"},
    {"key":"land_cells","label":"Land cells captured","unit":"cells","agg":"sum","group":"Territory"},
    {"key":"land_km2","label":"Land captured","unit":"km²","agg":"sum","group":"Territory"},
    {"key":"signups","label":"Sign-ups","unit":"runners","agg":"sum","group":"Growth"},
    {"key":"onboarded","label":"Finished onboarding","unit":"runners","agg":"sum","group":"Growth"},
    {"key":"posts","label":"Posts","unit":"posts","agg":"sum","group":"Community"},
    {"key":"comments","label":"Comments","unit":"comments","agg":"sum","group":"Community"},
    {"key":"follows","label":"New follows","unit":"follows","agg":"sum","group":"Community"},
    {"key":"club_joins","label":"Club joins","unit":"joins","agg":"sum","group":"Community"},
    {"key":"reports","label":"Reports","unit":"reports","agg":"sum","group":"Trust & safety"},
    {"key":"moderation_resolved","label":"Moderation cases resolved","unit":"cases","agg":"sum","group":"Trust & safety"},
    {"key":"integrity_opened","label":"Integrity cases opened","unit":"cases","agg":"sum","group":"Trust & safety"},
    {"key":"route_proposals","label":"Route proposals","unit":"proposals","agg":"sum","group":"Trust & safety"},
    {"key":"support_opened","label":"Support conversations","unit":"conversations","agg":"sum","group":"Support"},
    {"key":"support_solved","label":"Support solved","unit":"conversations","agg":"sum","group":"Support"},
    {"key":"support_first_response_min","label":"First response (median)","unit":"min","agg":"median","group":"Support"},
    {"key":"pushes_sent","label":"Push notifications sent","unit":"pushes","agg":"sum","group":"Platform"},
    {"key":"emails_sent","label":"Emails sent","unit":"emails","agg":"sum","group":"Platform"},
    {"key":"jobs_dead","label":"Jobs that failed","unit":"jobs","agg":"sum","group":"Platform"},
    {"key":"planned_routes_created","label":"Planned routes saved","unit":"routes","agg":"sum","group":"Running tools","description":"Routes runners planned and saved in the route builder."},
    {"key":"route_snap_requests","label":"Path-following requests","unit":"requests","agg":"sum","group":"Running tools","description":"Legs drawn along paths with Mapbox, from the daily count per runner. Counted per UTC day."},
    {"key":"live_links_started","label":"Live links started","unit":"links","agg":"sum","group":"Running tools","description":"Live links made for one run or as a standing link. Runs shared with friends are counted separately."},
    {"key":"live_links_opened","label":"Live links opened","unit":"links","agg":"sum","group":"Running tools","description":"Of the links started that day, those opened at least once."},
    {"key":"running_now_peak","label":"Most runners out at once","unit":"runners","agg":"max","group":"Running tools","description":"The highest runners-out-right-now count that day, everywhere. Counted per UTC day."},
    {"key":"friends_live_runs","label":"Runs shared live with friends","unit":"runs","agg":"sum","group":"Running tools","description":"Runs shared live with the friends a runner chose, or with all their friends."},
    {"key":"route_proposals_stretch","label":"Proposals from part of a run","unit":"proposals","agg":"sum","group":"Running tools","description":"Speed-route proposals made from a stretch of a run rather than the whole run."},
    {"key":"route_proposals_a_to_b","label":"Start-to-finish proposals","unit":"proposals","agg":"sum","group":"Running tools","description":"Proposals built as start-to-finish routes rather than loops."},
    {"key":"route_review_hours_median","label":"Route review time (median)","unit":"h","agg":"median","group":"Running tools","description":"Hours from proposal to a decision by a reviewer, for proposals decided that day."},
    {"key":"gear_added","label":"Pairs of shoes added","unit":"pairs","agg":"sum","group":"Running tools","description":"Pairs of shoes runners added."},
    {"key":"runs_with_gear","label":"Runs with shoes","unit":"runs","agg":"sum","group":"Running tools","description":"Runs counted towards a pair of shoes, counted like Runs."},
    {"key":"gear_reminders_sent","label":"Shoe reminders sent","unit":"reminders","agg":"sum","group":"Running tools","description":"Reminders sent when a pair reaches 90% or 100% of its distance."}
  ]'::jsonb;
$$;

create or replace function internal.refresh_metrics(p_from date, p_to date) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  tz text := internal.analytics_tz();
  t0 timestamptz := (p_from::timestamp at time zone tz);
  t1 timestamptz := ((p_to + 1)::timestamp at time zone tz);
begin
  perform pg_advisory_xact_lock(hashtext('internal.refresh_metrics'));
  -- Days whose source rows may already be purged keep the values counted while the rows were there.
  delete from internal.metrics_daily where day between p_from and p_to and not internal.metric_kept(metric, day);
  insert into internal.metrics_daily (day, metric, value)
  select d, m, v from (
    select (created_at at time zone tz)::date d, 'signups' m, count(*)::float v from public.profiles where created_at >= t0 and created_at < t1 group by 1
    union all
    select (onboarding_completed_at at time zone tz)::date, 'onboarded', count(*) from public.profiles
     where onboarding_completed_at >= t0 and onboarding_completed_at < t1 group by 1
    union all
    select (started_at at time zone tz)::date, 'runs', count(*) from public.activities
     where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1
    union all
    select (started_at at time zone tz)::date, 'active_runners', count(distinct user_id) from public.activities
     where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1
    union all
    select (started_at at time zone tz)::date, 'distance_km', coalesce(sum(distance_m), 0) / 1000.0 from public.activities
     where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1
    union all
    select (started_at at time zone tz)::date, 'moving_hours', coalesce(sum(moving_ms), 0) / 3600000.0 from public.activities
     where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1
    union all
    select (created_at at time zone tz)::date, 'loops_claimed', count(*) from public.loop_claims
     where created_at >= t0 and created_at < t1 and parent_claim_id is null and status = 'eligible' group by 1
    union all
    select (created_at at time zone tz)::date, 'loops_rejected', count(*) from public.loop_claims
     where created_at >= t0 and created_at < t1 and parent_claim_id is null and status in ('unranked', 'invalid') group by 1
    union all
    select (created_at at time zone tz)::date, 'land_cells', coalesce(sum(eligible_cell_count), 0) from public.loop_claims
     where created_at >= t0 and created_at < t1 and parent_claim_id is null and status = 'eligible' group by 1
    union all
    select (created_at at time zone tz)::date, 'land_km2', coalesce(sum(eligible_area_m2), 0) / 1e6 from public.loop_claims
     where created_at >= t0 and created_at < t1 and parent_claim_id is null and status = 'eligible' group by 1
    union all
    select (created_at at time zone tz)::date, 'posts', count(*) from public.posts where created_at >= t0 and created_at < t1 and status = 'published' group by 1
    union all
    select (created_at at time zone tz)::date, 'comments', count(*) from public.comments where created_at >= t0 and created_at < t1 and status = 'visible' group by 1
    union all
    select (accepted_at at time zone tz)::date, 'follows', count(*) from public.follows where accepted_at >= t0 and accepted_at < t1 and state = 'accepted' group by 1
    union all
    select (created_at at time zone tz)::date, 'club_joins', count(*) from public.club_memberships where created_at >= t0 and created_at < t1 and state = 'active' group by 1
    union all
    select (created_at at time zone tz)::date, 'reports', count(*) from public.reports where created_at >= t0 and created_at < t1 group by 1
    union all
    select (resolved_at at time zone tz)::date, 'moderation_resolved', count(*) from public.moderation_cases where resolved_at >= t0 and resolved_at < t1 group by 1
    union all
    select (created_at at time zone tz)::date, 'integrity_opened', count(*) from public.integrity_cases where created_at >= t0 and created_at < t1 group by 1
    union all
    select (created_at at time zone tz)::date, 'route_proposals', count(*) from public.route_proposals where created_at >= t0 and created_at < t1 group by 1
    union all
    select (created_at at time zone tz)::date, 'support_opened', count(*) from public.support_tickets where created_at >= t0 and created_at < t1 group by 1
    union all
    select (solved_at at time zone tz)::date, 'support_solved', count(*) from public.support_tickets where solved_at >= t0 and solved_at < t1 group by 1
    union all
    select (created_at at time zone tz)::date, 'support_first_response_min',
           percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at) / 60.0)
      from public.support_tickets where created_at >= t0 and created_at < t1 and first_response_at is not null group by 1
    union all
    select (created_at at time zone tz)::date, 'pushes_sent', count(*) from public.notifications where created_at >= t0 and created_at < t1 and push_state = 'sent' group by 1
    union all
    select (sent_at at time zone tz)::date, 'emails_sent', count(*) from internal.email_outbox where sent_at >= t0 and sent_at < t1 and status = 'sent' group by 1
    union all
    select (coalesce(finished_at, updated_at) at time zone tz)::date, 'jobs_dead', count(*) from internal.jobs
     where status = 'dead' and coalesce(finished_at, updated_at) >= t0 and coalesce(finished_at, updated_at) < t1 group by 1
    -- Running tools (counts only; nothing about any one runner).
    union all
    select (created_at at time zone tz)::date, 'planned_routes_created', count(*) from public.planned_routes
     where created_at >= t0 and created_at < t1 group by 1
    union all
    -- The per-runner counts are kept per UTC day, so this metric's days are UTC days.
    select day, 'route_snap_requests', coalesce(sum(requests), 0) from internal.route_snap_usage where day between p_from and p_to group by 1
    union all
    select (created_at at time zone tz)::date, 'live_links_started', count(*) from public.live_links
     where created_at >= t0 and created_at < t1 and kind in ('run', 'standing') group by 1
    union all
    select (created_at at time zone tz)::date, 'live_links_opened', count(*) from public.live_links
     where created_at >= t0 and created_at < t1 and kind in ('run', 'standing') and views > 0 group by 1
    union all
    -- Kept per UTC day by the every-minute count.
    select day, 'running_now_peak', max(peak) from internal.running_now_peaks where day between p_from and p_to group by 1
    union all
    select (created_at at time zone tz)::date, 'friends_live_runs', count(*) from public.live_links
     where created_at >= t0 and created_at < t1 and kind = 'friends' group by 1
    union all
    select (created_at at time zone tz)::date, 'route_proposals_stretch', count(*) from public.route_proposals
     where created_at >= t0 and created_at < t1 and from_m is not null group by 1
    union all
    select (created_at at time zone tz)::date, 'route_proposals_a_to_b', count(*) from public.route_proposals
     where created_at >= t0 and created_at < t1 and closed = false group by 1
    union all
    select (decided_at at time zone tz)::date, 'route_review_hours_median',
           percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 3600.0)
      from public.route_proposals where decided_at >= t0 and decided_at < t1 and reviewed_by is not null and status in ('approved', 'declined') group by 1
    union all
    select (created_at at time zone tz)::date, 'gear_added', count(*) from public.gear where created_at >= t0 and created_at < t1 group by 1
    union all
    select (started_at at time zone tz)::date, 'runs_with_gear', count(*) from public.activities
     where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') and gear_id is not null group by 1
    union all
    select (created_at at time zone tz)::date, 'gear_reminders_sent', count(*) from public.notifications
     where created_at >= t0 and created_at < t1 and kind = 'gear_reminder' group by 1
  ) x where d between p_from and p_to and not internal.metric_kept(x.m, x.d);
  update internal.metrics_meta set refreshed_at = now() where id;
end $$;

-- Totals for a range: "max" metrics (the most runners out at once) take the highest day, not the sum.
create or replace function public.ops_metrics(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('analytics');
  tz text := internal.analytics_tz();
  v_today date := (now() at time zone tz)::date;
  v_to date := least(coalesce(p_to, v_today), v_today);
  v_from date := greatest(coalesce(p_from, v_to - 29), v_to - 365);
  v_len integer;
  v_pfrom date;
  v_pto date;
begin
  if v_from > v_to then raise exception 'the start must be before the end' using errcode = '22023'; end if;
  if (select refreshed_at from internal.metrics_meta where id) < now() - interval '10 minutes' then
    -- Skip when another request or the hourly job is refreshing right now; it will have today's numbers.
    if pg_try_advisory_xact_lock(hashtext('internal.refresh_metrics')) then
      begin
        perform internal.refresh_metrics(v_today - 1, v_today);
      exception when others then
        raise warning 'ops_metrics: refresh skipped: % (%)', sqlerrm, sqlstate;
      end;
    end if;
  end if;
  v_len := v_to - v_from + 1;
  v_pto := v_from - 1;
  v_pfrom := v_from - v_len;
  return (
    with cat as (select e ->> 'key' k, e ->> 'agg' agg from jsonb_array_elements(internal.metric_catalog()) e),
    days as (select d::date d from generate_series(v_from, v_to, interval '1 day') d),
    series as (
      select c.k, jsonb_agg(coalesce(m.value, 0) order by days.d) vals
        from cat c cross join days left join internal.metrics_daily m on m.day = days.d and m.metric = c.k
       group by c.k
    ),
    tot as (
      select c.k,
             case c.agg when 'median' then (select avg(value) from internal.metrics_daily where metric = c.k and day between v_from and v_to)
                        when 'max' then coalesce((select max(value) from internal.metrics_daily where metric = c.k and day between v_from and v_to), 0)
                        when 'distinct' then internal.period_active_runners(v_from, v_to)
                        else coalesce((select sum(value) from internal.metrics_daily where metric = c.k and day between v_from and v_to), 0) end cur,
             case c.agg when 'median' then (select avg(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto)
                        when 'max' then coalesce((select max(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto), 0)
                        when 'distinct' then internal.period_active_runners(v_pfrom, v_pto)
                        else coalesce((select sum(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto), 0) end prev
        from cat c
    )
    select jsonb_build_object(
      'time_zone', tz, 'from', v_from, 'to', v_to, 'previous_from', v_pfrom, 'previous_to', v_pto,
      'refreshed_at', (select refreshed_at from internal.metrics_meta where id),
      'catalog', internal.metric_catalog(),
      'days', (select jsonb_agg(d order by d) from days),
      'series', (select jsonb_object_agg(k, vals) from series),
      'totals', (select jsonb_object_agg(k, cur) from tot),
      'previous', (select jsonb_object_agg(k, prev) from tot))
  );
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Grants: staff functions for signed-in users only (each checks its permission inside)
-- ---------------------------------------------------------------------------------------------
revoke execute on function internal.live_sharing_status(uuid), internal.metric_kept(text, date) from public, anon, authenticated;
grant execute on function internal.live_sharing_status(uuid), internal.metric_kept(text, date) to service_role;
revoke execute on function public.ops_end_live_links(uuid, text, boolean), public.ops_route_queue(integer) from public, anon;
grant execute on function public.ops_end_live_links(uuid, text, boolean), public.ops_route_queue(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. Count the new metrics from the first day of the running features
-- ---------------------------------------------------------------------------------------------
do $$
begin
  perform internal.refresh_metrics(date '2026-11-25', (now() at time zone internal.analytics_tz())::date);
end $$;
