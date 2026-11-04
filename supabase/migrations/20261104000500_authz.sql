-- Authorization helpers used by RLS policies and RPCs. They live in `authz`, which is usable by the
-- API roles for policy evaluation but is not exposed as an API schema.

create schema if not exists authz;
revoke all on schema authz from public;
grant usage on schema authz to anon, authenticated, service_role;

create or replace function authz.uid() returns uuid
language sql stable set search_path = pg_catalog as $$
  select auth.uid();
$$;

create or replace function authz.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function authz.follows(p_follower uuid, p_followee uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.follows where follower_id = p_follower and followee_id = p_followee and state = 'accepted');
$$;

create or replace function authz.is_active_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = p_user and status = 'active');
$$;

create or replace function authz.club_role(p_club uuid, p_user uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select m.role from public.club_memberships m join public.clubs c on c.id = m.club_id
   where m.club_id = p_club and m.user_id = p_user and m.state = 'active' and c.status <> 'archived';
$$;

create or replace function authz.is_active_member(p_club uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, authz as $$
  select authz.club_role(p_club, p_user) is not null;
$$;

create or replace function authz.is_organizer(p_club uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, authz as $$
  select coalesce(authz.club_role(p_club, p_user) in ('owner', 'organizer'), false);
$$;

create or replace function authz.can_view_club(p_club uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.clubs c
     where c.id = p_club and c.status <> 'archived'
       and (c.visibility = 'public'
         or exists (select 1 from public.club_memberships m
                     where m.club_id = c.id and m.user_id = p_user and m.state in ('active', 'invited', 'requested')))
  );
$$;

create or replace function authz.has_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.staff_roles
     where user_id = p_user and revoked_at is null and (role = p_role or role = 'admin')
  );
$$;

-- Post visibility is evaluated at read time from current audience, membership and block state
-- (FR38, FR40, FR43). Mentions never grant access.
create or replace function authz.can_view_post_row(p_author uuid, p_audience text, p_club uuid, p_status text, p_publish_after timestamptz, p_viewer uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select case
    when p_viewer is null then false
    when p_author = p_viewer then p_status in ('processing', 'published', 'removed')
    when p_status <> 'published' or p_publish_after > now() then false
    when not authz.is_active_profile(p_author) then false
    when authz.is_blocked(p_author, p_viewer) then false
    when p_audience = 'public' then true
    when p_audience = 'followers' then authz.follows(p_viewer, p_author)
    when p_audience = 'club' then authz.is_active_member(p_club, p_viewer)
    else false
  end;
$$;

create or replace function authz.can_view_post(p_post uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select coalesce((select authz.can_view_post_row(p.author_id, p.audience, p.club_id, p.status, p.publish_after, p_viewer)
                     from public.posts p where p.id = p_post), false);
$$;

create or replace function authz.can_view_profile(p_target uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select p_viewer is not null and (
    p_target = p_viewer
    or (authz.is_active_profile(p_target) and not authz.is_blocked(p_target, p_viewer))
  );
$$;

-- Storage object visibility for processed post media: `post-media/<post_id>/<media_id>.jpg`.
create or replace function authz.can_view_media_object(p_name text, p_viewer uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select exists (
    select 1 from public.post_media m
     where m.derivative_path = p_name and m.status = 'ready'
       and authz.can_view_post(m.post_id, p_viewer)
  );
$$;

grant execute on all functions in schema authz to anon, authenticated, service_role;
