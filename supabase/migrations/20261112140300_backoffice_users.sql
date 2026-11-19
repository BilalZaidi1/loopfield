-- Back office: runner directory, runner profile (360) and account actions.
--
-- Reading needs users.view; actions need users.manage. No email address, raw route, health value,
-- chat body or privacy zone is returned. Every action needs a reason and is audited.

create or replace function public.ops_users_list(p_query text default null, p_status text default null, p_sort text default 'recent',
                                                 p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('users.view');
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id := v_q::uuid; v_q := null; end if;
  v_q := ltrim(v_q, '@');
  return (
    with base as (
      select p.* from public.profiles p
       where (p_status is null or p.status = p_status)
         and (v_id is null or p.id = v_id)
         and (v_q is null or p.handle ilike v_q || '%' or p.display_name ilike '%' || v_q || '%')
    ), agg as (
      select a.user_id, count(*) as runs, coalesce(sum(a.distance_m), 0) as distance_m, max(a.started_at) as last_run_at
        from public.activities a where a.deleted_at is null and a.user_id in (select id from base) group by a.user_id
    ), rows as (
      select b.id, b.handle, b.display_name, b.status, b.created_at, b.onboarding_completed_at, b.avatar_kind, b.city_label,
             coalesce(g.runs, 0) as runs, coalesce(g.distance_m, 0) as distance_m, g.last_run_at,
             (select count(*) from public.loop_claims lc where lc.user_id = b.id and lc.status = 'eligible' and lc.parent_claim_id is null) as loops,
             (select coalesce(jsonb_agg(sr.role order by sr.role), '[]'::jsonb) from public.staff_roles sr where sr.user_id = b.id and sr.revoked_at is null) as roles
        from base b left join agg g on g.user_id = b.id
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'counts', (select jsonb_build_object('active', count(*) filter (where status = 'active'), 'suspended', count(*) filter (where status = 'suspended'),
                                           'all', count(*)) from public.profiles),
      'items', coalesce((select jsonb_agg(to_jsonb(r)) from (
        select * from rows
         order by case when p_sort = 'active' then extract(epoch from coalesce(last_run_at, 'epoch'::timestamptz)) end desc nulls last,
                  case when p_sort = 'runs' then runs end desc nulls last,
                  case when p_sort = 'distance' then distance_m end desc nulls last,
                  case when p_sort = 'handle' then handle end asc,
                  created_at desc
         limit v_limit offset v_offset) r), '[]'::jsonb))
  );
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
    'can_manage', authz.has_role(v, 'users.manage'),
    'is_self', v = p.id);
end $$;

create or replace function internal.sign_out_everywhere(p_user uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  n integer := 0;
  m integer;
begin
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id::text = $1' using p_user::text;
    get diagnostics m = row_count; n := n + m;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
    get diagnostics m = row_count; n := n + m;
  end if;
  return n;
end $$;
revoke all on function internal.sign_out_everywhere(uuid) from public;

create or replace function public.ops_set_user_status(p_user uuid, p_status text, p_reason text, p_sign_out boolean default false) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_role('users.manage');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_old text;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'status must be active or suspended' using errcode = '22023'; end if;
  if p_user = v then raise exception 'you cannot change your own account here' using errcode = '42501'; end if;
  select status into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'runner not found' using errcode = 'P0002'; end if;
  if v_old not in ('active', 'suspended') then raise exception 'this account is %', v_old using errcode = '22023'; end if;
  if authz.has_role(p_user, 'admin') and not authz.has_role(v, 'admin') then
    raise exception 'only an admin can suspend an admin' using errcode = '42501';
  end if;
  if v_old = p_status then return; end if;
  update public.profiles set status = p_status, updated_at = now() where id = p_user;
  if p_status = 'suspended' and coalesce(p_sign_out, false) then perform internal.sign_out_everywhere(p_user); end if;
  perform internal.audit(v, 'staff', case when p_status = 'suspended' then 'user_suspended' else 'user_reinstated' end, 'profile', p_user::text,
                         jsonb_build_object('reason', v_reason, 'from', v_old, 'to', p_status, 'signed_out', p_status = 'suspended' and coalesce(p_sign_out, false)));
end $$;

create or replace function public.ops_sign_out_user(p_user uuid, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_role('users.manage');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  n integer;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'runner not found' using errcode = 'P0002'; end if;
  if authz.has_role(p_user, 'admin') and not authz.has_role(v, 'admin') and p_user <> v then
    raise exception 'only an admin can sign out an admin' using errcode = '42501';
  end if;
  n := internal.sign_out_everywhere(p_user);
  perform internal.audit(v, 'staff', 'user_signed_out', 'profile', p_user::text, jsonb_build_object('reason', v_reason, 'sessions', n));
  return n;
end $$;

-- Clears profile fields that broke the rules (for example an abusive name or photo).
create or replace function public.ops_reset_profile(p_user uuid, p_fields text[], p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('users.manage');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_bad text;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if coalesce(cardinality(p_fields), 0) = 0 then raise exception 'choose what to reset' using errcode = '22023'; end if;
  select string_agg(f, ', ') into v_bad from unnest(p_fields) f where f not in ('display_name', 'bio', 'avatar', 'city');
  if v_bad is not null then raise exception 'cannot reset %', v_bad using errcode = '22023'; end if;
  update public.profiles set
    display_name = case when 'display_name' = any (p_fields) then handle else display_name end,
    bio = case when 'bio' = any (p_fields) then null else bio end,
    avatar_kind = case when 'avatar' = any (p_fields) then null else avatar_kind end,
    avatar_style = case when 'avatar' = any (p_fields) then null else avatar_style end,
    avatar_photo_path = case when 'avatar' = any (p_fields) then null else avatar_photo_path end,
    avatar_path = case when 'avatar' = any (p_fields) then null else avatar_path end,
    city_label = case when 'city' = any (p_fields) then null else city_label end,
    updated_at = now()
  where id = p_user;
  if not found then raise exception 'runner not found' using errcode = 'P0002'; end if;
  perform internal.audit(v, 'staff', 'profile_reset', 'profile', p_user::text, jsonb_build_object('reason', v_reason, 'fields', to_jsonb(p_fields)));
end $$;

grant execute on function public.ops_users_list(text, text, text, integer, integer) to authenticated;
grant execute on function public.ops_user_overview(uuid) to authenticated;
grant execute on function public.ops_set_user_status(uuid, text, text, boolean) to authenticated;
grant execute on function public.ops_sign_out_user(uuid, text) to authenticated;
grant execute on function public.ops_reset_profile(uuid, text[], text) to authenticated;
revoke all on function public.ops_users_list(text, text, text, integer, integer) from anon;
revoke all on function public.ops_user_overview(uuid) from anon;
revoke all on function public.ops_set_user_status(uuid, text, text, boolean) from anon;
revoke all on function public.ops_sign_out_user(uuid, text) from anon;
revoke all on function public.ops_reset_profile(uuid, text[], text) from anon;
