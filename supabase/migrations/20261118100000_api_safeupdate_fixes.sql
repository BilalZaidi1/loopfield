-- Supabase's Data API (PostgREST) connects through the authenticator role, which preloads the safeupdate
-- library: an UPDATE or DELETE without a WHERE clause fails with "UPDATE requires a WHERE clause"
-- (SQLSTATE 21000, HTTP 400). Migrations, pg_cron and the SQL tests connect directly and skip that check,
-- so two functions passed every test but failed whenever they ran through the API:
--   * internal.refresh_metrics, run by ops_metrics: the console's Overview figures and Analytics screen.
--   * public.reclaim_cells: the app's "win back lost cells with points".
-- supabase/tests/sql/14_api_guards.sql now fails on any function with such a statement.

-- Metrics ----------------------------------------------------------------------------------------
-- One refresh at a time (the hourly job and console requests used to race on the same days), and the
-- bookkeeping row is updated by its key.
create or replace function internal.refresh_metrics(p_from date, p_to date) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  tz text := internal.analytics_tz();
  t0 timestamptz := (p_from::timestamp at time zone tz);
  t1 timestamptz := ((p_to + 1)::timestamp at time zone tz);
begin
  perform pg_advisory_xact_lock(hashtext('internal.refresh_metrics'));
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
  update internal.metrics_meta set refreshed_at = now() where id;
end $$;
revoke all on function internal.refresh_metrics(date, date) from public;

-- The console tops up yesterday and today when the hourly refresh is more than 10 minutes old. Only one
-- request refreshes at a time, and a refresh that fails is logged and never stops the figures loading.
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
                        when 'distinct' then internal.period_active_runners(v_from, v_to)
                        else coalesce((select sum(value) from internal.metrics_daily where metric = c.k and day between v_from and v_to), 0) end cur,
             case c.agg when 'median' then (select avg(value) from internal.metrics_daily where metric = c.k and day between v_pfrom and v_pto)
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

-- Reclaim ----------------------------------------------------------------------------------------
-- Patched in place, so the rest of the app's function stays exactly as deployed.
do $$
declare
  old constant text := 'delete from pg_temp.reclaim_eligible;';
  def text := pg_get_functiondef('public.reclaim_cells(uuid, uuid, uuid, text[])'::regprocedure);
begin
  if (length(def) - length(replace(def, old, ''))) / length(old) <> 1 then
    raise exception 'public.reclaim_cells changed: expected "%" exactly once', old;
  end if;
  execute replace(def, old, 'delete from pg_temp.reclaim_eligible where true;');
end $$;
