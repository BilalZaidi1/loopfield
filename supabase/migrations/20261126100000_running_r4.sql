-- Running features, stage 4 (R4): a speed route from part of a run, shoe mileage, and 3D replay. Only additions:
-- `propose_route` keeps every argument older apps send (the new stretch arguments are optional), and a run with no
-- shoes stays exactly as before. Replay draws the run's own line on the phone, so it only needs its switch.

-- ---------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------
insert into public.app_config (key, value, is_public, description) values
  ('route_proposals_a_to_b', 'false', true, 'On lets runners propose start-to-finish speed routes from part of a run; off allows loops only.'),
  ('gear_enabled', 'true', true, 'Off hides shoes and stops new runs counting towards a pair; runs keep their pairs.'),
  ('gear_max_items', '20', true, 'The most pairs of shoes a runner can have in use (retired pairs do not count).'),
  ('gear_reminder_default_km', '700', true, 'The reminder distance for a new pair of shoes, in km.'),
  ('replay_enabled', 'true', true, 'Off hides Replay on runs.')
on conflict (key) do nothing;

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('route_proposals_a_to_b', 'Start-to-finish speed routes', 'switch', 'boolean', null, null, null, 'config', 21,
   'On lets runners propose part of a run with a separate start and finish; reviewers see a start-to-finish badge. Off allows loops only.'),
  ('gear_enabled', 'Shoe mileage', 'switch', 'boolean', null, null, null, 'territory_operator', 29,
   'Off hides shoes and stops new runs counting towards a pair. Runs keep their pairs and nothing is deleted.'),
  ('replay_enabled', '3D replay', 'switch', 'boolean', null, null, null, 'territory_operator', 30, 'Off hides Replay on runs.'),
  ('gear_max_items', 'Pairs of shoes a runner can have in use', 'limits', 'integer', 1, 100, null, 'config', 98, 'Retired pairs do not count.'),
  ('gear_reminder_default_km', 'Shoe reminder distance for new pairs (km)', 'tunable', 'integer', 300, 1500, null, 'config', 44,
   'Runners can change it for each pair. Reminders come once at 90% and once at 100%.')
on conflict (key) do update set label = excluded.label, category = excluded.category, value_type = excluded.value_type, min_value = excluded.min_value,
  max_value = excluded.max_value, allowed = excluded.allowed, min_role = excluded.min_role, sort = excluded.sort, help = excluded.help;
-- Photo uploads now also cover shoe photos.
update internal.config_registry set help = 'Off blocks new photos on posts and shoes.' where key = 'photo_uploads_enabled' and help = 'Off blocks new photos on posts.';

-- ---------------------------------------------------------------------------------------------
-- 2. A speed route from part of a run
-- ---------------------------------------------------------------------------------------------
-- The phone sends only where the stretch starts and ends, in metres along the run's own route line; the proposal
-- job cuts the stretch from the run's evidence. Both empty means the whole run, as before.
alter table public.route_proposals
  add column from_m double precision check (from_m >= 0),
  add column to_m double precision,
  add constraint route_proposals_stretch check ((from_m is null) = (to_m is null) and (to_m is null or to_m > from_m));

drop function public.propose_route(uuid, text, text, boolean);
create function public.propose_route(p_activity uuid, p_name text, p_consent_version text, p_score_founding_run boolean default false,
                                     p_from_m double precision default null, p_to_m double precision default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_run_m double precision;
  v_id uuid;
begin
  perform internal.enforce_rate_limit(v_user::text, 'route_proposal', 5, 86400);
  select distance_m into v_run_m from public.activities where id = p_activity and user_id = v_user and deleted_at is null and status = 'processed';
  if not found then
    raise exception 'activity must be processed before proposing a route';
  end if;
  if (p_from_m is null) <> (p_to_m is null) then
    raise exception 'Choose where the part of the run starts and where it ends.' using errcode = '22023';
  end if;
  -- A loose bound only: the run's line can be a little longer than its distance (pauses), and the job cuts precisely.
  if p_from_m is not null and (p_from_m < 0 or p_to_m <= p_from_m or p_to_m > coalesce(v_run_m, 0) * 1.25 + 100) then
    raise exception 'The part of the run must start before it ends and lie within the run.' using errcode = '22023';
  end if;
  -- A whole run covers every part of it; parts may not overlap one another.
  if exists (select 1 from public.route_proposals rp
              where rp.source_activity_id = p_activity and rp.status in ('processing', 'pending_review', 'approved')
                and (rp.from_m is null or p_from_m is null or (rp.from_m < p_to_m and p_from_m < rp.to_m))) then
    raise exception 'a proposal for this activity already exists';
  end if;
  insert into public.consents (user_id, kind, version, granted) values (v_user, 'route_publication', p_consent_version, true);
  insert into public.route_proposals (creator_id, source_activity_id, name, consent_version, score_founding_run, from_m, to_m)
  values (v_user, p_activity, btrim(p_name), p_consent_version, p_score_founding_run, p_from_m, p_to_m) returning id into v_id;
  perform internal.enqueue_job('speed', 'build_route_proposal', jsonb_build_object('proposal_id', v_id), 'proposal:' || v_id);
  return v_id;
end $$;

/**
 * The runner's own protected areas as plain coordinates, so the phone can say before submitting whether
 * the chosen part of a run touches one (the proposal job checks again). Nobody else's areas are reachable.
 */
create or replace function public.my_protected_areas() returns table (id uuid, label text, radius_m integer, lat double precision, lng double precision)
language sql stable security definer set search_path = pg_catalog, public as $$
  select pa.id, pa.label, pa.radius_m, extensions.st_y(pa.center::extensions.geometry), extensions.st_x(pa.center::extensions.geometry)
    from public.protected_areas pa where pa.user_id = auth.uid() order by pa.created_at;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Shoe mileage
-- ---------------------------------------------------------------------------------------------
-- Private to the runner: only they can read their pairs, and every change goes through the functions below.
create table public.gear (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'shoe' check (kind in ('shoe')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  start_distance_m double precision not null default 0 check (start_distance_m between 0 and 10000000),
  reminder_m double precision not null check (reminder_m between 50000 and 5000000),
  is_default boolean not null default false,
  retired_at timestamptz,
  -- When each reminder was sent (or passed over because the pair was already beyond it when edited).
  reminded_90_at timestamptz,
  reminded_100_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gear_user_idx on public.gear (user_id, created_at);
create unique index gear_one_default on public.gear (user_id) where is_default and retired_at is null;
create trigger gear_touch before update on public.gear for each row execute function internal.touch_updated_at();
alter table public.gear enable row level security;
revoke all on public.gear from anon, authenticated;
grant select on public.gear to authenticated;
create policy gear_own_read on public.gear for select to authenticated using (user_id = (select auth.uid()));

alter table public.activities add column gear_id uuid references public.gear (id) on delete set null;
create index activities_gear_idx on public.activities (gear_id) where gear_id is not null;

/** A pair's distance: what was on it when added, plus every run counted towards it. */
create or replace function internal.gear_total_m(p_gear uuid) returns double precision
language sql stable security definer set search_path = pg_catalog, public as $$
  select g.start_distance_m + coalesce((select sum(a.distance_m) from public.activities a
                                         where a.gear_id = g.id and a.deleted_at is null and a.distance_m is not null), 0)
    from public.gear g where g.id = p_gear;
$$;

/**
 * The 90% and 100% reminders, once each, when runs take a pair past them. Both at once sends only the
 * 100% one; retired pairs and a paused switch send none. Editing a pair re-arms them (see save_gear).
 */
create or replace function internal.check_gear_reminders(p_gear uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  g public.gear;
  v_total double precision;
begin
  select * into g from public.gear where id = p_gear for update;
  if not found or g.retired_at is not null or not internal.config_bool('gear_enabled', true) then return; end if;
  v_total := internal.gear_total_m(p_gear);
  if v_total >= g.reminder_m and g.reminded_100_at is null then
    update public.gear set reminded_100_at = now(), reminded_90_at = coalesce(reminded_90_at, now()) where id = p_gear;
    perform internal.notify(g.user_id, 'system', 'gear_reminder', null, 'gear', p_gear::text, jsonb_build_object('percent', 100), null);
  elsif v_total >= 0.9 * g.reminder_m and g.reminded_90_at is null then
    update public.gear set reminded_90_at = now() where id = p_gear;
    perform internal.notify(g.user_id, 'system', 'gear_reminder', null, 'gear', p_gear::text, jsonb_build_object('percent', 90), null);
  end if;
end $$;

-- Every new run counts towards the runner's default pair, with no question asked.
create or replace function internal.activity_default_gear() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.gear_id is null and internal.config_bool('gear_enabled', true) then
    new.gear_id := (select id from public.gear where user_id = new.user_id and is_default and retired_at is null limit 1);
  end if;
  return new;
end $$;
create trigger activities_default_gear before insert on public.activities for each row execute function internal.activity_default_gear();

-- A run's distance or pair changing moves the totals, which may bring a reminder. A reminder that cannot be
-- sent never holds up the run itself.
create or replace function internal.activity_gear_changed() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.gear_id is null then return null; end if;
  begin
    perform internal.check_gear_reminders(new.gear_id);
  exception when others then
    raise warning 'gear reminder skipped: %', sqlerrm;
  end;
  return null;
end $$;
create trigger activities_gear_changed after insert or update of gear_id, distance_m, deleted_at on public.activities
  for each row execute function internal.activity_gear_changed();

/**
 * Adds a pair (p_id empty) or changes one. Making a pair the default unsets the previous default. After
 * any change the reminders are re-armed against the new total: one already passed is marked as sent
 * without a notification (the runner is looking at the number), one not yet reached will come.
 */
create or replace function public.save_gear(p_id uuid, p_name text, p_start_distance_m double precision default 0,
                                            p_reminder_m double precision default null, p_default boolean default false) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_id uuid := p_id;
  v_max integer := internal.config_int('gear_max_items', 20);
  v_reminder double precision := coalesce(p_reminder_m, internal.config_int('gear_reminder_default_km', 700) * 1000.0);
  v_total double precision;
begin
  if not internal.config_bool('gear_enabled', true) then
    raise exception 'feature_paused' using errcode = '55000', detail = 'gear_enabled', hint = 'This is switched off for now. Please try again later.';
  end if;
  if v_id is null then
    if (select count(*) from public.gear where user_id = v_user and retired_at is null) >= v_max then
      raise exception 'You already have % pairs of shoes in use. Retire one first.', v_max using errcode = '23514';
    end if;
    if (select count(*) from public.gear where user_id = v_user) >= v_max * 5 then
      raise exception 'You have a lot of retired shoes. Delete some first.' using errcode = '23514';
    end if;
    insert into public.gear (user_id, name, start_distance_m, reminder_m) values (v_user, btrim(p_name), coalesce(p_start_distance_m, 0), v_reminder)
    returning id into v_id;
  else
    update public.gear set name = btrim(p_name), start_distance_m = coalesce(p_start_distance_m, start_distance_m), reminder_m = v_reminder
     where id = v_id and user_id = v_user;
    if not found then raise exception 'shoes not found' using errcode = '42501'; end if;
  end if;
  if p_default then
    update public.gear set is_default = false where user_id = v_user and is_default and id <> v_id;
    update public.gear set is_default = true, retired_at = null where id = v_id;
  elsif p_id is not null then
    update public.gear set is_default = false where id = v_id and is_default;
  end if;
  v_total := internal.gear_total_m(v_id);
  update public.gear set
    reminded_90_at = case when v_total >= 0.9 * reminder_m then coalesce(reminded_90_at, now()) end,
    reminded_100_at = case when v_total >= reminder_m then coalesce(reminded_100_at, now()) end
   where id = v_id;
  return v_id;
end $$;

/** Retiring stops a pair counting new runs (and being the default) but keeps its history; false puts it back in use. */
create or replace function public.retire_gear(p_id uuid, p_retired boolean default true) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_max integer := internal.config_int('gear_max_items', 20);
begin
  if p_retired then
    update public.gear set retired_at = coalesce(retired_at, now()), is_default = false where id = p_id and user_id = v_user;
  else
    if (select count(*) from public.gear where user_id = v_user and retired_at is null and id <> p_id) >= v_max then
      raise exception 'You already have % pairs of shoes in use. Retire one first.', v_max using errcode = '23514';
    end if;
    update public.gear set retired_at = null where id = p_id and user_id = v_user;
  end if;
  if not found then raise exception 'shoes not found' using errcode = '42501'; end if;
end $$;

/** Deletes a pair; its runs keep their distances and simply no longer count towards it. The phone removes the photo. */
create or replace function public.delete_gear(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  delete from public.gear where id = p_id and user_id = v_user;
  if not found then raise exception 'shoes not found' using errcode = '42501'; end if;
end $$;

/** The pair's photo, in the runner's own folder of the private `gear-photos` bucket (or none). */
create or replace function public.set_gear_photo(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
begin
  if p_path is not null then
    if not internal.config_bool('photo_uploads_enabled', true) or not internal.config_bool('gear_enabled', true) then
      raise exception 'feature_paused' using errcode = '55000', detail = 'photo_uploads_enabled', hint = 'This is switched off for now. Please try again later.';
    end if;
    if split_part(p_path, '/', 1) <> v_user::text or p_path like '%..%' or p_path !~ '^[0-9a-f-]+/[A-Za-z0-9_-]+\.jpg$' then
      raise exception 'photos go in your own folder' using errcode = '42501';
    end if;
  end if;
  update public.gear set photo_path = p_path where id = p_id and user_id = v_user;
  if not found then raise exception 'shoes not found' using errcode = '42501'; end if;
end $$;

/** Changes which pair a run counts towards (or none): the runner's own run and a pair in use (or the run's current one). */
create or replace function public.set_run_gear(p_activity uuid, p_gear uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := internal.require_user();
  v_current uuid;
begin
  if not internal.config_bool('gear_enabled', true) then
    raise exception 'feature_paused' using errcode = '55000', detail = 'gear_enabled', hint = 'This is switched off for now. Please try again later.';
  end if;
  select gear_id into v_current from public.activities where id = p_activity and user_id = v_user and deleted_at is null for update;
  if not found then raise exception 'run not found' using errcode = '42501'; end if;
  if p_gear is not null and not exists (select 1 from public.gear where id = p_gear and user_id = v_user and (retired_at is null or id = v_current)) then
    raise exception 'shoes not found' using errcode = '42501';
  end if;
  if p_gear is distinct from v_current then
    update public.activities set gear_id = p_gear where id = p_activity;
  end if;
end $$;

/** The runner's pairs with their distance and number of runs: in use first (the default at the top), then retired. */
create or replace function public.my_gear() returns table (
  id uuid, name text, photo_path text, start_distance_m double precision, reminder_m double precision, is_default boolean,
  retired_at timestamptz, distance_m double precision, runs integer, created_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public, internal as $$
  select g.id, g.name, g.photo_path, g.start_distance_m, g.reminder_m, g.is_default, g.retired_at,
         internal.gear_total_m(g.id),
         (select count(*)::int from public.activities a where a.gear_id = g.id and a.deleted_at is null),
         g.created_at
    from public.gear g
   where g.user_id = auth.uid()
   order by g.retired_at is not null, g.is_default desc, g.retired_at desc nulls first, g.created_at;
$$;

-- Photos: `gear-photos/<user_id>/<file>.jpg`, reachable only by the runner, new ones only while photo uploads are on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gear-photos', 'gear-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
create policy gear_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'gear-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy gear_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'gear-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and authz.feature_enabled('photo_uploads_enabled') and authz.feature_enabled('gear_enabled'));
create policy gear_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'gear-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'gear-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and authz.feature_enabled('photo_uploads_enabled') and authz.feature_enabled('gear_enabled'));
create policy gear_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'gear-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function internal.gear_total_m(uuid), internal.check_gear_reminders(uuid), internal.activity_default_gear(),
  internal.activity_gear_changed() from public, anon, authenticated;
grant execute on function internal.gear_total_m(uuid), internal.check_gear_reminders(uuid), internal.activity_default_gear(),
  internal.activity_gear_changed() to service_role;
do $$
declare
  f text;
  rpc text[] := array['propose_route', 'my_protected_areas', 'save_gear', 'retire_gear', 'delete_gear', 'set_gear_photo', 'set_run_gear', 'my_gear'];
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (rpc)
  loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
grant execute on all functions in schema public to service_role;
