-- Enhancements, part 3: avatars and runners on the territory map.
--   * A runner's picture is a photo or a cartoon avatar. The cartoon is saved as an image in the runner's
--     own avatars folder (so it shows wherever a profile picture does); its parts are kept to edit it.
--   * The map shows the avatar of each runner holding land in view, with their totals in that layer.

alter table public.profiles
  add column if not exists avatar_kind text check (avatar_kind in ('photo', 'cartoon')),
  add column if not exists avatar_style jsonb,
  add column if not exists avatar_photo_path text;

/** The cartoon parts the app can draw (mirrors AVATAR_OPTIONS in the app; colours are any #RRGGBB). */
create or replace function internal.valid_avatar_style(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and length(p::text) <= 600
    and not exists (select 1 from jsonb_object_keys(p) k
                     where k not in ('bg', 'skin', 'hair', 'hairColor', 'face', 'outfit', 'outfitColor', 'extra', 'extraColor'))
    and coalesce(p ->> 'hair', 'short') in ('short', 'buzz', 'curly', 'bun', 'ponytail', 'long', 'afro', 'bald')
    and coalesce(p ->> 'face', 'smile') in ('smile', 'grin', 'focused', 'wink')
    and coalesce(p ->> 'outfit', 'tee') in ('tee', 'singlet', 'hoodie', 'jacket', 'track')
    and coalesce(p ->> 'extra', 'none') in ('none', 'cap', 'headband', 'sunglasses', 'visor', 'earbuds', 'beanie', 'headscarf')
    and not exists (select 1 from unnest(array['bg', 'skin', 'hairColor', 'outfitColor', 'extraColor']) c
                     where p ? c and (p ->> c) !~ '^#[0-9A-Fa-f]{6}$')
  );
$$;

alter table public.profiles drop constraint if exists profiles_avatar_style_valid;
alter table public.profiles add constraint profiles_avatar_style_valid check (internal.valid_avatar_style(avatar_style));
-- A profile can only point at pictures in its own folder (nobody can borrow another runner's photo).
alter table public.profiles drop constraint if exists profiles_avatar_own_folder;
alter table public.profiles add constraint profiles_avatar_own_folder
  check ((avatar_path is null or avatar_path like id::text || '/%') and (avatar_photo_path is null or avatar_photo_path like id::text || '/%')) not valid;

grant update (avatar_kind, avatar_style, avatar_photo_path) on public.profiles to authenticated;

/**
 * Runners holding land in the map view of one layer (most cells in view first, at most 60), with their
 * picture and their totals in that layer. Blocked runners appear without a name or picture.
 */
create or replace function public.territory_owners_in_view(p_competition uuid, p_season uuid, p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision)
returns table (owner_key text, user_id uuid, handle text, display_name text, avatar_path text, cells_in_view integer,
               cells integer, area_m2 double precision, rank bigint, runners bigint, is_me boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, internal, authz as $$
begin
  if auth.uid() is null or not public.can_access_competition(p_competition) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with inview as (
    select v.controller_id as uid, count(*)::integer as n
      from public.territory_viewport(p_competition, p_season, p_min_lng, p_min_lat, p_max_lng, p_max_lat) v
     where v.controller_id is not null and v.status = 'controlled'
     group by v.controller_id
     order by count(*) desc
     limit 60
  ), areas as (
    select p.controller_id as uid, count(*)::integer as n, sum(tc.area_m2) as area
      from internal.cell_control_public p join internal.territory_cells tc on tc.cell = p.cell
     where p.competition_id = p_competition and p.season_id = p_season and p.status = 'controlled' and p.controller_id is not null
     group by p.controller_id
  ), ranked as (
    select a.uid, a.n, a.area, rank() over (order by round(a.area::numeric, 1) desc) as r, count(*) over () as total from areas a
  )
  select md5(i.uid::text),
         case when authz.is_blocked(i.uid, auth.uid()) then null else i.uid end,
         case when authz.is_blocked(i.uid, auth.uid()) then null else pr.handle::text end,
         case when authz.is_blocked(i.uid, auth.uid()) then 'A runner' else pr.display_name end,
         case when authz.can_view_profile(i.uid, auth.uid()) then pr.avatar_path end,
         i.n, rk.n, rk.area, rk.r, rk.total, i.uid = auth.uid()
    from inview i
    join public.profiles pr on pr.id = i.uid
    left join ranked rk on rk.uid = i.uid
   order by i.n desc;
end $$;

revoke execute on function public.territory_owners_in_view(uuid, uuid, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.territory_owners_in_view(uuid, uuid, double precision, double precision, double precision, double precision) to authenticated;
