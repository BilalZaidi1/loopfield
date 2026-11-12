-- Back office: read-only SQL editor.
--
-- Queries run as loopfield_sql_reader, a role that can read only the curated views in the ops_sql schema.
-- Those views leave out routes, places, notes, message bodies, health data, privacy zones, emails and
-- push tokens. Each query runs in a read-only subtransaction that is always rolled back, is capped at
-- 1,000 rows and the request's statement timeout, needs an MFA-verified session and the sql permission,
-- and is written to the audit log with its text, row count and duration.

create schema if not exists ops_sql;
create schema if not exists ops_sql_exec;
revoke all on schema ops_sql from public;
revoke all on schema ops_sql_exec from public;

create or replace view ops_sql.runners as
  select id, handle, display_name, status, visibility, discoverable, district_id, city_label, avatar_kind, created_at, updated_at, onboarding_completed_at
    from public.profiles;
create or replace view ops_sql.runs as
  select id, user_id, competition_id, season_id, course_version_id, started_at, ended_at, status, distance_m, elapsed_ms, moving_ms, paused_ms,
         avg_pace_s_per_km, elevation_gain_m, sample_count, usable_sample_count, summary_source, perceived_effort, integrity_flags,
         integrity_excluded_m, integrity_cleared_at, received_at, created_at, deleted_at
    from public.activities;
create or replace view ops_sql.loop_claims as
  select id, activity_id, user_id, competition_id, season_id, status, reasons, rule_version, algorithm_version, grid_resolution, boundary_band_m,
         completed_at, received_at, validated_at, publish_after, published_at, raw_area_m2, eligible_area_m2, eligible_cell_count, length_m,
         invalidated_at, invalidation_reason, created_at, source, points_spent, parent_claim_id
    from public.loop_claims;
create or replace view ops_sql.seasons as
  select id, competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m, territory_rules_version, speed_rules_version,
         late_upload_hours, publication_delay_minutes, settlement_delay_hours, settled_at, created_at
    from public.seasons;
create or replace view ops_sql.competitions as
  select id, kind, region_id, club_id, name, status, event_type, team_mode, visibility, starts_at, ends_at, target_m, season_length_days,
         created_by, host_club_id, created_at, archived_at, cancelled_at
    from public.competitions;
create or replace view ops_sql.clubs as
  select id, kind, name, visibility, join_policy, posting_policy, region_id, district_id, city_label, created_by, status, created_at, deleted_at
    from public.clubs;
create or replace view ops_sql.club_memberships as select club_id, user_id, role, state, created_at, updated_at from public.club_memberships;
create or replace view ops_sql.follows as select follower_id, followee_id, state, created_at, accepted_at from public.follows;
create or replace view ops_sql.posts as
  select id, author_id, audience, club_id, activity_id is not null as has_run, route_course_id, comments_enabled, is_announcement, status,
         char_length(body) as body_chars, created_at, published_at, edited_at
    from public.posts;
create or replace view ops_sql.comments as select id, post_id, author_id, status, char_length(body) as body_chars, created_at from public.comments;
create or replace view ops_sql.reports as select id, reporter_id, object_type, object_id, category, case_id, status, created_at from public.reports;
create or replace view ops_sql.moderation_cases as
  select id, object_type, object_id, subject_user_id, priority, status, assigned_to, report_count, outcome, created_at, resolved_at
    from public.moderation_cases;
create or replace view ops_sql.integrity_cases as
  select id, kind, object_id, subject_user_id, status, resolution, hold_from_competition, assigned_to, created_at, resolved_at
    from public.integrity_cases;
create or replace view ops_sql.appeals as select id, user_id, object_type, object_id, status, decided_by, created_at, decided_at from public.appeals;
create or replace view ops_sql.route_proposals as
  select id, creator_id, region_id, name, closed, length_m, status, canonical_course_id, reviewed_by, decided_at, created_at
    from public.route_proposals;
create or replace view ops_sql.notifications as
  select id, user_id, category, kind, object_type, read_at is not null as read, push_state, created_at from public.notifications;
create or replace view ops_sql.push_tokens as select id, user_id, platform, created_at, last_seen_at, disabled_at from public.push_tokens;
create or replace view ops_sql.entitlements as
  select user_id, entitlement, is_active, status, product_id, store, period_type, environment, expires_at, will_renew, source, updated_at
    from public.entitlements;
create or replace view ops_sql.consents as select id, user_id, kind, version, granted, created_at from public.consents;
create or replace view ops_sql.data_exports as select id, user_id, status, created_at, completed_at, expires_at from public.data_exports;
create or replace view ops_sql.deletion_requests as select id, user_id, status, requested_at, completed_at from public.deletion_requests;
create or replace view ops_sql.support_tickets as
  select id, user_id, category, status, priority, assigned_to, platform, app_version, first_response_at, solved_at, last_message_at, created_at
    from public.support_tickets;
create or replace view ops_sql.challenges as select id, category, tier, title, metric, target, unit, sort, active from public.challenges;
create or replace view ops_sql.event_participants as select competition_id, user_id, club_id, joined_at, left_at from public.event_participants;
create or replace view ops_sql.movement_ledger as
  select id, user_id, kind, amount, activity_id, claim_id, verified_distance_m, earned_on, rule_version, created_at from internal.movement_ledger;
create or replace view ops_sql.jobs as
  select id, queue, kind, status, attempts, max_attempts, run_at, last_error, created_at, updated_at, finished_at from internal.jobs;
create or replace view ops_sql.audit_log as select id, actor_id, actor_kind, action, object_type, object_id, created_at from internal.audit_log;
create or replace view ops_sql.app_config as select key, value, is_public, updated_at from public.app_config;
create or replace view ops_sql.config_history as select id, key, old_value, new_value, actor_id, reason, created_at from internal.config_history;
create or replace view ops_sql.staff_roles as select user_id, role, granted_by, granted_at, revoked_at from public.staff_roles;
create or replace view ops_sql.metrics_daily as select day, metric, value from internal.metrics_daily;
create or replace view ops_sql.email_outbox as select user_id, template, status, reason, created_at, sent_at from internal.email_outbox;
create or replace view ops_sql.billing_events as select type, environment, status, received_at, processed_at from internal.billing_events;

comment on view ops_sql.runners is 'Runner profiles. No email, photos or bio.';
comment on view ops_sql.runs is 'Runs (activities). No route, notes, splits or device details.';
comment on view ops_sql.loop_claims is 'Loop claims and their outcome. No polygon.';
comment on view ops_sql.seasons is 'Seasons with their pinned rule versions and timings.';
comment on view ops_sql.competitions is 'The main map, club races and events.';
comment on view ops_sql.clubs is 'Clubs and communities.';
comment on view ops_sql.club_memberships is 'Who is in which club.';
comment on view ops_sql.follows is 'Follow relationships.';
comment on view ops_sql.posts is 'Posts without their text (body_chars is the length).';
comment on view ops_sql.comments is 'Comments without their text.';
comment on view ops_sql.reports is 'Reports without the reporter''s details.';
comment on view ops_sql.moderation_cases is 'Moderation cases.';
comment on view ops_sql.integrity_cases is 'Integrity cases without reviewer notes.';
comment on view ops_sql.appeals is 'Appeals without their text.';
comment on view ops_sql.route_proposals is 'Route proposals without geometry.';
comment on view ops_sql.notifications is 'Notifications without their data.';
comment on view ops_sql.push_tokens is 'Devices registered for push. No tokens.';
comment on view ops_sql.entitlements is 'Premium entitlements.';
comment on view ops_sql.consents is 'Consent records.';
comment on view ops_sql.data_exports is 'Data export requests.';
comment on view ops_sql.deletion_requests is 'Account deletion requests.';
comment on view ops_sql.support_tickets is 'Support conversations without subjects or messages.';
comment on view ops_sql.challenges is 'Challenge catalog.';
comment on view ops_sql.event_participants is 'Event participation.';
comment on view ops_sql.movement_ledger is 'Movement points earned and spent.';
comment on view ops_sql.jobs is 'Background jobs without payloads.';
comment on view ops_sql.audit_log is 'Audit log without details.';
comment on view ops_sql.app_config is 'Settings.';
comment on view ops_sql.config_history is 'Settings changes.';
comment on view ops_sql.staff_roles is 'Staff role grants.';
comment on view ops_sql.metrics_daily is 'Daily metrics used by Analytics.';
comment on view ops_sql.email_outbox is 'Emails without addresses or content.';
comment on view ops_sql.billing_events is 'Store billing events without payloads.';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'loopfield_sql_reader') then
    create role loopfield_sql_reader nologin noinherit;
  end if;
end $$;

revoke all on all tables in schema ops_sql from public, anon, authenticated;
grant usage on schema ops_sql to loopfield_sql_reader;
grant select on all tables in schema ops_sql to loopfield_sql_reader;
grant usage, create on schema ops_sql_exec to loopfield_sql_reader;
grant loopfield_sql_reader to current_user with set true, inherit false;

-- Runs one query as loopfield_sql_reader inside a read-only subtransaction that is always rolled back.
-- Columns keep their order (and duplicates) because rows are returned as arrays.
create or replace function ops_sql_exec.run_readonly(p_sql text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = ops_sql, pg_catalog as $$
declare
  v_cols json;
  v_rows json;
  v_err text;
  v_state text;
  v_hint text;
  v_count integer := 0;
begin
  begin
    perform set_config('transaction_read_only', 'on', true);
    execute format(E'with q as materialized (select * from (\n%s\n) _q limit %s)\n'
                   'select (select json_agg(e.key) from json_each((select row_to_json(q) from q limit 1)) e),\n'
                   '       (select json_agg((select json_agg(e.value) from json_each(row_to_json(q)) e)) from q)', p_sql, p_limit + 1)
      into v_cols, v_rows;
    raise exception using errcode = 'LF000', message = 'rollback';
  exception
    when sqlstate 'LF000' then null;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
  end;
  if v_err is not null then
    return jsonb_build_object('error', v_err, 'sqlstate', v_state, 'hint', v_hint, 'columns', '[]'::jsonb, 'rows', '[]'::jsonb, 'row_count', 0, 'truncated', false);
  end if;
  v_count := coalesce(json_array_length(v_rows), 0);
  return jsonb_build_object(
    'columns', coalesce(v_cols::jsonb, '[]'::jsonb),
    'rows', case when v_count > p_limit then (select jsonb_agg(r order by i) from json_array_elements(v_rows) with ordinality t(r, i) where i <= p_limit)
                 else coalesce(v_rows::jsonb, '[]'::jsonb) end,
    'row_count', least(v_count, p_limit),
    'truncated', v_count > p_limit);
end $$;

alter function ops_sql_exec.run_readonly(text, integer) owner to loopfield_sql_reader;
revoke all on function ops_sql_exec.run_readonly(text, integer) from public;

create or replace function public.ops_sql_run(p_sql text, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('sql');
  v_sql text := btrim(coalesce(p_sql, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_t0 timestamptz := clock_timestamp();
  r jsonb;
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'the SQL editor needs an MFA-verified session' using errcode = '42501';
  end if;
  v_sql := btrim(regexp_replace(v_sql, ';\s*$', ''));
  if v_sql = '' then raise exception 'write a query' using errcode = '22023'; end if;
  if char_length(v_sql) > 20000 then raise exception 'queries can be at most 20,000 characters' using errcode = '22023'; end if;
  r := ops_sql_exec.run_readonly(v_sql, v_limit);
  r := r || jsonb_build_object('ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000), 'limit', v_limit);
  perform internal.audit(v, 'staff', 'sql_query', 'sql', null,
                         jsonb_build_object('sql', left(v_sql, 4000), 'rows', r -> 'row_count', 'ms', r -> 'ms', 'error', r -> 'error'));
  return r;
end $$;

create or replace function public.ops_sql_catalog() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('sql');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', c.relname, 'comment', obj_description(c.oid, 'pg_class'),
             'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                           from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
           order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ops_sql' and c.relkind in ('v', 'm')), '[]'::jsonb);
end $$;

create table internal.saved_queries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sql text not null check (char_length(sql) between 1 and 20000),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.ops_sql_saved() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('sql');
begin
  return jsonb_build_object(
    'queries', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'sql', q.sql, 'shared', q.shared, 'mine', q.owner_id = v,
                     'owner', p.handle, 'updated_at', q.updated_at) order by (q.owner_id <> v), q.name)
                   from internal.saved_queries q left join public.profiles p on p.id = q.owner_id
                  where q.owner_id = v or q.shared), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('sql', a.details ->> 'sql', 'rows', a.details -> 'rows', 'ms', a.details -> 'ms',
                     'error', a.details ->> 'error', 'at', a.created_at) order by a.created_at desc)
                   from (select * from internal.audit_log where actor_id = v and action = 'sql_query' order by created_at desc limit 25) a), '[]'::jsonb));
end $$;

create or replace function public.ops_sql_save(p_id uuid, p_name text, p_sql text, p_shared boolean default false) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('sql');
  v_id uuid;
begin
  if p_id is null then
    insert into internal.saved_queries (owner_id, name, sql, shared) values (v, btrim(p_name), p_sql, coalesce(p_shared, false)) returning id into v_id;
  else
    update internal.saved_queries set name = btrim(p_name), sql = p_sql, shared = coalesce(p_shared, false), updated_at = now()
     where id = p_id and owner_id = v returning id into v_id;
    if v_id is null then raise exception 'saved query not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.ops_sql_delete(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_role('sql');
begin
  delete from internal.saved_queries where id = p_id and (owner_id = v or authz.has_role(v, 'admin'));
  if not found then raise exception 'saved query not found' using errcode = 'P0002'; end if;
end $$;

grant execute on function public.ops_sql_run(text, integer) to authenticated;
grant execute on function public.ops_sql_catalog() to authenticated;
grant execute on function public.ops_sql_saved() to authenticated;
grant execute on function public.ops_sql_save(uuid, text, text, boolean) to authenticated;
grant execute on function public.ops_sql_delete(uuid) to authenticated;
revoke all on function public.ops_sql_run(text, integer) from anon;
revoke all on function public.ops_sql_catalog() from anon;
revoke all on function public.ops_sql_saved() from anon;
revoke all on function public.ops_sql_save(uuid, text, text, boolean) from anon;
revoke all on function public.ops_sql_delete(uuid) from anon;
