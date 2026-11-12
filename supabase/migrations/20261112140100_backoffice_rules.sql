-- Back office: game rules and the settings behind them.
--
-- * Loop, GPS, vehicle and speed-route thresholds become editable rule versions. Each season records the
--   versions it runs on (seasons.territory_rules_version / speed_rules_version) and every run records the
--   version on its recording ticket, so a change starts with the next season by default; staff with the
--   rules.apply permission can move running seasons to a version straight away (runs started after that
--   use it, runs already recorded keep theirs).
-- * New settings for sharing, season timings, post limits, anti-spam limits and four kill switches.
-- * Season timings (late uploads, publication delay, settlement) are copied onto each season when it is
--   created, so changing them never moves the goalposts of a running season.

-- ---------------------------------------------------------------------------------------------
-- Rule catalog and versions
-- ---------------------------------------------------------------------------------------------
create table internal.rule_catalog (
  family text not null check (family in ('territory', 'speed')),
  key text not null,
  label text not null,
  help text not null,
  unit text not null check (unit in ('m', 'm2', 's', 'm/s', 'share', 'ratio', 'count')),
  default_value double precision not null,
  min_value double precision not null,
  max_value double precision not null,
  step double precision not null,
  grp text not null,
  sort integer not null,
  primary key (family, key),
  check (default_value between min_value and max_value)
);

-- Defaults mirror packages/core/src/rules/config.ts (TERRITORY_RULES, SPEED_RULES).
insert into internal.rule_catalog (family, key, label, help, unit, default_value, min_value, max_value, step, grp, sort) values
  ('territory', 'minLoopLengthMeters', 'Minimum loop length', 'Shortest run that can claim land.', 'm', 1000, 200, 10000, 50, 'Loop', 10),
  ('territory', 'maxLoopLengthMeters', 'Maximum loop length', 'Longer loops are not counted.', 'm', 30000, 2000, 60000, 500, 'Loop', 20),
  ('territory', 'closureMaxGapMeters', 'Closing distance', 'How close the finish must be to the start.', 'm', 20, 5, 100, 1, 'Loop', 30),
  ('territory', 'closureEndpointMaxAccuracyMeters', 'GPS accuracy where the loop closes', 'Worst GPS accuracy allowed at the start and the finish.', 'm', 15, 5, 50, 1, 'Loop', 40),
  ('territory', 'maxCandidateAreaSquareMeters', 'Largest area per loop', 'Most land one loop can enclose. 25 km² is the processing limit.', 'm2', 25000000, 100000, 25000000, 100000, 'Loop', 50),
  ('territory', 'minCompactness', 'Shape check', 'Rejects out-and-back "loops" with almost nothing inside. 0 turns the check off.', 'ratio', 0.03, 0, 0.5, 0.01, 'Loop', 60),
  ('territory', 'minEligibleCells', 'Minimum land cells', 'Fewest cells a loop must capture after exclusion zones.', 'count', 1, 1, 100, 1, 'Loop', 70),
  ('territory', 'maxSampleGapSeconds', 'Longest GPS gap', 'Longest gap between GPS points before the run is broken.', 's', 10, 3, 60, 1, 'GPS quality', 80),
  ('territory', 'maxUsableAccuracyMeters', 'Worst usable accuracy', 'GPS points less accurate than this are ignored.', 'm', 25, 5, 100, 1, 'GPS quality', 90),
  ('territory', 'minUsableFixShare', 'Usable points needed', 'Share of GPS points that must be usable.', 'share', 0.9, 0.5, 1, 0.01, 'GPS quality', 100),
  ('territory', 'minSamples', 'Minimum GPS points', 'Fewest usable GPS points in a run.', 'count', 30, 10, 1000, 1, 'GPS quality', 110),
  ('territory', 'suspiciousSustainedSpeedMetersPerSecond', 'Vehicle speed', 'Sustained speed treated as a vehicle.', 'm/s', 6.5, 3, 15, 0.1, 'Vehicle checks', 120),
  ('territory', 'suspiciousSustainedSeconds', 'Vehicle duration', 'How long that speed has to last.', 's', 60, 10, 600, 5, 'Vehicle checks', 130),
  ('territory', 'maxJumpSpeedMetersPerSecond', 'Jump limit', 'Faster jumps between GPS points count as GPS errors.', 'm/s', 12, 5, 50, 0.5, 'Vehicle checks', 140),
  ('speed', 'minCourseLengthMeters', 'Shortest route', 'Shortest speed route that can be proposed.', 'm', 1000, 200, 10000, 50, 'Routes', 10),
  ('speed', 'maxCourseLengthMeters', 'Longest route', 'Longest speed route that can be proposed.', 'm', 5000, 1000, 42195, 100, 'Routes', 20),
  ('speed', 'corridorMeters', 'Corridor width', 'How far an attempt may stray from the route.', 'm', 20, 5, 50, 1, 'Routes', 30),
  ('speed', 'minCoverage', 'Route coverage', 'Share of the route an attempt must cover.', 'share', 0.95, 0.5, 1, 0.01, 'Routes', 40),
  ('speed', 'duplicateRouteMaxHausdorffMeters', 'Duplicate threshold', 'Proposals closer than this to an existing route are duplicates.', 'm', 30, 5, 200, 1, 'Routes', 50),
  ('speed', 'maxAttemptUncertaintySeconds', 'Timing uncertainty', 'Attempts with less certain timing are not ranked.', 's', 3, 0.5, 30, 0.5, 'Timing', 60),
  ('speed', 'marginMinSeconds', 'Winning margin', 'A new champion must be faster by at least this many seconds…', 's', 5, 0, 60, 1, 'Timing', 70),
  ('speed', 'marginFraction', 'Winning margin (share)', '…or by this share of the champion''s time, whichever is larger.', 'share', 0.01, 0, 0.1, 0.005, 'Timing', 80);

create table internal.rule_versions (
  version text primary key check (char_length(version) between 3 and 80),
  family text not null check (family in ('territory', 'speed')),
  base_version text not null,
  overrides jsonb not null default '{}' check (jsonb_typeof(overrides) = 'object'),
  note text not null,
  is_builtin boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

insert into internal.rule_versions (version, family, base_version, overrides, note, is_builtin) values
  ('territory-2026.11.0-proposed', 'territory', 'territory-2026.11.0-proposed', '{}', 'Built-in defaults', true),
  ('speed-2026.11.0-proposed', 'speed', 'speed-2026.11.0-proposed', '{}', 'Built-in defaults', true)
on conflict (version) do nothing;
insert into internal.rule_versions (version, family, base_version, overrides, note, is_builtin)
select distinct s.territory_rules_version, 'territory', s.territory_rules_version, '{}'::jsonb, 'Built-in defaults', true from public.seasons s
on conflict (version) do nothing;
insert into internal.rule_versions (version, family, base_version, overrides, note, is_builtin)
select distinct s.speed_rules_version, 'speed', s.speed_rules_version, '{}'::jsonb, 'Built-in defaults', true from public.seasons s
on conflict (version) do nothing;

-- The version the next season starts with. Without a row a season inherits the previous one's.
create table internal.rule_next (
  family text primary key check (family in ('territory', 'speed')),
  version text not null references internal.rule_versions (version),
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now()
);

create or replace function internal.effective_rules(p_family text, p_version text) returns jsonb
language sql stable set search_path = pg_catalog, internal as $$
  select coalesce(jsonb_object_agg(c.key, coalesce((v.overrides ->> c.key)::double precision, c.default_value) order by c.sort), '{}'::jsonb)
    from internal.rule_catalog c
    left join internal.rule_versions v on v.version = p_version and v.family = p_family
   where c.family = p_family;
$$;

-- ---------------------------------------------------------------------------------------------
-- Season timings, copied onto each season when it is created
-- ---------------------------------------------------------------------------------------------
alter table public.seasons
  add column if not exists late_upload_hours smallint check (late_upload_hours between 1 and 168),
  add column if not exists publication_delay_minutes smallint check (publication_delay_minutes between 15 and 1440),
  add column if not exists settlement_delay_hours smallint check (settlement_delay_hours between 1 and 168);
update public.seasons set late_upload_hours = coalesce(late_upload_hours, 24), publication_delay_minutes = coalesce(publication_delay_minutes, 30),
                          settlement_delay_hours = coalesce(settlement_delay_hours, 24);

create or replace function internal.seasons_pin_rules() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v text;
begin
  select version into v from internal.rule_next where family = 'territory';
  if v is not null then new.territory_rules_version := v; end if;
  select version into v from internal.rule_next where family = 'speed';
  if v is not null then new.speed_rules_version := v; end if;
  new.late_upload_hours := coalesce(new.late_upload_hours, internal.config_int('season_late_upload_hours', 24));
  new.publication_delay_minutes := coalesce(new.publication_delay_minutes, internal.config_int('season_publication_delay_minutes', 30));
  new.settlement_delay_hours := coalesce(new.settlement_delay_hours, internal.config_int('season_settlement_delay_hours', 24));
  return new;
end $$;

create trigger seasons_pin_rules before insert on public.seasons for each row execute function internal.seasons_pin_rules();

-- ---------------------------------------------------------------------------------------------
-- What the app reads: the rules of the main season race (the public competition) that is running
-- ---------------------------------------------------------------------------------------------
create or replace function public.game_rules() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  with s as (
    select s.territory_rules_version tv, s.speed_rules_version sv
      from public.seasons s join public.competitions c on c.id = s.competition_id
     where c.kind = 'public' and s.status = 'active'
     order by s.starts_at desc limit 1
  ), v as (
    select coalesce((select tv from s), (select version from internal.rule_next where family = 'territory'),
                    (select version from internal.rule_versions where family = 'territory' and is_builtin order by created_at limit 1)) tv,
           coalesce((select sv from s), (select version from internal.rule_next where family = 'speed'),
                    (select version from internal.rule_versions where family = 'speed' and is_builtin order by created_at limit 1)) sv
  )
  select jsonb_build_object('territory_version', v.tv, 'speed_version', v.sv,
                            'territory', internal.effective_rules('territory', v.tv), 'speed', internal.effective_rules('speed', v.sv))
    from v;
$$;

grant execute on function public.game_rules() to authenticated;
revoke all on function public.game_rules() from anon;

-- ---------------------------------------------------------------------------------------------
-- Anti-spam limits and action kill switches
-- ---------------------------------------------------------------------------------------------
create table internal.rate_limit_catalog (
  action text primary key,
  label text not null,
  default_limit integer not null,
  window_seconds integer not null,
  sort integer not null
);

insert into internal.rate_limit_catalog (action, label, default_limit, window_seconds, sort) values
  ('post', 'Posts', 10, 3600, 10),
  ('comment', 'Comments', 60, 3600, 20),
  ('follow', 'Follow requests', 60, 3600, 30),
  ('report', 'Reports', 20, 86400, 40),
  ('route_proposal', 'Route proposals', 5, 86400, 50),
  ('support_ticket', 'Support conversations', 12, 3600, 60),
  ('club_create', 'New clubs', 3, 86400, 70),
  ('create_event', 'New events', 10, 86400, 80),
  ('join_event', 'Event joins', 30, 3600, 90),
  ('club_invite', 'Club invites', 100, 86400, 100),
  ('club_email_invite', 'Club email invites', 50, 86400, 110),
  ('activity_link', 'Share links', 20, 86400, 120),
  ('reclaim', 'Reclaims', 30, 3600, 130),
  ('export', 'Data exports', 3, 86400, 140);

-- Every user action that is rate limited passes through here, so this is also where the action kill
-- switches are enforced. Limits set in App control replace the coded defaults; the window stays.
create or replace function internal.enforce_rate_limit(p_subject text, p_action text, p_limit integer, p_window_seconds integer)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_switch text := case p_action
                     when 'comment' then 'comments_enabled'
                     when 'club_create' then 'club_creation_enabled'
                     when 'route_proposal' then 'route_proposals_enabled'
                   end;
  v_limit integer;
begin
  if v_switch is not null and not internal.config_bool(v_switch, true) then
    raise exception 'feature_paused' using errcode = '55000', detail = v_switch, hint = 'This is switched off for now. Please try again later.';
  end if;
  select (c.value ->> p_action)::integer into v_limit
    from public.app_config c where c.key = 'rate_limits' and jsonb_typeof(c.value -> p_action) = 'number';
  if not internal.check_rate_limit(p_subject, p_action, coalesce(v_limit, p_limit), p_window_seconds) then
    raise exception 'rate limit exceeded for %', p_action using errcode = 'P0429';
  end if;
end $$;

-- Storage policies call this for the avatar switch; only *_enabled settings can be read.
create or replace function authz.feature_enabled(p_key text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select case when p_key like '%\_enabled' then coalesce((select (c.value #>> '{}')::boolean from public.app_config c where c.key = p_key), true) else true end;
$$;
grant execute on function authz.feature_enabled(text) to authenticated;

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and authz.feature_enabled('avatar_uploads_enabled'));
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and authz.feature_enabled('avatar_uploads_enabled'));

-- ---------------------------------------------------------------------------------------------
-- Post and comment length limits (hard ceiling 5,000; the setting decides below that)
-- ---------------------------------------------------------------------------------------------
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts add constraint posts_body_check check (char_length(body) <= 5000);
alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments add constraint comments_body_check check (char_length(btrim(body)) >= 1 and char_length(body) <= 5000);

create or replace function internal.check_text_limits() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_max integer;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then return new; end if;
  v_max := case tg_table_name when 'posts' then internal.config_int('post_max_chars', 2000) else internal.config_int('comment_max_chars', 1000) end;
  if char_length(coalesce(new.body, '')) > v_max then
    raise exception '% can be at most % characters', case tg_table_name when 'posts' then 'Posts' else 'Comments' end, v_max using errcode = '22001';
  end if;
  return new;
end $$;

create trigger posts_text_limits before insert or update of body on public.posts for each row execute function internal.check_text_limits();
create trigger comments_text_limits before insert or update of body on public.comments for each row execute function internal.check_text_limits();

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('comments_enabled', 'true', true, 'Off pauses new comments.'),
  ('avatar_uploads_enabled', 'true', true, 'Off pauses new profile photos.'),
  ('club_creation_enabled', 'true', true, 'Off pauses creating clubs.'),
  ('route_proposals_enabled', 'true', true, 'Off pauses new route proposals.'),
  ('share_map_min_distance_m', '600', true, 'Shortest run that shows its route on a share card.'),
  ('share_publish_delay_minutes', '30', false, 'Minutes after a run ends before a shared route is public.'),
  ('privacy_zone_margin_m', '50', false, 'Extra metres hidden around privacy zones on shared routes.'),
  ('share_street_map_enabled', 'true', true, 'Street map under shared routes on share cards.'),
  ('movement_min_distance_m', '200', false, 'Shortest verified run that earns movement points.'),
  ('season_late_upload_hours', '24', false, 'Hours after a run ends that its upload still counts, for new seasons.'),
  ('season_publication_delay_minutes', '30', false, 'Minutes before results appear on the public map, for new seasons.'),
  ('season_settlement_delay_hours', '24', false, 'Hours after a season ends before results are final, for new seasons.'),
  ('post_max_photos', '5', true, 'Most photos on one post.'),
  ('post_max_chars', '2000', true, 'Longest post.'),
  ('comment_max_chars', '1000', true, 'Longest comment.'),
  ('daily_digest_hour', '19', false, 'Local hour the daily digest notification is sent.'),
  ('rate_limits', '{}', false, 'Anti-spam limits that replace the coded defaults.')
on conflict (key) do nothing;

alter table internal.config_registry drop constraint if exists config_registry_category_check;
alter table internal.config_registry add constraint config_registry_category_check
  check (category in ('switch', 'tunable', 'sharing', 'season', 'limits', 'release', 'monetization', 'system'));

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('comments_enabled', 'Comments', 'switch', 'boolean', null, null, null, 'territory_operator', 17, 'Off stops new comments. Existing comments stay visible.'),
  ('avatar_uploads_enabled', 'Profile photo uploads', 'switch', 'boolean', null, null, null, 'territory_operator', 18, 'Off stops new profile photos. Drawn avatars keep working.'),
  ('club_creation_enabled', 'Club creation', 'switch', 'boolean', null, null, null, 'territory_operator', 19, 'Off stops new clubs from being created.'),
  ('route_proposals_enabled', 'Route proposals', 'switch', 'boolean', null, null, null, 'territory_operator', 20, 'Off stops new speed route proposals.'),
  ('movement_min_distance_m', 'Shortest run that earns points (m)', 'tunable', 'integer', 0, 5000, null, 'config', 19, 'Verified distance a run needs before it earns movement points.'),
  ('share_map_min_distance_m', 'Shortest run with a map on share cards (m)', 'sharing', 'integer', 300, 20000, null, 'config', 70, 'Shorter runs get a share card without a map. Never below three times the hidden distance, so something is left to draw.'),
  ('share_publish_delay_minutes', 'Delay before a shared route is public (min)', 'sharing', 'integer', 15, 1440, null, 'config', 73, 'Minutes after the run ends. Protects runners from being followed in real time.'),
  ('privacy_zone_margin_m', 'Extra margin around privacy zones (m)', 'sharing', 'integer', 50, 500, null, 'config', 74, 'Hidden around each runner''s privacy zones on shared routes. Can only go up from 50.'),
  ('share_street_map_enabled', 'Street map under shared routes', 'sharing', 'boolean', null, null, null, 'config', 75, 'Off draws the route on its own. Also a way to cut Mapbox costs.'),
  ('season_late_upload_hours', 'Late uploads accepted for (hours)', 'season', 'integer', 1, 168, null, 'config', 80, 'Runs uploaded later than this after they end don''t count. Applies to seasons created after the change.'),
  ('season_publication_delay_minutes', 'Results appear on the public map after (min)', 'season', 'integer', 15, 1440, null, 'config', 81, 'Delay between a run and its land showing publicly. Applies to seasons created after the change.'),
  ('season_settlement_delay_hours', 'Results final after (hours)', 'season', 'integer', 1, 168, null, 'config', 82, 'Time between a season ending and its results being settled. Applies to seasons created after the change.'),
  ('post_max_photos', 'Photos per post', 'limits', 'integer', 0, 10, null, 'config', 90, 'Most photos on one post. 0 allows text-only posts.'),
  ('post_max_chars', 'Longest post (characters)', 'limits', 'integer', 100, 5000, null, 'config', 91, null),
  ('comment_max_chars', 'Longest comment (characters)', 'limits', 'integer', 50, 5000, null, 'config', 92, null),
  ('daily_digest_hour', 'Daily digest time (local hour)', 'limits', 'integer', 0, 23, null, 'config', 93, 'Hour of the runner''s day when the daily digest is sent.'),
  ('rate_limits', 'Anti-spam limits', 'limits', 'object', null, null, (select array_agg(action order by sort) from internal.rate_limit_catalog), 'config', 94, 'Most actions per runner in each window. Empty fields use the built-in limit.')
on conflict (key) do update set label = excluded.label, category = excluded.category, value_type = excluded.value_type, min_value = excluded.min_value,
  max_value = excluded.max_value, allowed = excluded.allowed, min_role = excluded.min_role, sort = excluded.sort, help = excluded.help;

update internal.config_registry set category = 'sharing', sort = 72 where key = 'share_route_trim_m';
update internal.config_registry set label = 'Hidden at the start and finish (m)', help = 'Metres hidden at each end of a shared route. Lower values reveal more.' where key = 'share_route_trim_m';
update internal.config_registry
   set allowed = array['version', 'envelopeMargin', 'isolatedSpikeMaxFixes', 'smoothingFixes', 'liveWarnSeconds', 'liveImpossiblePauseSeconds',
                       'liveVehiclePauseSeconds', 'liveWindowSeconds', 'stepsMinSpeedMetersPerSecond', 'stepsMinCadence', 'stepsFlagSeconds', 'stepsPauseSeconds'],
       label = 'Cheat-detection tuning', help = 'Fine-tuning for the speed envelope, live warnings and the step-cadence check. Empty fields use the built-in value.'
 where key = 'integrity_overrides';

-- Validation gains the structured settings added here (and reads catalog tables, so it is stable now).
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
-- Rules screen
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_rules() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_any_staff();
begin
  return jsonb_build_object(
    'catalog', (select jsonb_agg(jsonb_build_object('family', family, 'key', key, 'label', label, 'help', help, 'unit', unit,
                  'default', default_value, 'min', min_value, 'max', max_value, 'step', step, 'group', grp) order by family, sort)
                  from internal.rule_catalog),
    'versions', (select jsonb_agg(jsonb_build_object('version', rv.version, 'family', rv.family, 'overrides', rv.overrides, 'note', rv.note,
                   'is_builtin', rv.is_builtin, 'created_at', rv.created_at, 'created_by', p.handle,
                   'values', internal.effective_rules(rv.family, rv.version),
                   'seasons', (select count(*) from public.seasons s where (rv.family = 'territory' and s.territory_rules_version = rv.version)
                                                                       or (rv.family = 'speed' and s.speed_rules_version = rv.version)))
                   order by rv.family, rv.created_at desc)
                   from internal.rule_versions rv left join public.profiles p on p.id = rv.created_by),
    'next', (select jsonb_object_agg(f.family, coalesce(n.version,
               (select case f.family when 'territory' then s.territory_rules_version else s.speed_rules_version end
                  from public.seasons s join public.competitions c on c.id = s.competition_id
                 where c.kind = 'public' order by s.starts_at desc limit 1),
               (select version from internal.rule_versions where family = f.family and is_builtin order by created_at limit 1)))
               from (values ('territory'), ('speed')) f(family) left join internal.rule_next n on n.family = f.family),
    'next_explicit', (select coalesce(jsonb_object_agg(family, version), '{}'::jsonb) from internal.rule_next),
    'running', (select coalesce(jsonb_agg(jsonb_build_object('season_id', s.id, 'number', s.number, 'status', s.status, 'starts_at', s.starts_at,
                   'ends_at', s.ends_at, 'competition', c.name, 'kind', c.kind,
                   'territory_rules_version', s.territory_rules_version, 'speed_rules_version', s.speed_rules_version)
                   order by (c.kind <> 'public'), s.starts_at), '[]'::jsonb)
                  from public.seasons s join public.competitions c on c.id = s.competition_id where s.status in ('active', 'scheduled')),
    'rate_limits', (select jsonb_agg(jsonb_build_object('action', action, 'label', label, 'default', default_limit, 'window_seconds', window_seconds)
                     order by sort) from internal.rate_limit_catalog),
    'can_edit', authz.has_role(v, 'rules.edit'),
    'can_apply', authz.has_role(v, 'rules.apply'));
end $$;

-- Saves the given values as a rule version (reusing an identical one) and makes it the next season's.
create or replace function public.ops_save_rules(p_family text, p_values jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('rules.edit');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_over jsonb := '{}';
  v_eff jsonb;
  c internal.rule_catalog;
  k text;
  v jsonb;
  x double precision;
  v_version text;
  v_base text;
  v_n integer;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if p_family is null or p_family not in ('territory', 'speed') then raise exception 'unknown rule family' using errcode = '22023'; end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then raise exception 'rules must be an object' using errcode = '22023'; end if;
  for k, v in select e.key, e.value from jsonb_each(p_values) e loop
    select * into c from internal.rule_catalog rc where rc.family = p_family and rc.key = k;
    if not found then raise exception 'unknown rule %', k using errcode = '22023'; end if;
    if jsonb_typeof(v) <> 'number' then raise exception '% must be a number', c.label using errcode = '22023'; end if;
    x := (v #>> '{}')::double precision;
    if x < c.min_value or x > c.max_value then raise exception '% must be between % and %', c.label, c.min_value, c.max_value using errcode = '22023'; end if;
    if x <> c.default_value then v_over := v_over || jsonb_build_object(k, x); end if;
  end loop;

  select coalesce(jsonb_object_agg(rc.key, coalesce((v_over ->> rc.key)::double precision, rc.default_value)), '{}'::jsonb) into v_eff
    from internal.rule_catalog rc where rc.family = p_family;
  if p_family = 'territory' and (v_eff ->> 'minLoopLengthMeters')::float >= (v_eff ->> 'maxLoopLengthMeters')::float then
    raise exception 'the minimum loop length must be shorter than the maximum' using errcode = '22023';
  end if;
  if p_family = 'speed' and (v_eff ->> 'minCourseLengthMeters')::float >= (v_eff ->> 'maxCourseLengthMeters')::float then
    raise exception 'the shortest route must be shorter than the longest' using errcode = '22023';
  end if;

  select rv.version into v_version from internal.rule_versions rv
   where rv.family = p_family and rv.overrides = v_over order by rv.is_builtin desc, rv.created_at desc limit 1;
  if v_version is null then
    select rv.version into v_base from internal.rule_versions rv where rv.family = p_family and rv.is_builtin order by rv.created_at desc limit 1;
    select count(*) + 1 into v_n from internal.rule_versions rv where rv.family = p_family and not rv.is_builtin;
    v_version := v_base || '+ops.' || v_n;
    insert into internal.rule_versions (version, family, base_version, overrides, note, created_by)
    values (v_version, p_family, v_base, v_over, v_reason, v_actor);
  end if;
  insert into internal.rule_next (family, version, set_by, set_at) values (p_family, v_version, v_actor, now())
  on conflict (family) do update set version = excluded.version, set_by = excluded.set_by, set_at = now();
  perform internal.audit(v_actor, 'staff', 'rules_saved', 'rule_version', v_version,
                         jsonb_build_object('family', p_family, 'overrides', v_over, 'reason', v_reason));
  return jsonb_build_object('version', v_version, 'values', v_eff);
end $$;

create or replace function public.ops_set_next_rules(p_family text, p_version text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('rules.edit');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if not exists (select 1 from internal.rule_versions where version = p_version and family = p_family) then
    raise exception 'unknown % rule version %', p_family, p_version using errcode = 'P0002';
  end if;
  insert into internal.rule_next (family, version, set_by, set_at) values (p_family, p_version, v_actor, now())
  on conflict (family) do update set version = excluded.version, set_by = excluded.set_by, set_at = now();
  perform internal.audit(v_actor, 'staff', 'rules_next_set', 'rule_version', p_version, jsonb_build_object('family', p_family, 'reason', v_reason));
end $$;

-- Moves every running and scheduled season to the version now. Runs already recorded keep the
-- version on their recording ticket.
create or replace function public.ops_apply_rules_now(p_family text, p_version text, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('rules.apply');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_seasons jsonb;
  v_count integer;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if not exists (select 1 from internal.rule_versions where version = p_version and family = p_family) then
    raise exception 'unknown % rule version %', p_family, p_version using errcode = 'P0002';
  end if;
  with changed as (
    update public.seasons s
       set territory_rules_version = case when p_family = 'territory' then p_version else s.territory_rules_version end,
           speed_rules_version = case when p_family = 'speed' then p_version else s.speed_rules_version end
     where s.status in ('active', 'scheduled')
       and (case when p_family = 'territory' then s.territory_rules_version else s.speed_rules_version end) is distinct from p_version
    returning s.id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb), count(*) into v_seasons, v_count from changed;
  insert into internal.rule_next (family, version, set_by, set_at) values (p_family, p_version, v_actor, now())
  on conflict (family) do update set version = excluded.version, set_by = excluded.set_by, set_at = now();
  perform internal.audit(v_actor, 'staff', 'rules_applied_now', 'rule_version', p_version,
                         jsonb_build_object('family', p_family, 'seasons', v_seasons, 'reason', v_reason));
  return v_count;
end $$;

grant execute on function public.ops_rules() to authenticated;
grant execute on function public.ops_save_rules(text, jsonb, text) to authenticated;
grant execute on function public.ops_set_next_rules(text, text, text) to authenticated;
grant execute on function public.ops_apply_rules_now(text, text, text) to authenticated;
revoke all on function public.ops_rules() from anon;
revoke all on function public.ops_save_rules(text, jsonb, text) from anon;
revoke all on function public.ops_set_next_rules(text, text, text) from anon;
revoke all on function public.ops_apply_rules_now(text, text, text) from anon;

-- ---------------------------------------------------------------------------------------------
-- Existing functions that now read the settings above (bodies unchanged apart from the marked values)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.share_route(p_activity uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal', 'extensions'
AS $function$
declare
  v_route text;
  v_line geometry;
  v_m geometry;
  v_len double precision;
  v_trim double precision := greatest(internal.config_int('share_route_trim_m', 200), 100);
  v_hidden geometry;
  v_parts jsonb;
begin
  select personal_route into v_route from public.activities where id = p_activity and user_id = p_user and deleted_at is null;
  if v_route is null or length(v_route) < 4 then return null; end if;
  v_line := st_setsrid(st_linefromencodedpolyline(v_route, 5), 4326);
  if v_line is null or st_npoints(v_line) < 2 then return null; end if;
  v_len := st_length(v_line::geography);
  if v_len < greatest(v_trim * 3, internal.config_int('share_map_min_distance_m', 600)) then return null; end if;
  -- Cut by length in a local metric projection (fractions there match ground distance), then simplify.
  v_m := st_linesubstring(st_transform(v_line, 3857), v_trim / v_len, 1 - v_trim / v_len);
  v_line := st_transform(st_simplifypreservetopology(v_m, 6), 4326);
  select st_union(st_buffer(coalesce(pa.geom, st_buffer(pa.center, pa.radius_m)), greatest(50, internal.config_int('privacy_zone_margin_m', 50)))::geometry) into v_hidden from public.protected_areas pa where pa.user_id = p_user;
  if v_hidden is not null then v_line := st_difference(v_line, v_hidden); end if;
  select jsonb_agg(st_asencodedpolyline(d.geom, 5) order by d.path)
    into v_parts
    from st_dump(v_line) d
   where st_geometrytype(d.geom) = 'ST_LineString' and st_length(d.geom::geography) >= 50;
  return v_parts;
end $function$;

CREATE OR REPLACE FUNCTION internal.share_payload(p_act activities, p_fields text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
declare
  v_summary jsonb;
  v_publish timestamptz := now();
  v_claim public.loop_claims;
  v_attempt public.speed_attempts;
  v_route jsonb;
  v_land jsonb;
begin
  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'distance_m', case when 'distance' = any (p_fields) then round(p_act.distance_m::numeric) end,
    'elapsed_ms', case when 'duration' = any (p_fields) then p_act.elapsed_ms end,
    'moving_ms', case when 'duration' = any (p_fields) then p_act.moving_ms end,
    'avg_pace_s_per_km', case when 'pace' = any (p_fields) then p_act.avg_pace_s_per_km end,
    'elevation_gain_m', case when 'distance' = any (p_fields) and p_act.elevation_gain_m is not null then round(p_act.elevation_gain_m::numeric) end,
    'activity_date', case when 'date' = any (p_fields) then to_char(p_act.started_at at time zone 'UTC', 'YYYY-MM-DD') end));
  if 'land' = any (p_fields) then
    select * into v_claim from public.loop_claims where activity_id = p_act.id and status = 'eligible';
    if found then
      v_summary := v_summary || jsonb_build_object('achievement', 'land_claimed', 'area_m2', round(v_claim.eligible_area_m2::numeric, -2));
      v_publish := greatest(v_publish, v_claim.publish_after);
      v_land := internal.share_land(p_act.id);
      if v_land is not null then v_publish := greatest(v_publish, (v_land ->> 'publish_after')::timestamptz); end if;
    end if;
  end if;
  if 'title' = any (p_fields) then
    select sa.* into v_attempt from public.speed_attempts sa
      join internal.speed_titles t on t.benchmark_attempt_id = sa.id
     where sa.activity_id = p_act.id and sa.status = 'eligible' limit 1;
    if found then
      v_summary := v_summary || jsonb_build_object('achievement_title', 'route_title');
      v_publish := greatest(v_publish, v_attempt.publish_after);
    end if;
  end if;
  if 'route' = any (p_fields) then
    v_route := internal.share_route(p_act.id, p_act.user_id);
    -- A route reveals where the run went: never sooner than the run's results would publish.
    if v_route is not null then v_publish := greatest(v_publish, coalesce(p_act.ended_at, now()) + make_interval(mins => greatest(15, internal.config_int('share_publish_delay_minutes', 30)))); end if;
  end if;
  if v_summary = '{}'::jsonb then v_summary := null; end if;
  -- Absent parts are left out (SQL null when read back), never stored as JSON null.
  return jsonb_strip_nulls(jsonb_build_object('summary', v_summary, 'route', v_route, 'land', v_land, 'publish_after', v_publish));
end $function$;

CREATE OR REPLACE FUNCTION internal.evaluate_claim_geometry(p_claim uuid, p_ring jsonb, p_candidate_cells bigint[])
 RETURNS loop_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal', 'extensions'
AS $function$
declare
  v_claim public.loop_claims;
  v_season public.seasons;
  v_region public.regions;
  v_poly geometry;
  v_inner geometry;
  v_reasons text[] := '{}';
  v_status text;
  v_count integer := 0;
  v_area double precision := 0;
begin
  select * into v_claim from public.loop_claims where id = p_claim for update;
  if not found then raise exception 'claim % not found', p_claim; end if;
  if v_claim.status not in ('processing') then return v_claim; end if; -- idempotent re-delivery

  select s.* into v_season from public.seasons s where s.id = v_claim.season_id;
  select r.* into v_region from public.regions r join public.competitions c on c.region_id = r.id where c.id = v_claim.competition_id;

  begin
    v_poly := internal.ring_to_polygon(p_ring);
  exception when others then
    v_poly := null;
  end;

  if v_poly is null or not st_isvalid(v_poly) or not st_issimple(st_exteriorring(v_poly)) then
    v_reasons := array_append(v_reasons, 'invalid_geometry');
  else
    if not internal.config_bool('territory_capture_enabled') then v_reasons := array_append(v_reasons, 'capture_suspended'); end if;
    if v_region.status <> 'active' then v_reasons := array_append(v_reasons, 'region_suspended'); end if;
    -- Fail closed: no reviewed exclusion set means eligibility is unknown (no land awarded).
    if v_region.exclusion_review_status <> 'reviewed' or v_season.exclusion_set_version is null then
      v_reasons := array_append(v_reasons, 'eligibility_data_unavailable');
    end if;
    if not st_coveredby(v_poly, v_region.geom::geometry) then v_reasons := array_append(v_reasons, 'outside_region'); end if;
    if st_area(v_poly::geography) > 25000000 then v_reasons := array_append(v_reasons, 'area_too_large'); end if;
    -- Privacy veto: any intersection of the loop or its interior withholds the whole shared claim.
    if exists (select 1 from public.protected_areas pa where pa.user_id = v_claim.user_id and st_intersects(pa.geom, v_poly::geography)) then
      v_reasons := array_append(v_reasons, 'privacy_mask');
    end if;
  end if;

  if array_length(v_reasons, 1) is null then
    v_inner := st_buffer(v_poly::geography, -v_season.boundary_band_m)::geometry;
    if v_inner is not null and not st_isempty(v_inner) then
      insert into internal.claim_cells (claim_id, cell)
      select p_claim, tc.cell
        from internal.territory_cells tc
       where tc.cell = any (p_candidate_cells)
         and tc.resolution = v_season.grid_resolution
         and st_coveredby(tc.geom, v_inner)
         and not exists (
           select 1 from public.exclusion_zones ez
            where ez.region_id = v_region.id and ez.active
              and (ez.set_version = v_season.exclusion_set_version or ez.kind = 'safety_override')
              and st_intersects(ez.geom, tc.geom::geography))
         -- cells already excluded by an audited safety override in this season stay unavailable
         and not exists (
           select 1 from internal.cell_control x
            where x.competition_id = v_claim.competition_id and x.season_id = v_claim.season_id and x.cell = tc.cell and x.status = 'excluded')
      on conflict do nothing;
      select count(*), coalesce(sum(tc.area_m2), 0) into v_count, v_area
        from internal.claim_cells cc join internal.territory_cells tc on tc.cell = cc.cell where cc.claim_id = p_claim;
    end if;
    if v_count < 1 then v_reasons := array_append(v_reasons, 'no_eligible_cells'); end if;
  end if;

  v_status := case
    when 'privacy_mask' = any (v_reasons) then 'withheld_privacy'
    when array_length(v_reasons, 1) is null then 'eligible'
    else 'unranked' end;

  if v_status <> 'eligible' then delete from internal.claim_cells where claim_id = p_claim; v_count := 0; v_area := 0; end if;

  update public.loop_claims
     set status = v_status,
         reasons = v_reasons,
         polygon = v_poly,
         raw_area_m2 = case when v_poly is null then null else st_area(v_poly::geography) end,
         eligible_area_m2 = v_area,
         eligible_cell_count = v_count,
         grid_resolution = v_season.grid_resolution,
         boundary_band_m = v_season.boundary_band_m,
         exclusion_set_version = v_season.exclusion_set_version,
         validated_at = now(),
         publish_after = greatest(coalesce(v_claim.completed_at, now()) + make_interval(mins => coalesce((select s.publication_delay_minutes from public.seasons s where s.id = v_claim.season_id), 30)), now())
   where id = p_claim
  returning * into v_claim;
  return v_claim;
end $function$;

CREATE OR REPLACE FUNCTION internal.maintain_seasons()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
declare
  v_comp record;
  v_last public.seasons;
  v_region public.regions;
begin
  perform internal.ensure_permanent_layers();
  update public.seasons set status = 'active' where status = 'scheduled' and starts_at <= now() and ends_at > now();
  update public.seasons set status = 'settling' where status = 'active' and ends_at <= now();
  update public.seasons set status = 'settled', settled_at = now()
   where status = 'settling' and ends_at + make_interval(hours => coalesce(settlement_delay_hours, 24)) <= now()
     and not exists (select 1 from public.integrity_cases ic where ic.status <> 'resolved' and ic.hold_from_competition
                       and ic.object_id in (select coalesce(lc.parent_claim_id, lc.id) from public.loop_claims lc where lc.season_id = seasons.id
                                            union select sa.id from public.speed_attempts sa where sa.season_id = seasons.id));
  for v_comp in select * from public.competitions where status = 'active' and kind in ('public', 'club') loop
    select * into v_last from public.seasons where competition_id = v_comp.id order by number desc limit 1;
    select * into v_region from public.regions where id = v_comp.region_id;
    if v_last.id is null or v_last.ends_at <= now() + interval '3 days' then
      insert into public.seasons (competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m,
                                  territory_rules_version, speed_rules_version, exclusion_set_version)
      values (v_comp.id, coalesce(v_last.number, 0) + 1,
              coalesce(v_last.ends_at, date_trunc('day', now())),
              coalesce(v_last.ends_at, date_trunc('day', now())) + make_interval(days => v_comp.season_length_days),
              case when coalesce(v_last.ends_at, now()) <= now() then 'active' else 'scheduled' end,
              coalesce(v_last.grid_resolution, 11), coalesce(v_last.boundary_band_m, 10),
              coalesce(v_last.territory_rules_version, 'territory-2026.11.0-proposed'),
              coalesce(v_last.speed_rules_version, 'speed-2026.11.0-proposed'),
              case when v_region.exclusion_review_status = 'reviewed' then v_region.exclusion_set_version else null end)
      on conflict do nothing;
    end if;
  end loop;
  perform internal.finish_events();
end $function$;

CREATE OR REPLACE FUNCTION public.create_post(p_audience text, p_body text DEFAULT NULL::text, p_club uuid DEFAULT NULL::uuid, p_activity uuid DEFAULT NULL::uuid, p_share_fields text[] DEFAULT '{}'::text[], p_route_course uuid DEFAULT NULL::uuid, p_comments_enabled boolean DEFAULT true, p_media_count integer DEFAULT 0, p_is_announcement boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal', 'authz'
AS $function$
declare
  v_user uuid := internal.require_user();
  v_post uuid := gen_random_uuid();
  v_summary jsonb;
  v_act public.activities;
  v_publish_after timestamptz := now();
  v_payload jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_handle text;
  i integer;
begin
  perform internal.enforce_rate_limit(v_user::text, 'post', 10, 3600);
  if p_audience not in ('only_me', 'followers', 'public', 'club') then raise exception 'invalid audience'; end if;
  if coalesce(btrim(p_body), '') = '' and p_activity is null and p_media_count = 0 and p_route_course is null then raise exception 'empty post'; end if;
  if p_media_count < 0 or p_media_count > least(10, internal.config_int('post_max_photos', 5)) then raise exception 'at most % photos', least(10, internal.config_int('post_max_photos', 5)) using errcode = '22023'; end if;
  if p_media_count > 0 and not internal.config_bool('photo_uploads_enabled') then raise exception 'photo uploads are temporarily unavailable' using errcode = 'P0503'; end if;
  if p_audience = 'club' then
    if p_club is null or not authz.is_active_member(p_club, v_user) then raise exception 'not a member' using errcode = '42501'; end if;
    if exists (select 1 from public.clubs where id = p_club and posting_policy = 'organizers') and not authz.is_organizer(p_club, v_user) then
      raise exception 'only organizers can post here' using errcode = '42501';
    end if;
  elsif p_club is not null then raise exception 'club given for a non-club audience';
  end if;
  if p_is_announcement and (p_audience <> 'club' or not authz.is_organizer(p_club, v_user)) then raise exception 'only organizers can announce' using errcode = '42501'; end if;

  -- Shared activity fields are copied from the server's own record, never from the client: the route is
  -- trimmed at both ends and outside the runner's private areas, and land comes from the published result.
  if p_activity is not null then
    select * into v_act from public.activities where id = p_activity and user_id = v_user and deleted_at is null;
    if not found then raise exception 'activity not found'; end if;
    v_payload := internal.share_payload(v_act, p_share_fields);
    v_summary := v_payload -> 'summary';
    v_publish_after := greatest(v_publish_after, (v_payload ->> 'publish_after')::timestamptz);
  end if;
  if p_route_course is not null and not exists (select 1 from public.courses where id = p_route_course and status = 'active') then
    raise exception 'route unavailable';
  end if;

  insert into public.posts (id, author_id, audience, club_id, body, activity_id, shared_summary, shared_route, shared_land, route_course_id, comments_enabled, is_announcement, status, publish_after, published_at)
  values (v_post, v_user, p_audience, p_club, nullif(btrim(p_body), ''), p_activity, v_summary, v_payload -> 'route', v_payload -> 'land', p_route_course, p_comments_enabled, p_is_announcement,
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
end $function$;

