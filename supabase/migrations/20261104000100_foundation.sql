-- Foundation: extensions, schemas, configuration, identity, consent, privacy masks, staff roles, audit.
-- Exposed tables live in `public` with RLS; internal state lives in `internal`, which is never exposed
-- through the Data API and is reachable only by service_role and SECURITY DEFINER functions.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to service_role;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function internal.touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Runtime configuration and kill switches (PRD §18 "Provide separate switches ...")
-- ---------------------------------------------------------------------------------------------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default true,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value, description) values
  ('paywall_enabled', 'false', 'Free pilot: no feature is gated (PRD §19). Billing remains sandbox-testable.'),
  ('premium_features', '[]', 'Feature keys that require the premium entitlement when paywall_enabled is true. Core competition, social, health, privacy and deletion may never be listed.'),
  ('territory_capture_enabled', 'true', 'Kill switch: land capture (private recording unaffected).'),
  ('speed_titles_enabled', 'true', 'Kill switch: speed titles.'),
  ('public_publication_enabled', 'true', 'Kill switch: publication of competitive results to maps and rankings.'),
  ('photo_uploads_enabled', 'true', 'Kill switch: photo uploads.'),
  ('messaging_enabled', 'true', 'Kill switch: direct messages.'),
  ('disabled_health_cards', '[]', 'Health dashboard cards suspended because of a known data-quality fault.'),
  ('min_supported_app_version', '"0.1.0"', 'Older builds are asked to update.'),
  ('rules_status', '"proposed"', 'All gameplay thresholds are proposed defaults pending field validation (PRD §18).');

-- ---------------------------------------------------------------------------------------------
-- Geography: supported competition regions and districts
-- ---------------------------------------------------------------------------------------------
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  timezone text not null,
  geom extensions.geography(MultiPolygon, 4326) not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Exclusion data must be reviewed before land can be awarded; 'unavailable' fails closed.
  exclusion_review_status text not null default 'unavailable' check (exclusion_review_status in ('reviewed', 'unavailable')),
  exclusion_set_version text,
  created_at timestamptz not null default now()
);
create index regions_geom_idx on public.regions using gist (geom);

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  geom extensions.geography(MultiPolygon, 4326) not null,
  unique (region_id, slug)
);
create index districts_geom_idx on public.districts using gist (geom);

-- ---------------------------------------------------------------------------------------------
-- Identity: public profile separated from private settings and auth data
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique check (handle ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  bio text check (char_length(bio) <= 280),
  avatar_path text,
  district_id uuid references public.districts (id) on delete set null,
  city_label text check (char_length(city_label) <= 60),
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  discoverable boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function internal.touch_updated_at();

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  messages_from text not null default 'mutual' check (messages_from in ('mutual', 'followers', 'nobody')),
  default_post_audience text not null default 'followers' check (default_post_audience in ('only_me', 'followers', 'public')),
  full_private_mode boolean not null default false,
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  analytics_enabled boolean not null default false,
  -- Contest consent flags are written only through set_consent() so they always match the consent ledger.
  territory_competition_enabled boolean not null default false,
  speed_competition_enabled boolean not null default false,
  selected_competition_id uuid,
  updated_at timestamptz not null default now()
);
create trigger user_settings_touch before update on public.user_settings for each row execute function internal.touch_updated_at();

-- Append-only consent ledger (FR01).
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'adult', 'territory_competition', 'speed_competition', 'route_publication', 'analytics', 'marketing', 'health_export')),
  version text not null check (char_length(version) between 1 and 40),
  granted boolean not null,
  created_at timestamptz not null default now()
);
create index consents_user_kind_idx on public.consents (user_id, kind, created_at desc);

-- Private masking areas (PRD §11). Never exposed to anyone but the owner.
create table public.protected_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text check (char_length(label) <= 40),
  center extensions.geography(Point, 4326) not null,
  radius_m integer not null check (radius_m between 100 and 2000),
  geom extensions.geography(Polygon, 4326),
  created_at timestamptz not null default now()
);
create index protected_areas_geom_idx on public.protected_areas using gist (geom);
create index protected_areas_user_idx on public.protected_areas (user_id);

create or replace function internal.protected_area_geom() returns trigger
language plpgsql set search_path = pg_catalog, extensions as $$
begin
  new.geom := extensions.st_buffer(new.center, new.radius_m, 'quad_segs=16')::extensions.geography(Polygon, 4326);
  return new;
end $$;
create trigger protected_areas_geom before insert or update of center, radius_m on public.protected_areas
  for each row execute function internal.protected_area_geom();

-- ---------------------------------------------------------------------------------------------
-- Staff roles (scoped; social roles grant no scoring powers — FR24)
-- ---------------------------------------------------------------------------------------------
create table public.staff_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'route_reviewer', 'integrity_reviewer', 'territory_operator', 'support')),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, role)
);

create table internal.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'staff', 'system', 'organizer')),
  action text not null,
  object_type text not null,
  object_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_object_idx on internal.audit_log (object_type, object_id);
create index audit_log_actor_idx on internal.audit_log (actor_id, created_at desc);

create or replace function internal.audit(p_actor uuid, p_kind text, p_action text, p_object_type text, p_object_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = pg_catalog, internal as $$
  insert into internal.audit_log (actor_id, actor_kind, action, object_type, object_id, details)
  values (p_actor, p_kind, p_action, p_object_type, p_object_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- New auth user → profile, settings and notification preferences
-- ---------------------------------------------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  social boolean not null default true,
  messages boolean not null default true,
  clubs boolean not null default true,
  competitive_digest boolean not null default true,
  territory_loss boolean not null default true,
  marketing boolean not null default false,
  quiet_start time default '22:00',
  quiet_end time default '07:00',
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);
create trigger notification_prefs_touch before update on public.notification_prefs for each row execute function internal.touch_updated_at();

create or replace function internal.handle_new_user() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_handle text := 'runner_' || substr(replace(new.id::text, '-', ''), 1, 10);
begin
  insert into public.profiles (id, handle, display_name) values (new.id, v_handle, 'New runner')
    on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function internal.handle_new_user();
