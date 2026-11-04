-- Operator workflows (PRD §16 Access and administration, FR24, FR44). Each action checks a scoped
-- staff role and writes an audit record; nothing requires unrestricted manual database edits.
-- Staff do not receive raw routes, private chats or health data through these functions.

create or replace function internal.require_role(p_role text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, authz as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not authz.has_role(v, p_role) then raise exception 'requires % role', p_role using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.my_staff_roles() returns text[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(role order by role), '{}') from public.staff_roles where user_id = auth.uid() and revoked_at is null;
$$;

-- Moderation ----------------------------------------------------------------------------------
create or replace function public.ops_moderation_queue(p_status text default 'open', p_limit integer default 50)
returns table (id uuid, object_type text, object_id text, priority text, status text, report_count integer, created_at timestamptz, categories text[])
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
begin
  perform internal.require_role('moderator');
  return query
  select c.id, c.object_type, c.object_id, c.priority, c.status, c.report_count, c.created_at,
         (select array_agg(distinct r.category) from public.reports r where r.case_id = c.id)
    from public.moderation_cases c
   where c.status = p_status
   order by case c.priority when 'urgent' then 0 else 1 end, c.created_at
   limit least(p_limit, 200);
end $$;

-- Case detail returns only the reported object and the restricted evidence for that case.
create or replace function public.ops_moderation_case(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  c public.moderation_cases;
  v_object jsonb;
begin
  perform internal.require_role('moderator');
  select * into c from public.moderation_cases where id = p_case;
  if not found then return null; end if;
  v_object := case c.object_type
    when 'post' then (select jsonb_build_object('body', p.body, 'audience', p.audience, 'status', p.status, 'author', p.author_id,
                        'media', (select jsonb_agg(m.derivative_path) from public.post_media m where m.post_id = p.id)) from public.posts p where p.id = c.object_id::uuid)
    when 'comment' then (select jsonb_build_object('body', cm.body, 'status', cm.status, 'author', cm.author_id, 'post', cm.post_id) from public.comments cm where cm.id = c.object_id::uuid)
    when 'profile' then (select jsonb_build_object('handle', pr.handle, 'display_name', pr.display_name, 'bio', pr.bio, 'avatar_path', pr.avatar_path, 'status', pr.status) from public.profiles pr where pr.id = c.object_id::uuid)
    when 'club' then (select jsonb_build_object('name', cl.name, 'description', cl.description, 'rules', cl.rules, 'status', cl.status) from public.clubs cl where cl.id = c.object_id::uuid)
    when 'route' then (select jsonb_build_object('name', co.name, 'status', co.status) from public.courses co where co.id = c.object_id::uuid)
    else null end;
  return jsonb_build_object(
    'case', to_jsonb(c), 'object', v_object,
    'reports', (select jsonb_agg(jsonb_build_object('category', r.category, 'details', r.details, 'created_at', r.created_at)) from public.reports r where r.case_id = p_case),
    'evidence', (select jsonb_agg(e.evidence order by e.captured_at) from internal.moderation_evidence e where e.case_id = p_case),
    'actions', (select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'at', a.created_at)) from internal.moderation_actions a where a.case_id = p_case)
  );
end $$;

create or replace function public.ops_moderate(p_case uuid, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('moderator');
  c public.moderation_cases;
begin
  select * into c from public.moderation_cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if p_action = 'remove_content' then
    case c.object_type
      when 'post' then update public.posts set status = 'removed', removed_reason = left(p_reason, 200) where id = c.object_id::uuid;
      when 'comment' then update public.comments set status = 'removed' where id = c.object_id::uuid;
      when 'profile' then update public.profiles set bio = null, avatar_path = null, display_name = 'Runner' where id = c.object_id::uuid;
      when 'club' then update public.clubs set status = 'suspended' where id = c.object_id::uuid;
      when 'route' then perform internal.withdraw_course(c.object_id::uuid, 'moderation', v_actor);
      when 'message' then perform internal.enqueue_job('chat', 'moderate_message', jsonb_build_object('message_id', c.object_id, 'action', 'delete'), 'modmsg:' || c.object_id);
      else null;
    end case;
  elsif p_action = 'restore_content' then
    case c.object_type
      when 'post' then update public.posts set status = 'published', removed_reason = null where id = c.object_id::uuid and status = 'removed';
      when 'comment' then update public.comments set status = 'visible' where id = c.object_id::uuid and status = 'removed';
      when 'club' then update public.clubs set status = 'active' where id = c.object_id::uuid and status = 'suspended';
      else null;
    end case;
  elsif p_action = 'suspend_account' then
    update public.profiles set status = 'suspended' where id = c.subject_user_id;
    perform internal.enqueue_job('chat', 'deactivate_user', jsonb_build_object('user_id', c.subject_user_id), 'deact:' || c.subject_user_id);
  elsif p_action = 'reinstate_account' then
    update public.profiles set status = 'active' where id = c.subject_user_id and status = 'suspended';
  elsif p_action not in ('dismiss', 'warn') then
    raise exception 'unknown action %', p_action;
  end if;
  update public.moderation_cases
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, outcome = p_action, outcome_reason = left(p_reason, 500), resolved_at = now(), assigned_to = v_actor
   where id = p_case;
  update public.reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end where case_id = p_case;
  insert into internal.moderation_actions (case_id, actor_id, action, reason) values (p_case, v_actor, p_action, p_reason);
  perform internal.audit(v_actor, 'staff', 'moderation_' || p_action, c.object_type, c.object_id, jsonb_build_object('case', p_case));
  if c.subject_user_id is not null and p_action not in ('dismiss') then
    perform internal.notify(c.subject_user_id, 'system', 'moderation_decision', null, 'moderation_case', p_case::text, jsonb_build_object('action', p_action), 'mod:' || p_case);
  end if;
end $$;

-- Route proposals -----------------------------------------------------------------------------
create or replace function public.ops_route_queue(p_limit integer default 50)
returns table (id uuid, name text, creator_handle text, length_m double precision, closed boolean, created_at timestamptz, path_geojson jsonb, course_geometry jsonb, score_founding_run boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, extensions as $$
begin
  perform internal.require_role('route_reviewer');
  return query
  select rp.id, rp.name, p.handle::text, rp.length_m, rp.closed, rp.created_at, st_asgeojson(rp.path, 6)::jsonb, rp.course_geometry, rp.score_founding_run
    from public.route_proposals rp join public.profiles p on p.id = rp.creator_id
   where rp.status = 'pending_review' order by rp.created_at limit least(p_limit, 200);
end $$;

create or replace function public.ops_review_route(p_proposal uuid, p_approve boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_actor uuid := internal.require_role('route_reviewer');
  v public.route_proposals;
  v_course uuid;
  v_version uuid;
  g jsonb;
begin
  select * into v from public.route_proposals where id = p_proposal for update;
  if not found or v.status <> 'pending_review' then raise exception 'proposal not pending'; end if;
  if not p_approve then
    update public.route_proposals set status = 'declined', decision_reason = left(p_reason, 500), reviewed_by = v_actor, decided_at = now() where id = p_proposal;
    perform internal.audit(v_actor, 'staff', 'route_declined', 'route_proposal', p_proposal::text, jsonb_build_object('reason', p_reason));
    perform internal.notify(v.creator_id, 'system', 'route_decided', null, 'route_proposal', p_proposal::text, '{"approved": false}', 'route:' || p_proposal);
    return null;
  end if;
  g := v.course_geometry;
  insert into public.courses (region_id, creator_id, name) values (v.region_id, v.creator_id, v.name) returning id into v_course;
  insert into public.course_versions (course_id, version, path, length_m, closed, start_gate, finish_gate, start_bearing, finish_bearing, checkpoints, corridor_m)
  values (v_course, 1, v.path, v.length_m, v.closed,
          st_setsrid(st_geomfromgeojson((g -> 'start_gate')::text), 4326), st_setsrid(st_geomfromgeojson((g -> 'finish_gate')::text), 4326),
          (g ->> 'start_bearing')::float8, (g ->> 'finish_bearing')::float8, g -> 'checkpoints', (g ->> 'corridor_m')::float8)
  returning id into v_version;
  update public.courses set current_version_id = v_version where id = v_course;
  update public.route_proposals set status = 'approved', canonical_course_id = v_course, decision_reason = left(p_reason, 500), reviewed_by = v_actor, decided_at = now() where id = p_proposal;
  if v.score_founding_run then
    perform internal.enqueue_job('speed', 'evaluate_founding_attempt', jsonb_build_object('proposal_id', p_proposal, 'course_version_id', v_version), 'founding:' || p_proposal);
  end if;
  perform internal.audit(v_actor, 'staff', 'route_approved', 'route_proposal', p_proposal::text, jsonb_build_object('course', v_course));
  perform internal.notify(v.creator_id, 'system', 'route_decided', null, 'course', v_course::text, '{"approved": true}', 'route:' || p_proposal);
  return v_course;
end $$;

create or replace function public.ops_set_course_status(p_course uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('route_reviewer');
begin
  if p_status = 'withdrawn' then perform internal.withdraw_course(p_course, p_reason, v_actor); return; end if;
  if p_status not in ('active', 'suspended') then raise exception 'invalid status'; end if;
  update public.courses set status = p_status where id = p_course;
  update public.course_versions set status = p_status where course_id = p_course and status <> 'retired';
  perform internal.audit(v_actor, 'staff', 'course_' || p_status, 'course', p_course::text, jsonb_build_object('reason', p_reason));
end $$;

-- Integrity and appeals -----------------------------------------------------------------------
create or replace function public.ops_integrity_queue(p_limit integer default 50)
returns table (id uuid, kind text, object_id uuid, opened_by text, status text, hold boolean, created_at timestamptz, reasons text[], object_status text)
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
begin
  perform internal.require_role('integrity_reviewer');
  return query
  select ic.id, ic.kind, ic.object_id, ic.opened_by, ic.status, ic.hold_from_competition, ic.created_at,
         coalesce(lc.reasons, sa.reasons), coalesce(lc.status, sa.status)
    from public.integrity_cases ic
    left join public.loop_claims lc on ic.kind = 'loop_claim' and lc.id = ic.object_id
    left join public.speed_attempts sa on ic.kind = 'speed_attempt' and sa.id = ic.object_id
   where ic.status <> 'resolved' order by ic.created_at limit least(p_limit, 200);
end $$;

-- Evidence summary for a claim or attempt (quality metrics only; the raw trace stays in storage and
-- is fetched by the review tooling through a short-lived, audited signed URL).
create or replace function public.ops_integrity_detail(p_case uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('integrity_reviewer');
  ic public.integrity_cases;
begin
  select * into ic from public.integrity_cases where id = p_case;
  perform internal.audit(v_actor, 'staff', 'integrity_viewed', 'integrity_case', p_case::text, '{}');
  return jsonb_build_object(
    'case', to_jsonb(ic),
    'claim', (select to_jsonb(lc) - 'polygon' from public.loop_claims lc where ic.kind = 'loop_claim' and lc.id = ic.object_id),
    'attempt', (select to_jsonb(sa) from public.speed_attempts sa where ic.kind = 'speed_attempt' and sa.id = ic.object_id),
    'activity', (select jsonb_build_object('sample_count', a.sample_count, 'usable_sample_count', a.usable_sample_count, 'gaps', a.gaps, 'device', a.device,
                                           'distance_m', a.distance_m, 'elapsed_ms', a.elapsed_ms)
                   from public.activities a where a.id = coalesce(
                     (select activity_id from public.loop_claims where id = ic.object_id),
                     (select activity_id from public.speed_attempts where id = ic.object_id))),
    'appeal', (select to_jsonb(ap) from public.appeals ap where ap.object_id = ic.object_id order by ap.created_at desc limit 1)
  );
end $$;

create or replace function public.ops_set_hold(p_case uuid, p_hold boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('integrity_reviewer');
  ic public.integrity_cases;
begin
  select * into ic from public.integrity_cases where id = p_case for update;
  update public.integrity_cases set hold_from_competition = p_hold, status = 'in_review', assigned_to = v_actor where id = p_case;
  -- Holding a disputed result out of competition replays only that ledger; a report alone never erases land.
  if p_hold and ic.kind = 'loop_claim' then perform internal.invalidate_claim(ic.object_id, 'pending_review', 'staff_invalidated', v_actor);
  elsif p_hold and ic.kind = 'speed_attempt' then perform internal.invalidate_attempt(ic.object_id, 'pending_review', 'staff_invalidated', v_actor);
  elsif not p_hold and ic.kind = 'loop_claim' then perform internal.restore_claim(ic.object_id, v_actor);
  elsif not p_hold and ic.kind = 'speed_attempt' then perform internal.restore_attempt(ic.object_id, v_actor);
  end if;
  perform internal.audit(v_actor, 'staff', case when p_hold then 'hold' else 'release' end, 'integrity_case', p_case::text, '{}');
end $$;

create or replace function public.ops_resolve_integrity(p_case uuid, p_resolution text, p_notes text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('integrity_reviewer');
  ic public.integrity_cases;
begin
  select * into ic from public.integrity_cases where id = p_case for update;
  if not found or ic.status = 'resolved' then raise exception 'case not open'; end if;
  if p_resolution = 'invalidated' then
    if ic.kind = 'loop_claim' then perform internal.invalidate_claim(ic.object_id, 'invalid', 'staff_invalidated', v_actor);
    elsif ic.kind = 'speed_attempt' then perform internal.invalidate_attempt(ic.object_id, 'invalid', 'staff_invalidated', v_actor); end if;
  elsif p_resolution = 'overturned' then
    if ic.kind = 'loop_claim' then perform internal.restore_claim(ic.object_id, v_actor);
    elsif ic.kind = 'speed_attempt' then perform internal.restore_attempt(ic.object_id, v_actor); end if;
  elsif p_resolution not in ('upheld', 'no_action') then raise exception 'invalid resolution';
  end if;
  update public.integrity_cases set status = 'resolved', resolution = p_resolution, notes = left(p_notes, 2000), resolved_at = now(), assigned_to = v_actor where id = p_case;
  update public.appeals set status = case when p_resolution = 'overturned' then 'overturned' else 'upheld' end, response = left(p_notes, 2000), decided_by = v_actor, decided_at = now()
   where object_id = ic.object_id and status in ('submitted', 'in_review');
  if ic.subject_user_id is not null then
    perform internal.notify(ic.subject_user_id, 'system', 'appeal_decided', null, 'integrity_case', p_case::text, jsonb_build_object('resolution', p_resolution), 'integrity:' || p_case);
  end if;
  perform internal.audit(v_actor, 'staff', 'integrity_' || p_resolution, ic.kind, ic.object_id::text, jsonb_build_object('case', p_case));
end $$;

create or replace function public.ops_decide_content_appeal(p_appeal uuid, p_overturn boolean, p_response text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('moderator');
  a public.appeals;
begin
  select * into a from public.appeals where id = p_appeal for update;
  if not found or a.status not in ('submitted', 'in_review') or a.object_type not in ('post', 'comment', 'moderation_case', 'route_proposal') then raise exception 'not a pending content appeal'; end if;
  if p_overturn then
    if a.object_type = 'post' then update public.posts set status = 'published', removed_reason = null where id = a.object_id and status = 'removed';
    elsif a.object_type = 'comment' then update public.comments set status = 'visible' where id = a.object_id and status = 'removed'; end if;
  end if;
  update public.appeals set status = case when p_overturn then 'overturned' else 'upheld' end, response = left(p_response, 2000), decided_by = v_actor, decided_at = now() where id = p_appeal;
  perform internal.notify(a.user_id, 'system', 'appeal_decided', null, 'appeal', p_appeal::text, jsonb_build_object('overturned', p_overturn), 'appeal:' || p_appeal);
  perform internal.audit(v_actor, 'staff', 'appeal_' || case when p_overturn then 'overturned' else 'upheld' end, a.object_type, a.object_id::text, '{}');
end $$;

-- Territory operations -----------------------------------------------------------------------
create or replace function public.ops_add_exclusion(p_region uuid, p_geojson jsonb, p_kind text, p_reason text, p_apply_now boolean default false) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
  v_id uuid;
  v_version text;
begin
  select coalesce(exclusion_set_version, 'unversioned') into v_version from public.regions where id = p_region;
  insert into public.exclusion_zones (region_id, set_version, kind, geom, reason, created_by)
  values (p_region, case when p_apply_now then 'override' else v_version end, case when p_apply_now then 'safety_override' else p_kind end,
          st_multi(st_setsrid(st_geomfromgeojson(p_geojson::text), 4326))::geography, left(p_reason, 500), v_actor)
  returning id into v_id;
  if p_apply_now then perform internal.apply_exclusion(v_id, v_actor); end if;
  perform internal.audit(v_actor, 'staff', 'exclusion_added', 'exclusion_zone', v_id::text, jsonb_build_object('kind', p_kind, 'applied', p_apply_now));
  return v_id;
end $$;

create or replace function public.ops_set_region_review(p_region uuid, p_status text, p_set_version text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
begin
  update public.regions set exclusion_review_status = p_status, exclusion_set_version = p_set_version where id = p_region;
  -- Applies to future seasons; the active season keeps its frozen version unless still unset.
  update public.seasons s set exclusion_set_version = p_set_version
    from public.competitions c
   where c.id = s.competition_id and c.region_id = p_region and s.status in ('scheduled', 'active') and s.exclusion_set_version is null and p_status = 'reviewed';
  perform internal.audit(v_actor, 'staff', 'region_review', 'region', p_region::text, jsonb_build_object('status', p_status, 'version', p_set_version));
end $$;

create or replace function public.ops_set_switch(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
begin
  if p_key not in ('territory_capture_enabled', 'speed_titles_enabled', 'public_publication_enabled', 'photo_uploads_enabled', 'messaging_enabled', 'disabled_health_cards') then
    raise exception 'unknown switch';
  end if;
  update public.app_config set value = p_value, updated_at = now() where key = p_key;
  perform internal.audit(v_actor, 'staff', 'switch_changed', 'app_config', p_key, jsonb_build_object('value', p_value));
end $$;

create or replace function public.ops_replay_season(p_competition uuid, p_season uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('territory_operator');
  v integer;
begin
  v := internal.replay_season(p_competition, p_season);
  perform internal.audit(v_actor, 'staff', 'season_replayed', 'season', p_season::text, jsonb_build_object('cells', v));
  return v;
end $$;

create or replace function public.ops_grant_role(p_user uuid, p_role text, p_grant boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('admin');
begin
  if p_grant then
    insert into public.staff_roles (user_id, role, granted_by) values (p_user, p_role, v_actor)
    on conflict (user_id, role) do update set revoked_at = null, granted_by = v_actor, granted_at = now();
  else
    update public.staff_roles set revoked_at = now() where user_id = p_user and role = p_role;
  end if;
  perform internal.audit(v_actor, 'staff', case when p_grant then 'role_granted' else 'role_revoked' end, 'profile', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.ops_dead_jobs(p_limit integer default 50)
returns table (id bigint, queue text, kind text, attempts integer, last_error text, updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
begin
  perform internal.require_role('admin');
  return query select j.id, j.queue, j.kind, j.attempts, j.last_error, j.updated_at from internal.jobs j where j.status = 'dead' order by j.updated_at desc limit least(p_limit, 200);
end $$;

create or replace function public.ops_retry_job(p_job bigint) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('admin');
begin
  update internal.jobs set status = 'queued', attempts = 0, run_at = now(), locked_by = null, locked_at = null where id = p_job and status = 'dead';
  perform internal.audit(v_actor, 'staff', 'job_retried', 'job', p_job::text, '{}');
end $$;
