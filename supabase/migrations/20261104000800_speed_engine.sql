-- Speed-title engine. Titles are replayed from eligible attempts in verified completion order with
-- the incumbent-protecting margin (larger of 5 s, 1% of the benchmark, or the summed timing
-- uncertainties). The authoritative state uses all eligible attempts; the published state uses only
-- attempts whose publication delay has elapsed. Titles never read or write land tables.

create or replace function internal.compute_title(p_course_version uuid, p_competition uuid, p_season uuid, p_as_of timestamptz)
returns table (champion_id uuid, benchmark_attempt_id uuid, benchmark_ms integer, benchmark_uncertainty_ms integer, last_kind text, last_attempt uuid, last_margin integer)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  a record;
  v_champion uuid;
  v_attempt uuid;
  v_ms integer;
  v_unc integer := 0;
  v_margin integer;
  v_kind text;
  v_last_attempt uuid;
  v_last_margin integer;
begin
  for a in
    select sa.id, sa.user_id, sa.elapsed_ms, coalesce(sa.uncertainty_ms, 0) as unc
      from public.speed_attempts sa
     where sa.course_version_id = p_course_version and sa.competition_id = p_competition and sa.season_id = p_season
       and sa.status = 'eligible' and sa.elapsed_ms is not null
       and (p_as_of is null or sa.publish_after <= p_as_of)
     order by sa.completed_at, sa.id
  loop
    if v_ms is null then
      v_champion := a.user_id; v_attempt := a.id; v_ms := a.elapsed_ms; v_unc := a.unc;
      v_kind := 'initial'; v_last_attempt := a.id; v_last_margin := null;
      continue;
    end if;
    v_margin := greatest(5000, ceil(v_ms * 0.01)::integer, v_unc + a.unc);
    if a.elapsed_ms <= v_ms - v_margin then
      v_kind := case when a.user_id = v_champion then 'improvement' else 'takeover' end;
      v_champion := a.user_id; v_attempt := a.id; v_ms := a.elapsed_ms; v_unc := a.unc;
      v_last_attempt := a.id; v_last_margin := v_margin;
    end if;
  end loop;
  return query select v_champion, v_attempt, v_ms, v_unc, v_kind, v_last_attempt, v_last_margin;
end $$;

-- Recompute authoritative and published title state; log every change with its cause (FR14–FR17).
create or replace function internal.refresh_title(p_course_version uuid, p_competition uuid, p_season uuid, p_cause text default 'attempt')
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_prev internal.speed_titles;
  v_auth record;
  v_do_pub boolean := internal.config_bool('public_publication_enabled');
  v_pub_champion uuid;
  v_pub_attempt uuid;
  v_pub_ms integer;
  v_pub_unc integer;
  v_kind text;
  v_publish_after timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('title:' || p_course_version || ':' || p_competition || ':' || p_season, 0));
  insert into internal.speed_titles (course_version_id, competition_id, season_id) values (p_course_version, p_competition, p_season)
  on conflict do nothing;
  select * into v_prev from internal.speed_titles
   where course_version_id = p_course_version and competition_id = p_competition and season_id = p_season for update;

  select * into v_auth from internal.compute_title(p_course_version, p_competition, p_season, null);
  if v_do_pub then
    select ct.champion_id, ct.benchmark_attempt_id, ct.benchmark_ms, ct.benchmark_uncertainty_ms
      into v_pub_champion, v_pub_attempt, v_pub_ms, v_pub_unc
      from internal.compute_title(p_course_version, p_competition, p_season, now()) ct;
  end if;

  if v_auth.benchmark_attempt_id is distinct from v_prev.benchmark_attempt_id then
    v_kind := case
      when v_auth.champion_id is null then 'vacated'
      when p_cause <> 'attempt' then 'correction'
      when v_prev.champion_id is null then 'initial'
      when v_auth.champion_id = v_prev.champion_id then 'improvement'
      else 'takeover' end;
    select coalesce(publish_after, now()) into v_publish_after from public.speed_attempts where id = v_auth.benchmark_attempt_id;
    insert into internal.speed_title_changes (course_version_id, competition_id, season_id, kind, prior_champion, new_champion, attempt_id, benchmark_ms, margin_ms, cause, publish_after)
    values (p_course_version, p_competition, p_season, v_kind, v_prev.champion_id, v_auth.champion_id, v_auth.benchmark_attempt_id, v_auth.benchmark_ms, v_auth.last_margin, p_cause, coalesce(v_publish_after, now()));
  end if;

  update internal.speed_titles
     set champion_id = v_auth.champion_id, benchmark_attempt_id = v_auth.benchmark_attempt_id,
         benchmark_ms = v_auth.benchmark_ms, benchmark_uncertainty_ms = v_auth.benchmark_uncertainty_ms, updated_at = now(),
         published_champion_id = case when v_do_pub then v_pub_champion else published_champion_id end,
         published_benchmark_attempt_id = case when v_do_pub then v_pub_attempt else published_benchmark_attempt_id end,
         published_benchmark_ms = case when v_do_pub then v_pub_ms else published_benchmark_ms end,
         published_benchmark_uncertainty_ms = case when v_do_pub then v_pub_unc else published_benchmark_uncertainty_ms end,
         published_at = case when v_do_pub then now() else published_at end
   where course_version_id = p_course_version and competition_id = p_competition and season_id = p_season;
end $$;

-- Publish due title changes and newly due attempts; queue digest items for champions affected.
create or replace function internal.publish_due_titles(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  r record;
  v_count integer := 0;
begin
  if not internal.config_bool('public_publication_enabled') then return 0; end if;
  for r in
    select distinct sa.course_version_id, sa.competition_id, sa.season_id
      from public.speed_attempts sa
     where sa.status in ('eligible', 'invalid', 'withdrawn', 'unranked') and sa.published_at is null
       and sa.publish_after <= now() and sa.season_id is not null
     limit p_limit
  loop
    perform internal.refresh_title(r.course_version_id, r.competition_id, r.season_id, 'publication');
    update public.speed_attempts set published_at = now()
     where course_version_id = r.course_version_id and competition_id = r.competition_id and season_id = r.season_id
       and published_at is null and publish_after <= now();
    v_count := v_count + 1;
  end loop;

  insert into internal.digest_items (user_id, kind, payload)
  select c.prior_champion, 'title_lost', jsonb_build_object('course_version_id', c.course_version_id, 'kind', c.kind)
    from internal.speed_title_changes c
   where c.published_at is null and c.publish_after <= now() and c.prior_champion is not null and c.prior_champion is distinct from c.new_champion;
  insert into internal.digest_items (user_id, kind, payload)
  select c.new_champion, case when c.kind = 'correction' then 'title_corrected' else 'title_won' end,
         jsonb_build_object('course_version_id', c.course_version_id, 'kind', c.kind)
    from internal.speed_title_changes c
   where c.published_at is null and c.publish_after <= now() and c.new_champion is not null and c.prior_champion is distinct from c.new_champion;
  update internal.speed_title_changes set published_at = now() where published_at is null and publish_after <= now();
  return v_count;
end $$;

-- Invalidate or withdraw one attempt and replay only that title (FR16).
create or replace function internal.invalidate_attempt(p_attempt uuid, p_status text, p_reason text, p_actor uuid default null)
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v public.speed_attempts;
begin
  update public.speed_attempts set status = p_status, reasons = array_append(reasons, p_reason)
   where id = p_attempt returning * into v;
  if not found then return; end if;
  if v.season_id is not null then
    perform internal.refresh_title(v.course_version_id, v.competition_id, v.season_id, 'correction');
  end if;
  perform internal.audit(p_actor, case when p_actor is null then 'system' else 'staff' end, 'attempt_' || p_status, 'speed_attempt', p_attempt::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function internal.restore_attempt(p_attempt uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v public.speed_attempts;
begin
  update public.speed_attempts set status = 'eligible', reasons = array_append(reasons, 'appeal_overturned') where id = p_attempt returning * into v;
  if found and v.season_id is not null then perform internal.refresh_title(v.course_version_id, v.competition_id, v.season_id, 'correction'); end if;
  perform internal.audit(p_actor, 'staff', 'attempt_restored', 'speed_attempt', p_attempt::text, '{}');
end $$;

-- Withdrawing a course (creator consent withdrawn or unsafe) removes it from discovery and vacates
-- dependent public displays; land is untouched.
create or replace function internal.withdraw_course(p_course uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  update public.courses set status = 'withdrawn' where id = p_course;
  update public.course_versions set status = 'retired' where course_id = p_course;
  update internal.speed_titles t set published_champion_id = null, published_benchmark_ms = null, published_benchmark_attempt_id = null, published_at = now()
   where t.course_version_id in (select id from public.course_versions where course_id = p_course);
  update public.posts set route_course_id = null where route_course_id = p_course;
  perform internal.audit(p_actor, case when p_actor is null then 'system' else 'staff' end, 'course_withdrawn', 'course', p_course::text, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------------------------
create or replace function public.speed_routes_in_view(p_competition uuid, p_season uuid, p_min_lng double precision, p_min_lat double precision, p_max_lng double precision, p_max_lat double precision)
returns table (course_id uuid, course_version_id uuid, name text, status text, length_m double precision, closed boolean, path_geojson jsonb, start_bearing double precision, champion_handle text, champion_name text, benchmark_ms integer, i_am_champion boolean)
language sql stable security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
  select c.id, cv.id, c.name, case when c.status = 'active' and cv.status = 'active' then 'active' else 'suspended' end,
         cv.length_m, cv.closed, st_asgeojson(cv.path, 6)::jsonb, cv.start_bearing,
         case when authz.is_blocked(t.published_champion_id, auth.uid()) then null else pr.handle::text end,
         case when t.published_champion_id is null then null when authz.is_blocked(t.published_champion_id, auth.uid()) then 'A runner' else pr.display_name end,
         t.published_benchmark_ms, t.published_champion_id = auth.uid()
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    left join internal.speed_titles t on t.course_version_id = cv.id and t.competition_id = p_competition and t.season_id = p_season
    left join public.profiles pr on pr.id = t.published_champion_id
   where auth.uid() is not null and public.can_access_competition(p_competition)
     and c.status in ('active', 'suspended')
     and cv.path && st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
   limit 300;
$$;

create or replace function public.speed_route_detail(p_course uuid, p_competition uuid, p_season uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz, extensions as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  select jsonb_build_object(
    'course_id', c.id, 'course_version_id', cv.id, 'version', cv.version, 'name', c.name,
    'status', case when c.status = 'active' and cv.status = 'active' then 'active' else 'suspended' end,
    'creator_handle', case when authz.is_blocked(c.creator_id, auth.uid()) then null else cr.handle::text end,
    'length_m', cv.length_m, 'closed', cv.closed, 'corridor_m', cv.corridor_m,
    'path', st_asgeojson(cv.path, 6)::jsonb, 'start_gate', st_asgeojson(cv.start_gate, 6)::jsonb, 'finish_gate', st_asgeojson(cv.finish_gate, 6)::jsonb,
    'start_bearing', cv.start_bearing, 'checkpoints', cv.checkpoints,
    'champion_handle', case when authz.is_blocked(t.published_champion_id, auth.uid()) then null else ch.handle::text end,
    'champion_name', case when t.published_champion_id is null then null when authz.is_blocked(t.published_champion_id, auth.uid()) then 'A runner' else ch.display_name end,
    'i_am_champion', coalesce(t.published_champion_id = auth.uid(), false),
    'benchmark_ms', t.published_benchmark_ms,
    'benchmark_uncertainty_ms', t.published_benchmark_uncertainty_ms,
    'required_ms', case when t.published_benchmark_ms is null then null
                        else t.published_benchmark_ms - greatest(5000, ceil(t.published_benchmark_ms * 0.01)::integer, coalesce(t.published_benchmark_uncertainty_ms, 0)) end,
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('rank', rk, 'handle', h, 'name', n, 'best_ms', best, 'is_me', me) order by rk)
        from (
          select rank() over (order by min(sa.elapsed_ms)) rk,
                 case when authz.is_blocked(sa.user_id, auth.uid()) then null else p.handle::text end h,
                 case when authz.is_blocked(sa.user_id, auth.uid()) then 'A runner' else p.display_name end n,
                 min(sa.elapsed_ms) best, sa.user_id = auth.uid() me
            from public.speed_attempts sa join public.profiles p on p.id = sa.user_id
           where sa.course_version_id = cv.id and sa.competition_id = p_competition and sa.season_id = p_season
             and sa.status = 'eligible' and sa.published_at is not null
           group by sa.user_id, p.handle, p.display_name
           limit 50) r), '[]'::jsonb)
  ) into v_result
    from public.courses c
    join public.course_versions cv on cv.id = c.current_version_id
    left join public.profiles cr on cr.id = c.creator_id
    left join internal.speed_titles t on t.course_version_id = cv.id and t.competition_id = p_competition and t.season_id = p_season
    left join public.profiles ch on ch.id = t.published_champion_id
   where c.id = p_course and c.status in ('active', 'suspended');
  return v_result;
end $$;

create or replace function public.my_titles()
returns table (course_id uuid, course_name text, competition_id uuid, season_id uuid, benchmark_ms integer, since timestamptz)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select c.id, c.name, t.competition_id, t.season_id, t.published_benchmark_ms, t.published_at
    from internal.speed_titles t
    join public.course_versions cv on cv.id = t.course_version_id
    join public.courses c on c.id = cv.course_id
   where t.published_champion_id = auth.uid() and c.status = 'active';
$$;
