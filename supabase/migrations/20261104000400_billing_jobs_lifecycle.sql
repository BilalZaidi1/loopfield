-- Billing entitlements (RevenueCat), durable jobs, webhook idempotency, email delivery,
-- rate limits, data export and account deletion.

create table public.entitlements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  entitlement text not null,
  is_active boolean not null default false,
  status text not null default 'none' check (status in ('active', 'grace', 'billing_issue', 'cancelled_active', 'expired', 'refunded', 'none')),
  product_id text,
  store text,
  period_type text,
  environment text,
  expires_at timestamptz,
  grace_expires_at timestamptz,
  will_renew boolean not null default false,
  billing_issue_at timestamptz,
  refunded_at timestamptz,
  last_event_ms bigint not null default 0,
  source text not null default 'webhook' check (source in ('webhook', 'reconciliation')),
  updated_at timestamptz not null default now(),
  primary key (user_id, entitlement)
);

create table internal.billing_events (
  event_id text primary key,
  app_user_id text not null,
  type text not null,
  event_timestamp_ms bigint not null,
  environment text,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'applied', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index billing_events_user_idx on internal.billing_events (app_user_id, event_timestamp_ms);

-- ---------------------------------------------------------------------------------------------
-- Durable jobs: SKIP LOCKED queue with visibility timeout, retries with backoff and dead-lettering.
-- Territory, speed, publication, social, notification, media, email, chat and account work use
-- separate queues so one busy subsystem cannot delay another (PRD §16).
-- ---------------------------------------------------------------------------------------------
create table internal.jobs (
  id bigint generated always as identity primary key,
  queue text not null check (queue in ('territory', 'speed', 'publication', 'social', 'notifications', 'media', 'email', 'chat', 'account', 'billing', 'maintenance')),
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index jobs_dedupe_idx on internal.jobs (queue, dedupe_key) where dedupe_key is not null and status in ('queued', 'running');
create index jobs_ready_idx on internal.jobs (queue, run_at) where status = 'queued';
create index jobs_running_idx on internal.jobs (locked_at) where status = 'running';

create or replace function internal.enqueue_job(p_queue text, p_kind text, p_payload jsonb default '{}', p_dedupe_key text default null, p_run_at timestamptz default now(), p_max_attempts integer default 8)
returns bigint language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v_id bigint;
begin
  insert into internal.jobs (queue, kind, payload, dedupe_key, run_at, max_attempts)
  values (p_queue, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_run_at, now()), p_max_attempts)
  on conflict (queue, dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do update
    set run_at = least(internal.jobs.run_at, excluded.run_at), payload = excluded.payload, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Claim up to p_limit ready jobs. Stale running jobs (worker died) become claimable after the visibility timeout.
create or replace function internal.claim_jobs(p_worker text, p_queues text[], p_limit integer default 10, p_visibility_seconds integer default 300)
returns setof internal.jobs language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  return query
  with candidates as (
    select j.id from internal.jobs j
    where j.queue = any (p_queues)
      and ((j.status = 'queued' and j.run_at <= now())
        or (j.status = 'running' and j.locked_at < now() - make_interval(secs => p_visibility_seconds)))
    order by j.run_at, j.id
    for update skip locked
    limit p_limit
  )
  update internal.jobs j
     set status = 'running', locked_by = p_worker, locked_at = now(), attempts = j.attempts + 1, updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end $$;

create or replace function internal.complete_job(p_id bigint, p_worker text)
returns void language sql security definer set search_path = pg_catalog, internal as $$
  update internal.jobs set status = 'succeeded', finished_at = now(), updated_at = now(), last_error = null
   where id = p_id and locked_by = p_worker and status = 'running';
$$;

create or replace function internal.fail_job(p_id bigint, p_worker text, p_error text, p_retryable boolean default true)
returns void language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v_job internal.jobs;
begin
  select * into v_job from internal.jobs where id = p_id and locked_by = p_worker and status = 'running' for update;
  if not found then return; end if;
  if not p_retryable or v_job.attempts >= v_job.max_attempts then
    update internal.jobs set status = 'dead', last_error = left(p_error, 2000), finished_at = now(), updated_at = now() where id = p_id;
  else
    -- Exponential backoff with a 30-minute ceiling.
    update internal.jobs
       set status = 'queued', locked_by = null, locked_at = null, last_error = left(p_error, 2000), updated_at = now(),
           run_at = now() + make_interval(secs => least(1800, (2 ^ v_job.attempts)::integer * 5))
     where id = p_id;
  end if;
end $$;

-- Webhook idempotency for providers that deliver at least once.
create table internal.webhook_events (
  provider text not null check (provider in ('stream', 'revenuecat', 'resend', 'supabase_auth')),
  event_id text not null,
  event_type text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Email delivery log and suppression list (hashes only; no raw addresses at rest).
create table internal.email_log (
  id uuid primary key default gen_random_uuid(),
  to_hash text not null,
  template text not null,
  provider_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index email_log_provider_idx on internal.email_log (provider_id) where provider_id is not null;

create table internal.email_suppressions (
  email_hash text primary key,
  reason text not null check (reason in ('bounced', 'complained', 'unsubscribed')),
  created_at timestamptz not null default now()
);

-- Fixed-window rate limits keyed by subject and action.
create table internal.rate_limits (
  subject text not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (subject, action, window_start)
);

create or replace function internal.check_rate_limit(p_subject text, p_action text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into internal.rate_limits (subject, action, window_start, count) values (p_subject, p_action, v_window, 1)
  on conflict (subject, action, window_start) do update set count = internal.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end $$;

create or replace function internal.enforce_rate_limit(p_subject text, p_action text, p_limit integer, p_window_seconds integer)
returns void language plpgsql security definer set search_path = pg_catalog, internal as $$
begin
  if not internal.check_rate_limit(p_subject, p_action, p_limit, p_window_seconds) then
    raise exception 'rate limit exceeded for %', p_action using errcode = 'P0429';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Account lifecycle (FR09, FR23)
-- ---------------------------------------------------------------------------------------------
create table public.data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  storage_path text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);
create index data_exports_user_idx on public.data_exports (user_id, created_at desc);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  steps jsonb not null default '{}',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
create index deletion_requests_user_idx on public.deletion_requests (user_id);
