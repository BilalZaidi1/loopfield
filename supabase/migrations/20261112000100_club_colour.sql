-- Community and group colour: the owner or an admin picks the colour of the cover, its artwork and the
-- monogram from the app's five block colours, and can go back to a plain cover (no artwork). Without a
-- choice the colour is the one the app derives from the id, as before. Every function that returns a
-- community's look now carries it.

alter table public.clubs add column if not exists tone text check (tone in ('violet', 'blue', 'green', 'orange', 'ink'));

drop function if exists public.set_club_branding(uuid, text, text, text, boolean);
create function public.set_club_branding(p_club uuid, p_logo_path text default null, p_cover_path text default null,
  p_artwork text default null, p_clear_cover boolean default false, p_tone text default null, p_clear_artwork boolean default false) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := internal.require_user();
begin
  if not authz.is_organizer(p_club, v_user) then raise exception 'organizers only' using errcode = '42501'; end if;
  if (p_logo_path is not null and p_logo_path not like p_club::text || '/%') or (p_cover_path is not null and p_cover_path not like p_club::text || '/%') then
    raise exception 'image outside the club folder' using errcode = '22023';
  end if;
  if p_artwork is not null and p_artwork not in ('trail', 'tide', 'grid', 'peaks', 'dunes', 'city') then raise exception 'unknown artwork' using errcode = '22023'; end if;
  if p_tone is not null and p_tone not in ('violet', 'blue', 'green', 'orange', 'ink') then raise exception 'unknown colour' using errcode = '22023'; end if;
  update public.clubs
     set avatar_path = coalesce(p_logo_path, avatar_path),
         cover_path = case when p_clear_cover then null else coalesce(p_cover_path, cover_path) end,
         artwork = case when p_clear_artwork then null else coalesce(p_artwork, artwork) end,
         tone = coalesce(p_tone, tone)
   where id = p_club;
  perform internal.audit(v_user, 'organizer', 'club_branding_set', 'club', p_club::text,
                         jsonb_build_object('logo', p_logo_path is not null, 'cover', p_cover_path is not null, 'artwork', p_artwork,
                                            'cleared_cover', p_clear_cover, 'tone', p_tone, 'cleared_artwork', p_clear_artwork));
end $$;

-- Community and group details (unchanged apart from the colour).
create or replace function public.club_detail(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
declare
  v_user uuid := auth.uid();
  c public.clubs;
  m public.club_memberships;
  o internal.club_ownership_offers;
begin
  if not authz.can_view_club(p_club, v_user) then return null; end if;
  select * into c from public.clubs where id = p_club;
  select * into m from public.club_memberships where club_id = p_club and user_id = v_user;
  select * into o from internal.club_ownership_offers where club_id = p_club and expires_at > now();
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'name', c.name, 'description', c.description, 'rules', c.rules,
    'visibility', c.visibility, 'join_policy', c.join_policy, 'posting_policy', c.posting_policy,
    'city_label', c.city_label, 'avatar_path', c.avatar_path, 'cover_path', c.cover_path, 'artwork', c.artwork, 'tone', c.tone, 'status', c.status,
    'region_id', c.region_id,
    'my_role', case when m.state = 'active' then m.role end, 'my_state', coalesce(m.state, 'none'),
    'member_count', (select count(*) from public.club_memberships where club_id = p_club and state = 'active'),
    'pending_requests', case when authz.is_organizer(p_club, v_user) then (select count(*) from public.club_memberships where club_id = p_club and state = 'requested') end,
    'competition_id', (select id from public.competitions where club_id = p_club and status = 'active'),
    'organizers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'role', cm.role)), '[]'::jsonb)
                     from public.club_memberships cm join public.profiles p on p.id = cm.user_id
                    where cm.club_id = p_club and cm.state = 'active' and cm.role in ('owner', 'organizer') and p.status = 'active'),
    'ownership_offer', case
      when o.club_id is null then null
      when o.to_user = v_user then jsonb_build_object('to_me', true, 'expires_at', o.expires_at)
      when o.from_user = v_user then jsonb_build_object('to_me', false, 'expires_at', o.expires_at,
                                     'to', (select jsonb_build_object('id', p.id, 'display_name', p.display_name) from public.profiles p where p.id = o.to_user))
      else null end
  );
end $$;

drop function if exists public.discover_clubs(uuid, text, integer);
create function public.discover_clubs(p_district uuid default null, p_query text default null, p_limit integer default 30)
returns table (id uuid, kind text, name text, city_label text, visibility text, join_policy text, member_count bigint, my_state text, avatar_path text, artwork text, tone text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.kind, c.name, c.city_label, c.visibility, c.join_policy,
         (select count(*) from public.club_memberships m where m.club_id = c.id and m.state = 'active'),
         coalesce((select m.state from public.club_memberships m where m.club_id = c.id and m.user_id = auth.uid()), 'none'),
         c.avatar_path, c.artwork, c.tone
    from public.clubs c
   where auth.uid() is not null and c.status = 'active' and c.visibility = 'public' and c.kind = 'community'
     and (p_district is null or c.district_id = p_district)
     and (coalesce(p_query, '') = '' or c.name ilike '%' || replace(p_query, '%', '') || '%')
   order by c.name limit least(p_limit, 50);
$$;

drop function if exists public.my_clubs();
create function public.my_clubs()
returns table (id uuid, kind text, name text, visibility text, role text, state text, member_count bigint, avatar_path text, artwork text, tone text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.kind, c.name, c.visibility, m.role, m.state,
         (select count(*) from public.club_memberships x where x.club_id = c.id and x.state = 'active'),
         c.avatar_path, c.artwork, c.tone
    from public.club_memberships m join public.clubs c on c.id = m.club_id
   where m.user_id = auth.uid() and m.state in ('active', 'invited', 'requested') and c.status <> 'archived'
   order by m.state, c.name;
$$;

drop function if exists public.list_events(text, uuid, uuid);
/** Events a runner can see: running and upcoming ('current'), finished ones, or one club's challenges. */
create function public.list_events(p_scope text default 'current', p_event uuid default null, p_club uuid default null)
returns table (id uuid, name text, description text, event_type text, team_mode text, visibility text, region_id uuid, region_name text,
               host_club_id uuid, host_club_name text, host_avatar_path text, host_tone text, starts_at timestamptz, ends_at timestamptz,
               target_m integer, season_id uuid, phase text, participants bigint, joined boolean, my_club_id uuid, can_manage boolean)
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select c.id, c.name, c.description, c.event_type, c.team_mode, c.visibility, c.region_id, r.name, c.host_club_id, k.name, k.avatar_path, k.tone,
         c.starts_at, c.ends_at, c.target_m, s.id,
         case when c.cancelled_at is not null then 'cancelled'
              when c.status = 'archived' then 'finished'
              when now() < c.starts_at then 'upcoming'
              when now() < c.ends_at then 'live'
              else 'finishing' end,
         (select count(*) from public.event_participants ep where ep.competition_id = c.id and ep.left_at is null),
         exists (select 1 from public.event_participants ep where ep.competition_id = c.id and ep.user_id = auth.uid() and ep.left_at is null),
         (select ep.club_id from public.event_participants ep where ep.competition_id = c.id and ep.user_id = auth.uid() and ep.left_at is null),
         authz.has_role(auth.uid(), 'territory_operator') or (c.host_club_id is not null and authz.is_organizer(c.host_club_id, auth.uid()))
    from public.competitions c
    left join public.regions r on r.id = c.region_id
    left join public.clubs k on k.id = c.host_club_id
    left join lateral (select s2.id from public.seasons s2 where s2.competition_id = c.id order by s2.number limit 1) s on true
   where auth.uid() is not null and c.kind = 'event' and public.can_access_competition(c.id)
     and (p_event is null or c.id = p_event)
     and (p_club is null or c.host_club_id = p_club)
     and (p_event is not null or p_club is not null
          or (coalesce(p_scope, 'current') = 'current' and c.status = 'active')
          or (p_scope = 'finished' and c.status = 'archived'))
   order by case when c.status = 'archived' then 1 else 0 end,
            case when c.status = 'archived' then null else (now() < c.starts_at) end,
            case when c.status = 'archived' then null else c.starts_at end,
            c.ends_at desc
   limit 50;
$$;

-- Posts in a community show its name, logo and colour.
create or replace function internal.post_row_json(p public.posts, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, authz as $$
  select jsonb_build_object(
    'id', p.id, 'audience', p.audience, 'body', p.body, 'status', p.status,
    'author', jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name, 'avatar_path', a.avatar_path),
    'club', case when p.club_id is null then null else (select jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'avatar_path', c.avatar_path, 'tone', c.tone) from public.clubs c where c.id = p.club_id) end,
    'shared_summary', p.shared_summary,
    'shared_route', p.shared_route,
    'shared_land', case when p.shared_land is not null
                         and exists (select 1 from public.loop_claims lc where lc.id = (p.shared_land ->> 'claim_id')::uuid and lc.status = 'eligible')
                        then p.shared_land - 'publish_after' end,
    'route', case when p.route_course_id is null then null else (select jsonb_build_object('id', c.id, 'name', c.name) from public.courses c where c.id = p.route_course_id and c.status = 'active') end,
    'comments_enabled', p.comments_enabled, 'is_announcement', p.is_announcement,
    'published_at', coalesce(p.published_at, p.created_at), 'edited_at', p.edited_at,
    'reaction_count', (select count(*) from public.reactions r where r.post_id = p.id and not authz.is_blocked(r.user_id, p_viewer)),
    'i_reacted', exists (select 1 from public.reactions r where r.post_id = p.id and r.user_id = p_viewer),
    'comment_count', (select count(*) from public.comments cm where cm.post_id = p.id and cm.status = 'visible' and not authz.is_blocked(cm.author_id, p_viewer)),
    'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.derivative_path, 'alt', m.alt_text, 'width', m.width, 'height', m.height, 'status', m.status) order by m.position)
                         from public.post_media m where m.post_id = p.id and (m.status = 'ready' or p.author_id = p_viewer)), '[]'::jsonb),
    'is_mine', p.author_id = p_viewer
  )
  from public.profiles a where a.id = p.author_id;
$$;

-- The functions recreated above start with the default grants: close them again, open them to signed-in users.
do $$
declare
  f text;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array['set_club_branding', 'discover_clubs', 'my_clubs', 'list_events'])
  loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated, service_role';
  end loop;
end $$;
