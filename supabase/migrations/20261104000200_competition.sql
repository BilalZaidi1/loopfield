-- Competition model: competitions, seasons, exclusions, recording evidence, land claims and control,
-- exploration, route proposals, courses, speed attempts and titles, integrity cases and appeals.
-- Land (cells) and speed (titles) are separate ledgers; neither can mutate the other (PRD §16).

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('public', 'club')),
  region_id uuid not null references public.regions (id),
  club_id uuid, -- FK added with clubs
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  check ((kind = 'club') = (club_id is not null))
);
create unique index competitions_one_public_per_region on public.competitions (region_id) where kind = 'public';

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  number integer not null check (number > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'settling', 'settled')),
  -- Frozen per season (PRD §6/§17).
  grid_resolution smallint not null default 11 check (grid_resolution between 9 and 12),
  boundary_band_m double precision not null default 10 check (boundary_band_m between 0 and 50),
  territory_rules_version text not null,
  speed_rules_version text not null,
  exclusion_set_version text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (competition_id, number),
  check (ends_at > starts_at),
  exclude using gist (competition_id with =, tstzrange(starts_at, ends_at) with &&)
);
create index seasons_competition_time_idx on public.seasons (competition_id, starts_at desc);

create table public.exclusion_zones (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  set_version text not null,
  kind text not null check (kind in ('restricted', 'sensitive', 'dangerous', 'private_property', 'safety_override', 'other')),
  geom extensions.geography(MultiPolygon, 4326) not null,
  reason text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index exclusion_zones_geom_idx on public.exclusion_zones using gist (geom);
create index exclusion_zones_region_set_idx on public.exclusion_zones (region_id, set_version) where active;

-- Ownership grid cells, created on demand by the worker (H3 index stored as bigint).
create table internal.territory_cells (
  cell bigint primary key,
  resolution smallint not null,
  geom extensions.geometry(Polygon, 4326) not null,
  area_m2 double precision not null,
  parent_r7 bigint not null
);
create index territory_cells_geom_idx on internal.territory_cells using gist (geom);

-- ---------------------------------------------------------------------------------------------
-- Recording evidence
-- ---------------------------------------------------------------------------------------------
create table internal.recording_sessions (
  ticket_id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  modes jsonb not null,
  competition_id uuid not null references public.competitions (id),
  season_id uuid not null references public.seasons (id),
  course_version_id uuid,
  territory_rules_version text not null,
  speed_rules_version text not null,
  issued_at timestamptz not null,
  start_by timestamptz not null,
  signature text not null,
  consumed_by_activity uuid unique,
  created_at timestamptz not null default now()
);
create index recording_sessions_user_idx on internal.recording_sessions (user_id, issued_at desc);

create table public.activities (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticket_id uuid unique,
  modes jsonb not null default '{"territory": false, "speed": false}',
  competition_id uuid references public.competitions (id),
  season_id uuid references public.seasons (id),
  course_version_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  status text not null default 'receiving' check (status in ('receiving', 'received', 'processing', 'processed', 'failed', 'deleted')),
  distance_m double precision,
  elapsed_ms bigint,
  moving_ms bigint,
  paused_ms bigint,
  avg_pace_s_per_km integer,
  elevation_gain_m integer,
  splits jsonb,
  gaps jsonb,
  sample_count integer,
  usable_sample_count integer,
  summary_source text not null default 'device' check (summary_source in ('device', 'server')),
  personal_route text,
  title text check (char_length(title) <= 80),
  notes text check (char_length(notes) <= 1000),
  perceived_effort smallint check (perceived_effort between 1 and 10),
  evidence_digest text,
  expected_chunks integer,
  received_at timestamptz,
  device jsonb,
  events jsonb,
  raw_evidence_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_at >= started_at)
);
create unique index activities_user_digest_idx on public.activities (user_id, evidence_digest) where evidence_digest is not null and deleted_at is null;
create index activities_user_started_idx on public.activities (user_id, started_at desc) where deleted_at is null;
create trigger activities_touch before update on public.activities for each row execute function internal.touch_updated_at();

create table internal.activity_chunks (
  activity_id uuid not null references public.activities (id) on delete cascade,
  idx integer not null check (idx >= 0),
  seq_from integer not null,
  seq_to integer not null,
  digest text not null,
  storage_path text not null,
  bytes integer not null,
  received_at timestamptz not null default now(),
  primary key (activity_id, idx),
  check (seq_to >= seq_from)
);

-- ---------------------------------------------------------------------------------------------
-- Land: loop claims, frozen cell sets, current and published control, auditable events
-- ---------------------------------------------------------------------------------------------
create table public.loop_claims (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null unique references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  competition_id uuid not null references public.competitions (id),
  season_id uuid references public.seasons (id),
  status text not null default 'processing' check (status in ('processing', 'eligible', 'pending_review', 'unranked', 'invalid', 'withheld_privacy', 'withdrawn')),
  reasons text[] not null default '{}',
  rule_version text not null,
  algorithm_version text,
  grid_resolution smallint,
  boundary_band_m double precision,
  exclusion_set_version text,
  completed_at timestamptz,
  received_at timestamptz not null,
  validated_at timestamptz,
  publish_after timestamptz,
  published_at timestamptz,
  provisional_until timestamptz,
  polygon extensions.geometry(Polygon, 4326),
  raw_area_m2 double precision,
  eligible_area_m2 double precision,
  eligible_cell_count integer,
  length_m double precision,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loop_claims_comp_season_idx on public.loop_claims (competition_id, season_id, status);
create index loop_claims_user_idx on public.loop_claims (user_id, created_at desc);
create trigger loop_claims_touch before update on public.loop_claims for each row execute function internal.touch_updated_at();

create table internal.claim_cells (
  claim_id uuid not null references public.loop_claims (id) on delete cascade,
  cell bigint not null,
  primary key (claim_id, cell)
);
create index claim_cells_cell_idx on internal.claim_cells (cell);

create table internal.cell_control (
  competition_id uuid not null,
  season_id uuid not null,
  cell bigint not null,
  controller_id uuid,
  claim_id uuid,
  claim_completed_at timestamptz,
  status text not null default 'controlled' check (status in ('controlled', 'excluded')),
  updated_at timestamptz not null default now(),
  primary key (competition_id, season_id, cell)
);
create index cell_control_controller_idx on internal.cell_control (competition_id, season_id, controller_id);

-- Published snapshot: only claims whose publication delay has elapsed (PRD §6, §11).
create table internal.cell_control_public (
  competition_id uuid not null,
  season_id uuid not null,
  cell bigint not null,
  controller_id uuid,
  claim_id uuid,
  status text not null default 'controlled' check (status in ('controlled', 'excluded')),
  published_at timestamptz not null default now(),
  primary key (competition_id, season_id, cell)
);
create index cell_control_public_controller_idx on internal.cell_control_public (competition_id, season_id, controller_id);

create table internal.territory_events (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  season_id uuid not null,
  claim_id uuid,
  kind text not null check (kind in ('capture', 'correction', 'invalidation', 'exclusion', 'withdrawal', 'season_reset')),
  actor_id uuid,
  reason text,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  publish_after timestamptz not null default now(),
  published_at timestamptz
);
create index territory_events_due_idx on internal.territory_events (publish_after) where published_at is null;
create index territory_events_claim_idx on internal.territory_events (claim_id);

create table internal.territory_event_cells (
  event_id uuid not null references internal.territory_events (id) on delete cascade,
  cell bigint not null,
  prior_controller uuid,
  new_controller uuid,
  prior_claim uuid,
  new_claim uuid,
  primary key (event_id, cell)
);
create index territory_event_cells_prior_idx on internal.territory_event_cells (prior_controller);
create index territory_event_cells_new_idx on internal.territory_event_cells (new_controller);

-- Private exploration (visited ground), independent of competitive losses (FR19).
create table public.exploration_cells (
  user_id uuid not null references public.profiles (id) on delete cascade,
  cell bigint not null,
  first_visited_at timestamptz not null,
  last_visited_at timestamptz not null,
  visits integer not null default 1,
  primary key (user_id, cell)
);

create table internal.exploration_sources (
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null,
  cell bigint not null,
  visited_at timestamptz not null,
  primary key (activity_id, cell)
);
create index exploration_sources_user_cell_idx on internal.exploration_sources (user_id, cell);

-- ---------------------------------------------------------------------------------------------
-- Speed: proposals, canonical courses, immutable versions, attempts, titles
-- ---------------------------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id),
  creator_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 3 and 60),
  status text not null default 'active' check (status in ('active', 'suspended', 'withdrawn')),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger courses_touch before update on public.courses for each row execute function internal.touch_updated_at();

create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  version integer not null,
  path extensions.geometry(LineString, 4326) not null,
  length_m double precision not null,
  closed boolean not null,
  start_gate extensions.geometry(LineString, 4326) not null,
  finish_gate extensions.geometry(LineString, 4326) not null,
  start_bearing double precision not null,
  finish_bearing double precision not null,
  checkpoints jsonb not null,
  corridor_m double precision not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'retired')),
  published_at timestamptz not null default now(),
  unique (course_id, version)
);
create index course_versions_path_idx on public.course_versions using gist (path);
alter table public.courses add constraint courses_current_version_fk foreign key (current_version_id) references public.course_versions (id) deferrable initially deferred;

-- Accepted geometry, direction and gates are immutable (FR10).
create or replace function internal.course_version_immutable() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.path is distinct from old.path or new.start_gate is distinct from old.start_gate
     or new.finish_gate is distinct from old.finish_gate or new.checkpoints is distinct from old.checkpoints
     or new.corridor_m is distinct from old.corridor_m or new.start_bearing is distinct from old.start_bearing
     or new.finish_bearing is distinct from old.finish_bearing or new.version is distinct from old.version
     or new.course_id is distinct from old.course_id then
    raise exception 'course versions are immutable; publish a new version instead' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger course_versions_immutable before update on public.course_versions for each row execute function internal.course_version_immutable();

create table public.route_proposals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  source_activity_id uuid not null references public.activities (id) on delete cascade,
  region_id uuid references public.regions (id),
  name text not null check (char_length(name) between 3 and 60),
  -- Geometry is built server-side from validated evidence; clients never supply route geometry.
  path extensions.geometry(LineString, 4326),
  closed boolean,
  length_m double precision,
  course_geometry jsonb,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  score_founding_run boolean not null default false,
  status text not null default 'processing' check (status in ('processing', 'pending_review', 'duplicate_linked', 'approved', 'declined', 'withdrawn')),
  canonical_course_id uuid references public.courses (id),
  decision_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index route_proposals_status_idx on public.route_proposals (status, created_at);
create index route_proposals_creator_idx on public.route_proposals (creator_id, created_at desc);

create table public.speed_attempts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_version_id uuid not null references public.course_versions (id),
  competition_id uuid not null references public.competitions (id),
  season_id uuid references public.seasons (id),
  status text not null default 'processing' check (status in ('processing', 'eligible', 'pending_review', 'unranked', 'invalid', 'withdrawn')),
  reasons text[] not null default '{}',
  rule_version text not null,
  algorithm_version text,
  start_crossing_at timestamptz,
  completed_at timestamptz,
  elapsed_ms integer,
  uncertainty_ms integer,
  coverage numeric(5, 3),
  is_founding boolean not null default false,
  received_at timestamptz not null,
  validated_at timestamptz,
  publish_after timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, course_version_id)
);
create index speed_attempts_title_idx on public.speed_attempts (course_version_id, competition_id, season_id, status);
create trigger speed_attempts_touch before update on public.speed_attempts for each row execute function internal.touch_updated_at();

-- Authoritative and published title state per course version, competition and season.
create table internal.speed_titles (
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  competition_id uuid not null,
  season_id uuid not null,
  champion_id uuid,
  benchmark_attempt_id uuid,
  benchmark_ms integer,
  benchmark_uncertainty_ms integer,
  updated_at timestamptz not null default now(),
  published_champion_id uuid,
  published_benchmark_attempt_id uuid,
  published_benchmark_ms integer,
  published_benchmark_uncertainty_ms integer,
  published_at timestamptz,
  primary key (course_version_id, competition_id, season_id)
);

create table internal.speed_title_changes (
  id bigint generated always as identity primary key,
  course_version_id uuid not null,
  competition_id uuid not null,
  season_id uuid not null,
  kind text not null check (kind in ('initial', 'takeover', 'improvement', 'correction', 'vacated')),
  prior_champion uuid,
  new_champion uuid,
  attempt_id uuid,
  benchmark_ms integer,
  margin_ms integer,
  cause text,
  publish_after timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index speed_title_changes_due_idx on internal.speed_title_changes (publish_after) where published_at is null;

-- ---------------------------------------------------------------------------------------------
-- Integrity and appeals (PRD §12)
-- ---------------------------------------------------------------------------------------------
create table public.integrity_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('loop_claim', 'speed_attempt', 'activity', 'account', 'area', 'route')),
  object_id uuid not null,
  subject_user_id uuid references public.profiles (id) on delete set null,
  opened_by text not null check (opened_by in ('system', 'report', 'appeal', 'staff')),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  resolution text check (resolution in ('upheld', 'overturned', 'invalidated', 'no_action')),
  hold_from_competition boolean not null default false,
  assigned_to uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index integrity_cases_status_idx on public.integrity_cases (status, created_at);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  object_type text not null check (object_type in ('loop_claim', 'speed_attempt', 'post', 'comment', 'account_action', 'route_proposal', 'moderation_case')),
  object_id uuid not null,
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'upheld', 'overturned', 'withdrawn')),
  response text,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, object_type, object_id)
);
create index appeals_status_idx on public.appeals (status, created_at);
