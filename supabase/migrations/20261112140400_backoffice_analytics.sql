-- Back office: daily metrics, analytics reads and per-staff preferences (the Overview layout).
--
-- Metrics are counted per day in the reporting time zone (App control → System) into
-- internal.metrics_daily, refreshed hourly and on demand, so analytics pages never scan the big tables
-- on every load. Only counts and sums are stored: no per-runner data.

insert into public.app_config (key, value, is_public, description)
values ('analytics_time_zone', '"Asia/Karachi"', false, 'Time zone that analytics days are counted in.')
on conflict (key) do nothing;
insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help)
values ('analytics_time_zone', 'Reporting time zone', 'system', 'string', null, null, null, 'config', 62,
        'Analytics days start at midnight in this time zone, for example Asia/Karachi or UTC.')
on conflict (key) do nothing;

create or replace function internal.analytics_tz() returns text
language sql stable set search_path = pg_catalog, public as $$
  select coalesce((select value #>> '{}' from public.app_config where key = 'analytics_time_zone'), 'UTC');
$$;

create table internal.metrics_daily (
  day date not null,
  metric text not null,
  value double precision not null,
  primary key (day, metric)
);

create table internal.metrics_meta (
  id boolean primary key default true check (id),
  refreshed_at timestamptz not null default 'epoch'
);
insert into internal.metrics_meta (id) values (true) on conflict do nothing;

create or replace function internal.refresh_metrics(p_from date, p_to date) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  tz text := internal.analytics_tz();
  t0 timestamptz := (p_from::timestamp at time zone tz);
  t1 timestamptz := ((p_to + 1)::timestamp at time zone tz);
begin
  delete from internal.metrics_daily where day between p_from and p_to;
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
  ) x where d between p_from and p_to;
  update internal.metrics_meta set refreshed_at = now();
end $$;
revoke all on function internal.refresh_metrics(date, date) from public;

-- The metric catalog the console shows (labels, units and how to total a range).
create or replace function internal.metric_catalog() returns jsonb
language sql immutable as $$
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
    {"key":"jobs_dead","label":"Jobs that failed","unit":"jobs","agg":"sum","group":"Platform"}
  ]'::jsonb;
$$;

create or replace function internal.period_active_runners(p_from date, p_to date) returns integer
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select count(distinct user_id)::integer from public.activities
   where started_at >= (p_from::timestamp at time zone internal.analytics_tz())
     and started_at < ((p_to + 1)::timestamp at time zone internal.analytics_tz())
     and deleted_at is null and status not in ('failed', 'deleted');
$$;

-- Daily series for every metric between two dates (inclusive), with totals for the range and for
-- the same number of days before it. Today's numbers are refreshed if they are older than 10 minutes.
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
  if (select refreshed_at from internal.metrics_meta) < now() - interval '10 minutes' then
    perform internal.refresh_metrics(v_today - 1, v_today);
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
                        when 'distinct' then internal.period_active_runners(v_from, v_to)
                        else coalesce((select sum(value) from internal.metrics_daily where metric = c.k and day between v_from and v_to), 0) end cur,
             case c.agg when 'median' then (select avg(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto)
                        when 'distinct' then internal.period_active_runners(v_pfrom, v_pto)
                        else coalesce((select sum(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto), 0) end prev
        from cat c
    )
    select jsonb_build_object(
      'time_zone', tz, 'from', v_from, 'to', v_to, 'previous_from', v_pfrom, 'previous_to', v_pto,
      'refreshed_at', (select refreshed_at from internal.metrics_meta),
      'catalog', internal.metric_catalog(),
      'days', (select jsonb_agg(d order by d) from days),
      'series', (select jsonb_object_agg(k, vals) from series),
      'totals', (select jsonb_object_agg(k, cur) from tot),
      'previous', (select jsonb_object_agg(k, prev) from tot))
  );
end $$;

-- Breakdowns for the Analytics screen.
create or replace function public.ops_analytics_breakdowns(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('analytics');
  tz text := internal.analytics_tz();
  t0 timestamptz := (p_from::timestamp at time zone internal.analytics_tz());
  t1 timestamptz := ((p_to + 1)::timestamp at time zone internal.analytics_tz());
begin
  return jsonb_build_object(
    'loop_outcomes', coalesce((select jsonb_agg(jsonb_build_object('key', status, 'value', n) order by n desc) from (
        select status, count(*) n from public.loop_claims where created_at >= t0 and created_at < t1 and parent_claim_id is null group by status) x), '[]'::jsonb),
    'rejection_reasons', coalesce((select jsonb_agg(jsonb_build_object('key', r, 'value', n) order by n desc) from (
        select r, count(*) n from public.loop_claims lc, unnest(lc.reasons) r
         where lc.created_at >= t0 and lc.created_at < t1 and lc.parent_claim_id is null and lc.status in ('unranked', 'invalid')
         group by r order by n desc limit 12) x), '[]'::jsonb),
    'distance_buckets', (select jsonb_agg(jsonb_build_object('key', b.label, 'value', coalesce(x.n, 0)) order by b.ord) from (values
        (1, 'Under 1 km', 0, 1000), (2, '1–3 km', 1000, 3000), (3, '3–5 km', 3000, 5000), (4, '5–10 km', 5000, 10000),
        (5, '10–21 km', 10000, 21097), (6, '21 km+', 21097, 1e9)) b(ord, label, lo, hi)
        left join lateral (select count(*) n from public.activities a where a.started_at >= t0 and a.started_at < t1 and a.deleted_at is null
                            and a.status not in ('failed', 'deleted') and a.distance_m >= b.lo and a.distance_m < b.hi) x on true),
    'hour_of_day', (select jsonb_agg(coalesce(x.n, 0) order by h) from generate_series(0, 23) h
        left join (select extract(hour from started_at at time zone tz)::int hr, count(*) n from public.activities
                    where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1) x on x.hr = h),
    'weekday', (select jsonb_agg(coalesce(x.n, 0) order by wd) from generate_series(1, 7) wd
        left join (select extract(isodow from started_at at time zone tz)::int dw, count(*) n from public.activities
                    where started_at >= t0 and started_at < t1 and deleted_at is null and status not in ('failed', 'deleted') group by 1) x on x.dw = wd),
    'top_districts', coalesce((select jsonb_agg(jsonb_build_object('key', name, 'value', n) order by n desc) from (
        select coalesce(d.name, p.city_label, 'Not set') name, count(*) n
          from public.activities a join public.profiles p on p.id = a.user_id left join public.districts d on d.id = p.district_id
         where a.started_at >= t0 and a.started_at < t1 and a.deleted_at is null and a.status not in ('failed', 'deleted')
         group by 1 order by n desc limit 10) x), '[]'::jsonb),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('key', platform, 'value', n) order by n desc) from (
        select platform, count(distinct user_id) n from public.push_tokens where disabled_at is null group by platform) x), '[]'::jsonb),
    'support_categories', coalesce((select jsonb_agg(jsonb_build_object('key', category, 'value', n) order by n desc) from (
        select category, count(*) n from public.support_tickets where created_at >= t0 and created_at < t1 group by category) x), '[]'::jsonb),
    'report_categories', coalesce((select jsonb_agg(jsonb_build_object('key', category, 'value', n) order by n desc) from (
        select category, count(*) n from public.reports where created_at >= t0 and created_at < t1 group by category) x), '[]'::jsonb));
end $$;

-- Of the runners who signed up in the range: how many finished onboarding, ran, claimed land and came back.
create or replace function public.ops_analytics_funnel(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('analytics');
  t0 timestamptz := (p_from::timestamp at time zone internal.analytics_tz());
  t1 timestamptz := ((p_to + 1)::timestamp at time zone internal.analytics_tz());
begin
  return (
    with c as (select id, created_at, onboarding_completed_at from public.profiles where created_at >= t0 and created_at < t1)
    select jsonb_build_array(
      jsonb_build_object('key', 'Signed up', 'value', (select count(*) from c)),
      jsonb_build_object('key', 'Finished onboarding', 'value', (select count(*) from c where onboarding_completed_at is not null)),
      jsonb_build_object('key', 'Recorded a run', 'value', (select count(*) from c where exists (
          select 1 from public.activities a where a.user_id = c.id and a.deleted_at is null and a.status not in ('failed', 'deleted')))),
      jsonb_build_object('key', 'Claimed land', 'value', (select count(*) from c where exists (
          select 1 from public.loop_claims lc where lc.user_id = c.id and lc.status = 'eligible'))),
      jsonb_build_object('key', 'Ran again in week 2', 'value', (select count(*) from c where exists (
          select 1 from public.activities a where a.user_id = c.id and a.deleted_at is null and a.status not in ('failed', 'deleted')
             and a.started_at >= c.created_at + interval '7 days' and a.started_at < c.created_at + interval '14 days'))))
  );
end $$;

-- Weekly sign-up cohorts and the share of each that ran in each following week.
create or replace function public.ops_analytics_retention(p_weeks integer default 8) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('analytics');
  tz text := internal.analytics_tz();
  w integer := least(greatest(coalesce(p_weeks, 8), 2), 16);
  v_start date := date_trunc('week', (now() at time zone tz))::date - (w - 1) * 7;
begin
  return coalesce((
    with cohort as (
      select p.id, date_trunc('week', p.created_at at time zone tz)::date wk from public.profiles p
       where (p.created_at at time zone tz)::date >= v_start
    ), act as (
      select distinct a.user_id, date_trunc('week', a.started_at at time zone tz)::date wk from public.activities a
       where (a.started_at at time zone tz)::date >= v_start and a.deleted_at is null and a.status not in ('failed', 'deleted')
    )
    select jsonb_agg(jsonb_build_object(
             'week', c.wk, 'size', c.size,
             'weeks', (select jsonb_agg(case when c.wk + k * 7 > (now() at time zone tz)::date then null
                                             when c.size = 0 then 0
                                             else round(100.0 * (select count(distinct co.id) from cohort co join act a on a.user_id = co.id
                                                                  where co.wk = c.wk and a.wk = c.wk + k * 7) / c.size, 1) end order by k)
                         from generate_series(0, w - 1) k))
           order by c.wk)
      from (select wk, count(*) size from cohort group by wk) c), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Per-staff preferences (for example the Overview layout)
-- ---------------------------------------------------------------------------------------------
create table internal.staff_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null check (pg_column_size(value) <= 8192),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create or replace function public.ops_preferences() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select coalesce((select jsonb_object_agg(key, value) from internal.staff_preferences where user_id = internal.require_any_staff()), '{}'::jsonb);
$$;

create or replace function public.ops_set_preference(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_any_staff();
begin
  if p_value is null then
    delete from internal.staff_preferences where user_id = v and key = p_key;
  else
    insert into internal.staff_preferences (user_id, key, value) values (v, p_key, p_value)
    on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Hourly upkeep: metrics for the last three days, and closing solved support conversations
-- ---------------------------------------------------------------------------------------------
create or replace function internal.backoffice_hourly() returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_today date := (now() at time zone internal.analytics_tz())::date;
begin
  perform internal.refresh_metrics(v_today - 2, v_today);
  perform internal.support_autoclose();
end $$;
revoke all on function internal.backoffice_hourly() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('loopfield-backoffice', '7 * * * *', 'select internal.backoffice_hourly()');
  end if;
end $$;

-- Backfill the last four months.
do $$
begin
  perform internal.refresh_metrics((now() at time zone internal.analytics_tz())::date - 120, (now() at time zone internal.analytics_tz())::date);
end $$;

grant execute on function public.ops_metrics(date, date) to authenticated;
grant execute on function public.ops_analytics_breakdowns(date, date) to authenticated;
grant execute on function public.ops_analytics_funnel(date, date) to authenticated;
grant execute on function public.ops_analytics_retention(integer) to authenticated;
grant execute on function public.ops_preferences() to authenticated;
grant execute on function public.ops_set_preference(text, jsonb) to authenticated;
revoke all on function public.ops_metrics(date, date) from anon;
revoke all on function public.ops_analytics_breakdowns(date, date) from anon;
revoke all on function public.ops_analytics_funnel(date, date) from anon;
revoke all on function public.ops_analytics_retention(integer) from anon;
revoke all on function public.ops_preferences() from anon;
revoke all on function public.ops_set_preference(text, jsonb) from anon;
