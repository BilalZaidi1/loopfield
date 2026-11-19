-- Back office, Phase 0–1 (docs/BACK_OFFICE.md). Database side of the web console in apps/admin:
-- a typed registry and history for app_config, an operator overview, job, staff, user-search, appeal
-- and audit-log RPCs, and an MFA requirement that can be switched on for every ops_* function.
-- Same rules as the existing operator API: every function checks a scoped staff role, every change
-- is audited, and nothing here exposes routes, chats, health data or protected areas.

-- ---------------------------------------------------------------------------------------------
-- New settings
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('ops_require_mfa', 'false', false, 'When true, every ops_* function requires an MFA-verified (aal2) session. Turn on once every staff client prompts for TOTP.'),
  ('maintenance_mode', '{"enabled": false, "message": null, "until": null}', true, 'Blocking maintenance screen in the app while enabled (needs app support).'),
  ('latest_app_version', '{"ios": "0.1.0", "android": "0.1.0"}', true, 'Newest store version per platform; older builds see a soft update prompt (needs app support).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Staff gates
-- ---------------------------------------------------------------------------------------------
create or replace function internal.require_mfa_if_enabled() returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'ops_require_mfa'), false)
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'requires multi-factor authentication' using errcode = '42501';
  end if;
end $$;

-- Unchanged behaviour while ops_require_mfa is false.
create or replace function internal.require_role(p_role text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, authz, internal as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not authz.has_role(v, p_role) then raise exception 'requires % role', p_role using errcode = '42501'; end if;
  perform internal.require_mfa_if_enabled();
  return v;
end $$;

create or replace function internal.require_any_staff() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not exists (select 1 from public.staff_roles s where s.user_id = v and s.revoked_at is null) then
    raise exception 'requires a staff role' using errcode = '42501';
  end if;
  perform internal.require_mfa_if_enabled();
  return v;
end $$;

-- Who the console is talking to. Callable by any signed-in user; roles are empty for non-staff.
create or replace function public.ops_whoami() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'user_id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar_path', p.avatar_path, 'status', p.status,
    'roles', coalesce((select jsonb_agg(s.role order by s.role) from public.staff_roles s where s.user_id = p.id and s.revoked_at is null), '[]'::jsonb),
    'require_mfa', coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'ops_require_mfa'), false))
  from public.profiles p where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------------------------
-- Configuration registry and history
-- ---------------------------------------------------------------------------------------------
create table internal.config_registry (
  key text primary key,
  label text not null,
  category text not null check (category in ('switch', 'tunable', 'release', 'monetization', 'system')),
  value_type text not null check (value_type in ('boolean', 'integer', 'number', 'string', 'string_array', 'version', 'object')),
  min_value numeric,
  max_value numeric,
  -- Allowed values for strings, allowed field names for objects.
  allowed text[],
  min_role text not null default 'admin' check (min_role in ('admin', 'territory_operator')),
  sort smallint not null default 100,
  help text
);

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('territory_capture_enabled', 'Land capture', 'switch', 'boolean', null, null, null, 'territory_operator', 10, 'Off stops new land claims. Private recording keeps working.'),
  ('speed_titles_enabled', 'Speed titles', 'switch', 'boolean', null, null, null, 'territory_operator', 11, 'Off stops new speed titles from being awarded.'),
  ('public_publication_enabled', 'Public results', 'switch', 'boolean', null, null, null, 'territory_operator', 12, 'Off holds competitive results back from maps and rankings.'),
  ('photo_uploads_enabled', 'Photo uploads', 'switch', 'boolean', null, null, null, 'territory_operator', 13, 'Off blocks new photos on posts.'),
  ('messaging_enabled', 'Direct messages', 'switch', 'boolean', null, null, null, 'territory_operator', 14, 'Off pauses direct messaging.'),
  ('reclaim_enabled', 'Reclaim', 'switch', 'boolean', null, null, null, 'territory_operator', 15, 'Off stops spending movement points to reclaim land.'),
  ('disabled_health_cards', 'Suspended health cards', 'switch', 'string_array', null, null, null, 'territory_operator', 16, 'Health dashboard cards hidden because of a known data-quality fault.'),
  ('movement_points_per_km', 'Movement points per km', 'tunable', 'integer', 0, 100, null, 'admin', 20, 'Points earned for each verified kilometre. Applies to runs uploaded after the change.'),
  ('movement_points_daily_cap', 'Daily movement points cap', 'tunable', 'integer', 0, 10000, null, 'admin', 21, 'Most points a runner can earn in one day.'),
  ('reclaim_points_per_1000_m2', 'Reclaim cost (points per 1,000 m²)', 'tunable', 'integer', 1, 1000, null, 'admin', 22, 'Points spent to reclaim each 1,000 m² of land.'),
  ('reclaim_max_cells', 'Most cells per reclaim', 'tunable', 'integer', 1, 5000, null, 'admin', 23, 'Upper limit on cells a single reclaim can restore.'),
  ('contested_min_runners', 'Contested: minimum runners', 'tunable', 'integer', 2, 50, null, 'admin', 24, 'Runners needed in the window before an area counts as contested.'),
  ('contested_window_days', 'Contested: window (days)', 'tunable', 'integer', 1, 90, null, 'admin', 25, 'Days of activity considered when marking an area contested.'),
  ('achievement_tier_points', 'Achievement points per tier', 'tunable', 'object', 0, 1000, array['bronze', 'silver', 'gold', 'platinum'], 'admin', 26, 'Points awarded for completing a challenge at each tier.'),
  ('achievement_category_bonus', 'Category completion bonus', 'tunable', 'integer', 0, 1000, null, 'admin', 27, 'Extra points for completing every challenge in a category.'),
  ('group_max_members', 'Group size limit', 'tunable', 'integer', 2, 10000, null, 'admin', 28, 'Most members a group can hold.'),
  ('share_route_trim_m', 'Shared route privacy trim (m)', 'tunable', 'integer', 100, 2000, null, 'admin', 29, 'Metres hidden at the start and end of shared routes. Lower values reveal more.'),
  ('invite_emails_per_day', 'Club email invites per day', 'tunable', 'integer', 0, 100, null, 'admin', 30, 'Daily limit on club invitations sent by email, per member.'),
  ('integrity_overrides', 'Integrity overrides', 'tunable', 'object', null, null, null, 'admin', 31, 'Raw overrides read by the integrity rules. Change only with a written reason.'),
  ('min_supported_app_version', 'Minimum supported version', 'release', 'version', null, null, null, 'admin', 40, 'Older builds are told to update before uploading runs.'),
  ('latest_app_version', 'Latest store version', 'release', 'object', null, null, array['ios', 'android'], 'admin', 41, 'Older builds see a soft update prompt (needs app support).'),
  ('maintenance_mode', 'Maintenance mode', 'release', 'object', null, null, array['enabled', 'message', 'until'], 'admin', 42, 'Blocks the app behind a maintenance screen with your message (needs app support).'),
  ('paywall_enabled', 'Paywall', 'monetization', 'boolean', null, null, null, 'admin', 50, 'On gates the features listed below behind the premium entitlement.'),
  ('premium_features', 'Premium features', 'monetization', 'string_array', null, null, null, 'admin', 51, 'Feature keys that need premium while the paywall is on. Core features can never be listed.'),
  ('rules_status', 'Rules status', 'system', 'string', null, null, array['proposed', 'validated'], 'admin', 60, 'Whether gameplay thresholds are still proposed defaults or field-validated.'),
  ('ops_require_mfa', 'Require MFA for operator actions', 'system', 'boolean', null, null, null, 'admin', 61, 'When on, every operator action needs an MFA-verified session, including the app''s ops screens.');

create table internal.config_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  actor_id uuid references public.profiles (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index config_history_key_idx on internal.config_history (key, created_at desc);

create or replace function internal.validate_config_value(r internal.config_registry, p_value jsonb) returns void
language plpgsql immutable set search_path = pg_catalog as $$
declare
  k text;
  v jsonb;
  n numeric;
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
  end if;
end $$;

-- All settings with their registry metadata and last change. Readable by any staff member.
create or replace function public.ops_config()
returns table (key text, value jsonb, is_public boolean, description text, updated_at timestamptz,
               label text, category text, value_type text, min_value numeric, max_value numeric, allowed text[],
               min_role text, sort integer, help text, can_edit boolean,
               last_changed_by text, last_reason text, last_changed_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
#variable_conflict use_column
declare
  v uuid := internal.require_any_staff();
begin
  return query
  select c.key, c.value, c.is_public, c.description, c.updated_at,
         coalesce(r.label, c.key), coalesce(r.category, 'other'), coalesce(r.value_type, jsonb_typeof(c.value)),
         r.min_value, r.max_value, r.allowed, coalesce(r.min_role, 'admin'), coalesce(r.sort, 999)::integer, r.help,
         authz.has_role(v, coalesce(r.min_role, 'admin')),
         h.handle, h.reason, h.created_at
    from public.app_config c
    left join internal.config_registry r on r.key = c.key
    left join lateral (
      select p.handle::text as handle, ch.reason, ch.created_at
        from internal.config_history ch left join public.profiles p on p.id = ch.actor_id
       where ch.key = c.key order by ch.created_at desc, ch.id desc limit 1) h on true
   order by coalesce(r.sort, 999), c.key;
end $$;

-- Change one setting. Registered settings are validated against their type and bounds; settings
-- that are not registered yet stay admin-only and must keep their JSON type.
create or replace function public.ops_set_config(p_key text, p_value jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  r internal.config_registry;
  v_actor uuid;
  v_old jsonb;
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  select * into r from internal.config_registry cr where cr.key = p_key;
  v_actor := internal.require_role(coalesce(r.min_role, 'admin'));
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  select c.value into v_old from public.app_config c where c.key = p_key for update;
  if not found then raise exception 'unknown setting %', p_key using errcode = '22023'; end if;
  if r.key is not null then
    perform internal.validate_config_value(r, p_value);
  elsif p_value is null or jsonb_typeof(p_value) <> jsonb_typeof(v_old) then
    raise exception '% is not registered, so it must keep its type (%)', p_key, jsonb_typeof(v_old) using errcode = '22023';
  end if;
  if p_value = v_old then return v_old; end if;
  update public.app_config set value = p_value, updated_at = now() where key = p_key;
  insert into internal.config_history (key, old_value, new_value, actor_id, reason) values (p_key, v_old, p_value, v_actor, v_reason);
  perform internal.audit(v_actor, 'staff', 'config_changed', 'app_config', p_key, jsonb_build_object('old', v_old, 'new', p_value, 'reason', v_reason));
  return p_value;
end $$;

create or replace function public.ops_config_history(p_key text default null, p_limit integer default 50)
returns table (id bigint, key text, old_value jsonb, new_value jsonb, reason text, actor_handle text, created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
#variable_conflict use_column
declare
  v uuid := internal.require_any_staff();
begin
  return query
  select h.id, h.key, h.old_value, h.new_value, h.reason, p.handle::text, h.created_at
    from internal.config_history h left join public.profiles p on p.id = h.actor_id
   where p_key is null or h.key = p_key
   order by h.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- The app's ops screen keeps using ops_set_switch; it now also covers reclaim, checks the value's type
-- and records history so the console shows every change.
create or replace function public.ops_set_switch(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
  v_old jsonb;
begin
  if p_key not in ('territory_capture_enabled', 'speed_titles_enabled', 'public_publication_enabled', 'photo_uploads_enabled',
                   'messaging_enabled', 'reclaim_enabled', 'disabled_health_cards') then
    raise exception 'unknown switch';
  end if;
  select c.value into v_old from public.app_config c where c.key = p_key for update;
  if not found then raise exception 'unknown switch'; end if;
  if (p_key = 'disabled_health_cards' and jsonb_typeof(p_value) is distinct from 'array')
     or (p_key <> 'disabled_health_cards' and jsonb_typeof(p_value) is distinct from 'boolean') then
    raise exception 'invalid value for %', p_key using errcode = '22023';
  end if;
  update public.app_config set value = p_value, updated_at = now() where key = p_key;
  if p_value is distinct from v_old then
    insert into internal.config_history (key, old_value, new_value, actor_id, reason) values (p_key, v_old, p_value, v_actor, 'Changed from the app''s operator screen');
  end if;
  perform internal.audit(v_actor, 'staff', 'switch_changed', 'app_config', p_key, jsonb_build_object('old', v_old, 'value', p_value));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Command Center
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_overview() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_any_staff();
  v_cron jsonb := '[]'::jsonb;
begin
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
      'routes', (select jsonb_build_object('open', count(*), 'oldest', min(rp.created_at)) from public.route_proposals rp where rp.status = 'pending_review'),
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
    'cron', v_cron);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------------------------
-- Requeue dead jobs (optionally one queue). Skips a job when an identical job is already queued or
-- running, and requeues only the newest dead copy of each deduplicated job.
create or replace function public.ops_retry_dead_jobs(p_queue text default null) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('admin');
  v integer;
begin
  with candidates as (
    select distinct on (j.queue, coalesce(j.dedupe_key, j.id::text)) j.id
      from internal.jobs j
     where j.status = 'dead' and (p_queue is null or j.queue = p_queue)
       and (j.dedupe_key is null or not exists (
             select 1 from internal.jobs j2 where j2.queue = j.queue and j2.dedupe_key = j.dedupe_key and j2.status in ('queued', 'running')))
     order by j.queue, coalesce(j.dedupe_key, j.id::text), j.updated_at desc)
  update internal.jobs set status = 'queued', attempts = 0, run_at = now(), locked_by = null, locked_at = null
   where id in (select c.id from candidates c);
  get diagnostics v = row_count;
  perform internal.audit(v_actor, 'staff', 'jobs_retried', 'job_queue', coalesce(p_queue, 'all'), jsonb_build_object('count', v));
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff and user lookup
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_staff_list()
returns table (user_id uuid, handle text, display_name text, status text, roles text[], granted_at timestamptz,
               mfa_enabled boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
#variable_conflict use_column
declare
  v uuid := internal.require_role('admin');
begin
  return query
  select p.id, p.handle::text, p.display_name, p.status, array_agg(s.role order by s.role), min(s.granted_at),
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
         (select u.last_sign_in_at from auth.users u where u.id = p.id)
    from public.staff_roles s join public.profiles p on p.id = s.user_id
   where s.revoked_at is null
   group by p.id
   order by p.handle;
end $$;

-- Find runners by handle, name, user ID or exact email. Email lookups are audited; addresses are
-- never returned.
create or replace function public.ops_users_search(p_query text, p_limit integer default 20)
returns table (user_id uuid, handle text, display_name text, status text, city_label text, created_at timestamptz,
               roles text[], matched_by text)
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
#variable_conflict use_column
declare
  v_actor uuid := internal.require_role('support');
  q text := btrim(coalesce(p_query, ''));
  v_pattern text;
  v_id uuid;
  v_by text := 'name';
begin
  if char_length(q) < 2 then return; end if;
  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := q::uuid; v_by := 'id';
  elsif position('@' in q) > 1 then
    select u.id into v_id from auth.users u where lower(u.email) = lower(q) limit 1;
    v_by := 'email';
    perform internal.audit(v_actor, 'staff', 'user_email_lookup', 'profile', coalesce(v_id::text, 'none'), jsonb_build_object('found', v_id is not null));
  end if;
  if v_by in ('id', 'email') then
    return query
    select p.id, p.handle::text, p.display_name, p.status, p.city_label, p.created_at,
           array(select s.role from public.staff_roles s where s.user_id = p.id and s.revoked_at is null order by s.role), v_by
      from public.profiles p where p.id = v_id;
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.handle::text, p.display_name, p.status, p.city_label, p.created_at,
         array(select s.role from public.staff_roles s where s.user_id = p.id and s.revoked_at is null order by s.role),
         case when p.handle::text ilike v_pattern then 'handle' else 'name' end
    from public.profiles p
   where p.status <> 'deleted' and (p.handle::text ilike v_pattern or p.display_name ilike v_pattern)
   order by (lower(p.handle::text) = lower(q)) desc, p.handle
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Appeals
-- ---------------------------------------------------------------------------------------------
-- Content and account appeals go to moderators; competitive appeals go to integrity reviewers and are
-- decided through the linked integrity case.
create or replace function public.ops_appeals_queue(p_status text default 'open', p_limit integer default 100)
returns table (id uuid, track text, object_type text, object_id uuid, reason text, status text, response text,
               created_at timestamptz, decided_at timestamptz, user_id uuid, user_handle text, integrity_case_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
#variable_conflict use_column
declare
  v uuid := internal.require_any_staff();
  v_mod boolean := authz.has_role(v, 'moderator');
  v_int boolean := authz.has_role(v, 'integrity_reviewer');
begin
  if not (v_mod or v_int) then raise exception 'requires moderator or integrity_reviewer role' using errcode = '42501'; end if;
  return query
  select a.id, case when a.object_type in ('loop_claim', 'speed_attempt') then 'competitive' else 'content' end,
         a.object_type, a.object_id, a.reason, a.status, a.response, a.created_at, a.decided_at, a.user_id, p.handle::text,
         (select ic.id from public.integrity_cases ic where ic.object_id = a.object_id order by ic.created_at desc limit 1)
    from public.appeals a left join public.profiles p on p.id = a.user_id
   where (case when coalesce(p_status, 'open') = 'open' then a.status in ('submitted', 'in_review')
               else a.status in ('upheld', 'overturned', 'withdrawn') end)
     and ((v_mod and a.object_type in ('post', 'comment', 'moderation_case', 'route_proposal', 'account_action'))
       or (v_int and a.object_type in ('loop_claim', 'speed_attempt')))
   order by a.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- Appeals against an account action (e.g. a suspension) had no decision path; overturning reinstates.
create or replace function public.ops_decide_account_appeal(p_appeal uuid, p_overturn boolean, p_response text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('moderator');
  a public.appeals;
  v_response text := left(btrim(coalesce(p_response, '')), 2000);
begin
  if char_length(v_response) < 5 then raise exception 'write a response of at least 5 characters' using errcode = '22023'; end if;
  select * into a from public.appeals ap where ap.id = p_appeal for update;
  if not found or a.status not in ('submitted', 'in_review') or a.object_type <> 'account_action' then raise exception 'not a pending account appeal'; end if;
  if p_overturn then
    update public.profiles set status = 'active' where id = a.user_id and status = 'suspended';
  end if;
  update public.appeals set status = case when p_overturn then 'overturned' else 'upheld' end, response = v_response, decided_by = v_actor, decided_at = now()
   where id = p_appeal;
  perform internal.notify(a.user_id, 'system', 'appeal_decided', null, 'appeal', p_appeal::text, jsonb_build_object('overturned', p_overturn), 'appeal:' || p_appeal);
  perform internal.audit(v_actor, 'staff', 'appeal_' || case when p_overturn then 'overturned' else 'upheld' end, 'account_action', a.object_id::text, jsonb_build_object('appeal', p_appeal));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_audit_log(p_actor uuid default null, p_action text default null, p_object_type text default null,
                                                p_object_id text default null, p_from timestamptz default null, p_to timestamptz default null,
                                                p_before bigint default null, p_limit integer default 50)
returns table (id bigint, created_at timestamptz, actor_id uuid, actor_handle text, actor_kind text, action text,
               object_type text, object_id text, details jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
#variable_conflict use_column
declare
  v uuid := internal.require_role('admin');
begin
  return query
  select a.id, a.created_at, a.actor_id, p.handle::text, a.actor_kind, a.action, a.object_type, a.object_id, a.details
    from internal.audit_log a left join public.profiles p on p.id = a.actor_id
   where (p_actor is null or a.actor_id = p_actor)
     and (p_action is null or a.action like replace(replace(p_action, '%', ''), '_', '\_') || '%')
     and (p_object_type is null or a.object_type = p_object_type)
     and (p_object_id is null or a.object_id = p_object_id)
     and (p_from is null or a.created_at >= p_from)
     and (p_to is null or a.created_at < p_to)
     and (p_before is null or a.id < p_before)
   order by a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: callable by signed-in users (each checks its own role); internal helpers stay closed.
-- ---------------------------------------------------------------------------------------------
revoke execute on function internal.require_mfa_if_enabled(), internal.require_any_staff(),
  internal.validate_config_value(internal.config_registry, jsonb) from public, anon, authenticated;
grant execute on function internal.require_mfa_if_enabled(), internal.require_any_staff(),
  internal.validate_config_value(internal.config_registry, jsonb) to service_role;

revoke execute on function public.ops_whoami(), public.ops_config(), public.ops_set_config(text, jsonb, text),
  public.ops_config_history(text, integer), public.ops_overview(), public.ops_retry_dead_jobs(text), public.ops_staff_list(),
  public.ops_users_search(text, integer), public.ops_appeals_queue(text, integer), public.ops_decide_account_appeal(uuid, boolean, text),
  public.ops_audit_log(uuid, text, text, text, timestamptz, timestamptz, bigint, integer) from public, anon;
grant execute on function public.ops_whoami(), public.ops_config(), public.ops_set_config(text, jsonb, text),
  public.ops_config_history(text, integer), public.ops_overview(), public.ops_retry_dead_jobs(text), public.ops_staff_list(),
  public.ops_users_search(text, integer), public.ops_appeals_queue(text, integer), public.ops_decide_account_appeal(uuid, boolean, text),
  public.ops_audit_log(uuid, text, text, text, timestamptz, timestamptz, bigint, integer) to authenticated, service_role;
