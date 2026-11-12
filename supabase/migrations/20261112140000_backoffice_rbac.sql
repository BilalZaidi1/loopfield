-- Back office: role-based access control.
--
-- Access is granted through permissions. Roles bundle permissions; the seven built-in roles keep their
-- names (so the app's operator screens and existing grants keep working) and admins can change what
-- the non-admin ones may do or add custom roles. Every existing role check goes through
-- authz.has_role, which now resolves a role name to the permission it stands for:
--   has_role(u, 'moderator') asks for the moderation permission, has_role(u, 'analytics') asks for
--   that permission directly, and has_role(u, 'admin') is true only for admins.
-- Admins hold every permission, including ones added later.

create table internal.staff_permissions (
  key text primary key,
  area text not null,
  label text not null,
  help text not null,
  sort integer not null
);

insert into internal.staff_permissions (key, area, label, help, sort) values
  ('moderation',   'Trust & safety',    'Moderation',                     'Moderation queue and decisions, content and account appeals, clubs.', 10),
  ('integrity',    'Trust & safety',    'Integrity cases',                'Holds, upholds, overturns and competitive appeals.', 20),
  ('routes',       'Trust & safety',    'Route proposals',                'Approve or reject proposed speed routes.', 30),
  ('territory',    'Game',              'Kill switches and seasons',      'Flip kill switches; seasons, regions, exclusions and events.', 40),
  ('rules.edit',   'Game',              'Edit game rules',                'Save new rule versions. They start with the next season.', 50),
  ('rules.apply',  'Game',              'Apply rules to running seasons', 'Move running seasons to a rule version straight away.', 60),
  ('users.view',   'Runners & support', 'View runners',                   'Runner directory and profiles. Email lookups are audited.', 70),
  ('users.manage', 'Runners & support', 'Suspend and sign out runners',   'Suspend, reinstate, sign out everywhere and reset profile fields.', 80),
  ('support',      'Runners & support', 'Support inbox',                  'Read, assign and answer messages from runners.', 90),
  ('analytics',    'Insights',          'Analytics',                      'Analytics screen and metric widgets on the Overview.', 100),
  ('sql',          'Insights',          'SQL editor',                     'Read-only queries over the curated data views. Every query is audited.', 110),
  ('config',       'Platform',          'App settings',                   'Game tunables, sharing, limits, releases and maintenance.', 120),
  ('monetization', 'Platform',          'Monetization',                   'Paywall and premium features.', 130),
  ('jobs',         'Platform',          'Jobs',                           'Retry failed background jobs.', 140),
  ('audit',        'Platform',          'Audit log',                      'Read the audit log.', 150),
  ('staff',        'Platform',          'Staff',                          'Grant and revoke roles, never beyond your own permissions.', 160);

create table internal.staff_role_defs (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,31}$'),
  label text not null check (char_length(label) between 2 and 40),
  description text not null default '' check (char_length(description) <= 200),
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function internal.check_role_permissions() returns trigger
language plpgsql set search_path = pg_catalog, internal as $$
declare
  v_bad text;
begin
  select string_agg(p, ', ') into v_bad
    from unnest(new.permissions) p where not exists (select 1 from internal.staff_permissions sp where sp.key = p);
  if v_bad is not null then raise exception 'unknown permission: %', v_bad using errcode = '22023'; end if;
  new.permissions := array(select distinct p from unnest(new.permissions) p order by p);
  new.updated_at := now();
  return new;
end $$;

create trigger staff_role_defs_check before insert or update on internal.staff_role_defs
  for each row execute function internal.check_role_permissions();

insert into internal.staff_role_defs (key, label, description, permissions, is_system) values
  ('admin', 'Admin', 'Everything. Only admins change roles or grant admin.', array(select key from internal.staff_permissions), true),
  ('territory_operator', 'Territory operator', 'Kill switches, seasons, regions, exclusions and events.', '{territory}', true),
  ('moderator', 'Moderator', 'Reports, content and account decisions, content appeals and clubs.', '{moderation,users.view}', true),
  ('integrity_reviewer', 'Integrity reviewer', 'Holds, invalidations and competitive appeals.', '{integrity,users.view}', true),
  ('route_reviewer', 'Route reviewer', 'Route proposals and course status.', '{routes}', true),
  ('support', 'Support', 'Runner lookup and the support inbox.', '{users.view,support}', true),
  ('analyst', 'Analyst', 'Analytics and the read-only SQL editor.', '{analytics,sql}', true);

alter table public.staff_roles drop constraint if exists staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_fkey
  foreign key (role) references internal.staff_role_defs (key) on update cascade on delete cascade;

-- ---------------------------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------------------------
create or replace function authz.permission_for(p_role text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case p_role
           when 'moderator' then 'moderation'
           when 'integrity_reviewer' then 'integrity'
           when 'route_reviewer' then 'routes'
           when 'territory_operator' then 'territory'
           when 'support' then 'users.view'
           else p_role end;
$$;

create or replace function authz.has_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select exists (
    select 1 from public.staff_roles sr join internal.staff_role_defs d on d.key = sr.role
     where sr.user_id = p_user and sr.revoked_at is null
       and (d.key = 'admin' or (p_role <> 'admin' and authz.permission_for(p_role) = any (d.permissions)))
  );
$$;

create or replace function authz.staff_permissions(p_user uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select case
    when exists (select 1 from public.staff_roles where user_id = p_user and revoked_at is null and role = 'admin')
      then array(select key from internal.staff_permissions order by sort)
    else array(
      select distinct p from public.staff_roles sr join internal.staff_role_defs d on d.key = sr.role, unnest(d.permissions) p
       where sr.user_id = p_user and sr.revoked_at is null order by p)
  end;
$$;

revoke all on function authz.staff_permissions(uuid) from public, anon, authenticated;

create or replace function public.ops_whoami() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, internal, authz as $$
  select jsonb_build_object(
    'user_id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'avatar_path', p.avatar_path, 'status', p.status,
    'roles', coalesce((select jsonb_agg(s.role order by s.role) from public.staff_roles s where s.user_id = p.id and s.revoked_at is null), '[]'::jsonb),
    'role_labels', coalesce((select jsonb_agg(d.label order by d.label) from public.staff_roles s join internal.staff_role_defs d on d.key = s.role
                              where s.user_id = p.id and s.revoked_at is null), '[]'::jsonb),
    'permissions', to_jsonb(authz.staff_permissions(p.id)),
    'require_mfa', coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'ops_require_mfa'), false))
  from public.profiles p where p.id = auth.uid();
$$;

-- Granting: staff with the staff permission can hand out roles whose permissions they hold
-- themselves. Admin, and any role with more than the granter has, needs an admin. The last admin
-- cannot be removed.
create or replace function public.ops_grant_role(p_user uuid, p_role text, p_grant boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_actor uuid := internal.require_role('staff');
  v_def internal.staff_role_defs;
begin
  select * into v_def from internal.staff_role_defs where key = p_role;
  if not found then raise exception 'unknown role %', p_role using errcode = '22023'; end if;
  if (p_role = 'admin' or not (v_def.permissions <@ authz.staff_permissions(v_actor))) and not authz.has_role(v_actor, 'admin') then
    raise exception 'only an admin can grant or remove the % role', v_def.label using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'runner not found' using errcode = 'P0002'; end if;
  if p_grant then
    insert into public.staff_roles (user_id, role, granted_by) values (p_user, p_role, v_actor)
    on conflict (user_id, role) do update set revoked_at = null, granted_by = v_actor, granted_at = now();
  else
    if p_role = 'admin' and not exists (
      select 1 from public.staff_roles where role = 'admin' and revoked_at is null and user_id <> p_user) then
      raise exception 'keep at least one admin' using errcode = '42501';
    end if;
    update public.staff_roles set revoked_at = now() where user_id = p_user and role = p_role and revoked_at is null;
  end if;
  perform internal.audit(v_actor, 'staff', case when p_grant then 'role_granted' else 'role_revoked' end, 'profile', p_user::text,
                         jsonb_build_object('role', p_role));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Roles screen
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_rbac() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v uuid := internal.require_any_staff();
  v_all jsonb := (select jsonb_agg(key order by sort) from internal.staff_permissions);
begin
  return jsonb_build_object(
    'permissions', (select jsonb_agg(jsonb_build_object('key', key, 'area', area, 'label', label, 'help', help) order by sort) from internal.staff_permissions),
    'roles', (select jsonb_agg(jsonb_build_object(
                 'key', d.key, 'label', d.label, 'description', d.description, 'is_system', d.is_system, 'updated_at', d.updated_at,
                 'permissions', case when d.key = 'admin' then v_all else to_jsonb(d.permissions) end,
                 'members', (select count(*) from public.staff_roles sr where sr.role = d.key and sr.revoked_at is null))
               order by (d.key <> 'admin'), (not d.is_system), d.label)
              from internal.staff_role_defs d),
    'can_edit', authz.has_role(v, 'admin'),
    'can_grant', authz.has_role(v, 'staff'),
    'my_permissions', to_jsonb(authz.staff_permissions(v)));
end $$;

create or replace function public.ops_save_role(p_key text, p_label text, p_description text, p_permissions text[], p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_actor uuid := internal.require_role('admin');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_old internal.staff_role_defs;
  v_new internal.staff_role_defs;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  if p_key = 'admin' then raise exception 'the admin role always has every permission' using errcode = '22023'; end if;
  select * into v_old from internal.staff_role_defs where key = p_key for update;
  if found then
    update internal.staff_role_defs set
      label = case when is_system then label else coalesce(nullif(btrim(p_label), ''), label) end,
      description = coalesce(btrim(p_description), description),
      permissions = coalesce(p_permissions, '{}')
     where key = p_key returning * into v_new;
  else
    insert into internal.staff_role_defs (key, label, description, permissions, created_by)
    values (p_key, btrim(coalesce(p_label, '')), btrim(coalesce(p_description, '')), coalesce(p_permissions, '{}'), v_actor)
    returning * into v_new;
  end if;
  perform internal.audit(v_actor, 'staff', case when v_old.key is null then 'role_created' else 'role_updated' end, 'staff_role', p_key,
    jsonb_build_object('reason', v_reason, 'old_permissions', to_jsonb(v_old.permissions), 'new_permissions', to_jsonb(v_new.permissions),
                       'label', v_new.label));
  return to_jsonb(v_new);
end $$;

create or replace function public.ops_delete_role(p_key text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_actor uuid := internal.require_role('admin');
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_def internal.staff_role_defs;
begin
  if char_length(v_reason) < 5 then raise exception 'write a reason of at least 5 characters' using errcode = '22023'; end if;
  select * into v_def from internal.staff_role_defs where key = p_key for update;
  if not found then raise exception 'unknown role %', p_key using errcode = 'P0002'; end if;
  if v_def.is_system then raise exception 'built-in roles cannot be deleted' using errcode = '22023'; end if;
  if exists (select 1 from public.staff_roles where role = p_key and revoked_at is null) then
    raise exception 'remove this role from its members first' using errcode = '22023';
  end if;
  delete from internal.staff_role_defs where key = p_key;
  perform internal.audit(v_actor, 'staff', 'role_deleted', 'staff_role', p_key, jsonb_build_object('reason', v_reason, 'permissions', to_jsonb(v_def.permissions)));
end $$;

-- Settings: each registered setting names the permission that may change it.
alter table internal.config_registry drop constraint if exists config_registry_min_role_check;
update internal.config_registry set min_role = case category when 'monetization' then 'monetization' else 'config' end
 where min_role = 'admin' and key not in ('ops_require_mfa', 'rules_status');

grant execute on function public.ops_rbac() to authenticated;
grant execute on function public.ops_save_role(text, text, text, text[], text) to authenticated;
grant execute on function public.ops_delete_role(text, text) to authenticated;
revoke all on function public.ops_rbac() from anon;
revoke all on function public.ops_save_role(text, text, text, text[], text) from anon;
revoke all on function public.ops_delete_role(text, text) from anon;

-- The functions below keep their bodies; only the permission they ask for changes
-- (they asked for the admin role before).
CREATE OR REPLACE FUNCTION public.ops_audit_log(p_actor uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_object_type text DEFAULT NULL::text, p_object_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, created_at timestamp with time zone, actor_id uuid, actor_handle text, actor_kind text, action text, object_type text, object_id text, details jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
#variable_conflict use_column
declare
  v uuid := internal.require_role('audit');
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
end $function$;

CREATE OR REPLACE FUNCTION public.ops_dead_jobs(p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, queue text, kind text, attempts integer, last_error text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
begin
  perform internal.require_role('jobs');
  return query select j.id, j.queue, j.kind, j.attempts, j.last_error, j.updated_at from internal.jobs j where j.status = 'dead' order by j.updated_at desc limit least(p_limit, 200);
end $function$;

CREATE OR REPLACE FUNCTION public.ops_retry_job(p_job bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
declare
  v_actor uuid := internal.require_role('jobs');
begin
  update internal.jobs set status = 'queued', attempts = 0, run_at = now(), locked_by = null, locked_at = null where id = p_job and status = 'dead';
  perform internal.audit(v_actor, 'staff', 'job_retried', 'job', p_job::text, '{}');
end $function$;

CREATE OR REPLACE FUNCTION public.ops_retry_dead_jobs(p_queue text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
declare
  v_actor uuid := internal.require_role('jobs');
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
end $function$;

CREATE OR REPLACE FUNCTION public.ops_staff_list()
 RETURNS TABLE(user_id uuid, handle text, display_name text, status text, roles text[], granted_at timestamp with time zone, mfa_enabled boolean, last_sign_in_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'internal'
AS $function$
#variable_conflict use_column
declare
  v uuid := internal.require_role('staff');
begin
  return query
  select p.id, p.handle::text, p.display_name, p.status, array_agg(s.role order by s.role), min(s.granted_at),
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'),
         (select u.last_sign_in_at from auth.users u where u.id = p.id)
    from public.staff_roles s join public.profiles p on p.id = s.user_id
   where s.revoked_at is null
   group by p.id
   order by p.handle;
end $function$;

