-- 11 Nov enhancement release (requested after PRD v1.2). Sections are added in order:
--   1. Movement integrity: suspicious runs are marked, kept on the review trail, and thresholds are tunable.

-- ---------------------------------------------------------------------------------------------
-- 1. Movement integrity
-- ---------------------------------------------------------------------------------------------
-- Reasons from the server's movement check that mark a run (public or private) as moving unlike a runner.
alter table public.activities add column if not exists integrity_flags text[] not null default '{}';
-- What the system saw when it opened a case (reasons, rule version, distance left out), for reviewers.
alter table public.integrity_cases add column if not exists signals jsonb not null default '{}';

insert into public.app_config (key, value, description, is_public) values
  ('integrity_overrides', '{}'::jsonb,
   'Overrides for movement integrity thresholds (INTEGRITY_RULES keys, e.g. {"version": "v2", "stepsMinCadence": 90}). Unknown keys and out-of-range values are ignored; empty means the defaults.',
   true)
on conflict (key) do nothing;

-- Distance the movement check left out, kept so a reviewer who clears a GPS error can credit it back.
alter table public.activities add column if not exists integrity_excluded_m double precision not null default 0;
-- Set when a reviewer clears the flags (a GPS error); later re-evaluations never flag the run again.
alter table public.activities add column if not exists integrity_cleared_at timestamptz;

create or replace function internal.flag_activity(p_activity uuid, p_flags text[], p_signals jsonb default '{}')
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid;
  v_cleared timestamptz;
begin
  select user_id, integrity_cleared_at into v_user, v_cleared from public.activities where id = p_activity for update;
  if not found or v_cleared is not null then return; end if;
  update public.activities
     set integrity_flags = coalesce(p_flags, '{}'),
         integrity_excluded_m = case when coalesce(array_length(p_flags, 1), 0) > 0 then greatest(coalesce((p_signals ->> 'excluded_m')::double precision, 0), 0) else 0 end
   where id = p_activity;
  if coalesce(array_length(p_flags, 1), 0) > 0
     and not exists (select 1 from public.integrity_cases where kind = 'activity' and object_id = p_activity) then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by, hold_from_competition, signals)
    values ('activity', p_activity, v_user, 'system', false, coalesce(p_signals, '{}'::jsonb) || jsonb_build_object('reasons', to_jsonb(p_flags)));
  end if;
end $$;
revoke execute on function internal.flag_activity(uuid, text[], jsonb) from public, anon, authenticated;

/** A reviewer found the flagged movement was a GPS error: clear the flags and credit the left-out distance. */
create or replace function internal.clear_activity_flags(p_activity uuid, p_actor uuid)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  a public.activities;
  v_points integer := 0;
begin
  select * into a from public.activities where id = p_activity for update;
  if not found or a.integrity_cleared_at is not null then return 0; end if;
  perform internal.lock_movement(a.user_id);
  update public.activities set integrity_flags = '{}', integrity_cleared_at = now() where id = p_activity;
  if a.deleted_at is null and a.integrity_excluded_m > 0
     and exists (select 1 from internal.movement_ledger where activity_id = p_activity and kind = 'run') then
    v_points := floor(a.integrity_excluded_m * internal.config_int('movement_points_per_km', 10) / 1000.0)::integer;
    if v_points > 0 then
      insert into internal.movement_ledger (user_id, kind, amount, activity_id, verified_distance_m, earned_on, note)
      values (a.user_id, 'reinstate', v_points, p_activity, a.integrity_excluded_m, (a.started_at at time zone 'UTC')::date, 'integrity_cleared');
      perform internal.add_to_balance(a.user_id, v_points, v_points, 0);
    end if;
  end if;
  perform internal.audit(p_actor, 'staff', 'activity_flags_cleared', 'activity', p_activity::text, jsonb_build_object('points', v_points));
  return v_points;
end $$;
revoke execute on function internal.clear_activity_flags(uuid, uuid) from public, anon, authenticated;

-- Runners can ask for a review of a run marked for unlike-running movement (for example a GPS error).
alter table public.appeals drop constraint if exists appeals_object_type_check;
alter table public.appeals add constraint appeals_object_type_check
  check (object_type in ('loop_claim', 'speed_attempt', 'post', 'comment', 'account_action', 'route_proposal', 'moderation_case', 'activity'));

create or replace function public.submit_appeal(p_object_type text, p_object_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_decided timestamptz;
  v_id uuid;
begin
  v_decided := case p_object_type
    when 'loop_claim' then (select coalesce(invalidated_at, validated_at) from public.loop_claims where id = p_object_id and user_id = v_user)
    when 'speed_attempt' then (select coalesce(validated_at, updated_at) from public.speed_attempts where id = p_object_id and user_id = v_user)
    when 'post' then (select updated_at from public.posts where id = p_object_id and author_id = v_user and status = 'removed')
    when 'comment' then (select coalesce(edited_at, created_at) from public.comments where id = p_object_id and author_id = v_user and status = 'removed')
    when 'route_proposal' then (select decided_at from public.route_proposals where id = p_object_id and creator_id = v_user)
    when 'moderation_case' then (select resolved_at from public.moderation_cases where id = p_object_id and subject_user_id = v_user)
    when 'activity' then (select updated_at from public.activities where id = p_object_id and user_id = v_user and deleted_at is null and cardinality(integrity_flags) > 0)
    else null end;
  if v_decided is null then raise exception 'nothing to appeal' using errcode = '42501'; end if;
  if v_decided < now() - interval '7 days' then raise exception 'the seven-day appeal window has closed'; end if;
  insert into public.appeals (user_id, object_type, object_id, reason) values (v_user, p_object_type, p_object_id, btrim(p_reason)) returning id into v_id;
  if p_object_type in ('loop_claim', 'speed_attempt', 'activity') then
    insert into public.integrity_cases (kind, object_id, subject_user_id, opened_by) values (p_object_type, p_object_id, v_user, 'appeal');
  end if;
  return v_id;
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
    elsif ic.kind = 'speed_attempt' then perform internal.restore_attempt(ic.object_id, v_actor);
    elsif ic.kind = 'activity' then perform internal.clear_activity_flags(ic.object_id, v_actor); end if;
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
