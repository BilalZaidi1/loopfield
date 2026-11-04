-- Periodic maintenance. pg_cron and pg_net exist on Supabase; this migration is a no-op elsewhere
-- (local test databases call the same functions directly).

create or replace function internal.run_maintenance() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_t integer;
  v_s integer;
begin
  perform internal.maintain_seasons();
  v_t := internal.publish_due_territory(500);
  v_s := internal.publish_due_titles(500);
  -- Digest dispatch is per user local time; the worker groups pending items (see notifications job).
  if exists (select 1 from internal.digest_items where digested_at is null) then
    perform internal.enqueue_job('notifications', 'dispatch_digests', '{}', 'digests', now());
  end if;
  return jsonb_build_object('territory_events', v_t, 'titles', v_s);
end $$;

create or replace function internal.purge_expired() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_evidence integer;
begin
  -- Raw competitive evidence: through the season plus 30 days after settlement (PRD §11).
  with due as (
    select a.id from public.activities a
      left join public.seasons s on s.id = a.season_id
     where a.raw_evidence_purged_at is null
       and ((s.id is not null and s.settled_at is not null and s.settled_at + interval '30 days' < now())
         or (s.id is null and a.ended_at + interval '30 days' < now()))
       and not exists (select 1 from public.integrity_cases ic where ic.status <> 'resolved'
                        and ic.object_id in (select id from public.loop_claims where activity_id = a.id union select id from public.speed_attempts where activity_id = a.id))
     limit 500)
  select count(*) into v_evidence from due;
  if v_evidence > 0 then
    perform internal.enqueue_job('maintenance', 'purge_raw_evidence', '{}', 'purge-evidence', now());
  end if;
  delete from internal.rate_limits where window_start < now() - interval '2 days';
  delete from internal.webhook_events where received_at < now() - interval '30 days';
  delete from internal.jobs where status = 'succeeded' and finished_at < now() - interval '14 days';
  delete from public.notifications where created_at < now() - interval '180 days';
  delete from internal.moderation_evidence e using public.moderation_cases c
   where c.id = e.case_id and c.resolved_at < now() - interval '90 days';
  update public.data_exports set status = 'expired' where status = 'ready' and expires_at < now();
  return jsonb_build_object('evidence_candidates', v_evidence);
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('loopfield-maintenance', '* * * * *', 'select internal.run_maintenance()');
    perform cron.schedule('loopfield-purge', '17 3 * * *', 'select internal.purge_expired()');
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- Job runner trigger: when the worker is deployed as the `jobs` edge function, pg_cron calls it every
-- minute. URL and shared secret are read from Vault (set by scripts/setup-supabase.sh), never stored here.
create or replace function internal.invoke_job_runner() returns void
language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regnamespace('vault') is null or to_regnamespace('net') is null then return; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''jobs_runner_url''' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''jobs_runner_secret''' into v_secret;
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from internal.jobs where status = 'queued' and run_at <= now()) then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb, timeout_milliseconds := 55000)'
    using v_url, jsonb_build_object('content-type', 'application/json', 'x-jobs-secret', v_secret);
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('loopfield-jobs', '* * * * *', 'select internal.invoke_job_runner()');
  end if;
end $$;
