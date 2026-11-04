-- Social space: clubs and local communities, follows, blocks, mutes, posts, media, comments,
-- reactions, mentions, direct-message metadata (Stream Chat holds message bodies), reports,
-- moderation, notifications and push tokens. Membership, following and territory are independent.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('club', 'community')),
  name text not null check (char_length(btrim(name)) between 3 and 60),
  description text check (char_length(description) <= 1000),
  rules text check (char_length(rules) <= 2000),
  visibility text not null check (visibility in ('public', 'private')),
  join_policy text not null default 'request' check (join_policy in ('open', 'request', 'invite_only')),
  posting_policy text not null default 'members' check (posting_policy in ('members', 'organizers')),
  region_id uuid references public.regions (id),
  district_id uuid references public.districts (id) on delete set null,
  city_label text check (char_length(city_label) <= 60),
  avatar_path text,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (visibility = 'private' and join_policy = 'open'))
);
create index clubs_district_idx on public.clubs (district_id) where status = 'active';
create trigger clubs_touch before update on public.clubs for each row execute function internal.touch_updated_at();

alter table public.competitions add constraint competitions_club_fk foreign key (club_id) references public.clubs (id) on delete cascade;
create unique index competitions_one_per_club on public.competitions (club_id) where kind = 'club';

create table public.club_memberships (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'organizer', 'member')),
  state text not null check (state in ('active', 'invited', 'requested', 'removed', 'left', 'declined')),
  invited_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_memberships_user_idx on public.club_memberships (user_id, state);
create trigger club_memberships_touch before update on public.club_memberships for each row execute function internal.touch_updated_at();

-- Email invitations to people who may not have an account yet. Raw addresses are never stored.
create table internal.club_email_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  inviter_id uuid references public.profiles (id) on delete set null,
  email_hash text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_by uuid,
  created_at timestamptz not null default now(),
  unique (club_id, email_hash)
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  state text not null check (state in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id, state);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.user_mutes (
  muter_id uuid not null references public.profiles (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  audience text not null check (audience in ('only_me', 'followers', 'public', 'club')),
  club_id uuid references public.clubs (id) on delete cascade,
  body text check (char_length(body) <= 2000),
  activity_id uuid references public.activities (id) on delete set null,
  shared_summary jsonb,
  route_course_id uuid references public.courses (id) on delete set null,
  comments_enabled boolean not null default true,
  is_announcement boolean not null default false,
  status text not null default 'published' check (status in ('processing', 'published', 'removed', 'deleted')),
  removed_reason text,
  publish_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  published_at timestamptz,
  check ((audience = 'club') = (club_id is not null)),
  check (not is_announcement or audience = 'club')
);
create index posts_author_idx on public.posts (author_id, published_at desc) where status = 'published';
create index posts_club_idx on public.posts (club_id, published_at desc) where status = 'published';
create index posts_public_idx on public.posts (published_at desc) where status = 'published' and audience = 'public';
create trigger posts_touch before update on public.posts for each row execute function internal.touch_updated_at();

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  upload_path text not null,
  derivative_path text,
  width integer,
  height integer,
  bytes integer,
  alt_text text check (char_length(alt_text) <= 500),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'rejected')),
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible', 'removed', 'deleted')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_post_idx on public.comments (post_id, created_at);

create table public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'cheer' check (kind in ('cheer')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.mentions (
  id bigint generated always as identity primary key,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((post_id is not null) <> (comment_id is not null))
);

create table public.club_pins (
  club_id uuid not null references public.clubs (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz not null default now(),
  primary key (club_id, post_id)
);

-- Direct-message metadata; message bodies live in Stream Chat.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  member_a uuid not null references public.profiles (id) on delete cascade,
  member_b uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  frozen boolean not null default false,
  frozen_reason text,
  created_at timestamptz not null default now(),
  check (member_a < member_b),
  unique (member_a, member_b)
);

create table public.conversation_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  muted boolean not null default false,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

-- ---------------------------------------------------------------------------------------------
-- Reports and moderation (PRD §11, FR44)
-- ---------------------------------------------------------------------------------------------
create table public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  object_type text not null check (object_type in ('post', 'comment', 'profile', 'message', 'club', 'route', 'area', 'media')),
  object_id text not null,
  subject_user_id uuid references public.profiles (id) on delete set null,
  priority text not null default 'normal' check (priority in ('urgent', 'normal')),
  status text not null default 'open' check (status in ('open', 'in_review', 'actioned', 'dismissed')),
  assigned_to uuid references public.profiles (id) on delete set null,
  report_count integer not null default 0,
  outcome text,
  outcome_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index moderation_cases_open_object_idx on public.moderation_cases (object_type, object_id) where status in ('open', 'in_review');
create index moderation_cases_queue_idx on public.moderation_cases (status, priority, created_at);

-- Restricted evidence (e.g. a reported message and minimal context). Never readable by clients.
create table internal.moderation_evidence (
  case_id uuid not null references public.moderation_cases (id) on delete cascade,
  captured_at timestamptz not null default now(),
  evidence jsonb not null,
  primary key (case_id, captured_at)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  object_type text not null check (object_type in ('post', 'comment', 'profile', 'message', 'club', 'route', 'area', 'media')),
  object_id text not null,
  category text not null check (category in ('harassment', 'spam', 'unsafe_area', 'privacy', 'impersonation', 'hate', 'sexual', 'violence', 'self_harm', 'cheating', 'other')),
  details text check (char_length(details) <= 1000),
  case_id uuid references public.moderation_cases (id) on delete set null,
  status text not null default 'submitted' check (status in ('submitted', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

create table internal.moderation_actions (
  id bigint generated always as identity primary key,
  case_id uuid references public.moderation_cases (id) on delete cascade,
  actor_id uuid,
  action text not null,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('social', 'message', 'club', 'competitive', 'system')),
  kind text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  object_type text,
  object_id text,
  data jsonb not null default '{}',
  dedupe_key text,
  read_at timestamptz,
  push_state text not null default 'pending' check (push_state in ('pending', 'sent', 'suppressed', 'failed', 'not_applicable')),
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index push_tokens_user_idx on public.push_tokens (user_id) where disabled_at is null;
