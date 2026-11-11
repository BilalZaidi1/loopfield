-- Enhancements, part 2: notification types, channels and email.
--   1. Preferences: push switches for your own results, friends' runs and events; email categories.
--   2. Email outbox: one row per email that may ever be sent (the dedupe key makes a second send
--      impossible), queued for the worker, which renders, checks suppressions and sends through Resend.
--   3. Land notifications: when a land change is published (after validation and the privacy delay),
--      the runner who captured land and the runners who lost it get one in-app item per run, merged
--      across the all-time map and club races. Losses are never pushed one by one (the daily digest is
--      the push) and never name the other runner.
--   4. Community, social, event and season notifications that were missing.
--   5. Email triggers: welcome, invitations, approvals, ownership, closures, event registration,
--      reminders and results; one-click unsubscribe tokens.

-- ---- 1. Preferences --------------------------------------------------------------------------------
alter table public.notification_prefs
  add column if not exists run_results boolean not null default true,
  add column if not exists friend_runs boolean not null default false,
  add column if not exists events boolean not null default true,
  add column if not exists email_runs boolean not null default false,
  add column if not exists email_territory boolean not null default false,
  add column if not exists email_clubs boolean not null default true,
  add column if not exists email_events boolean not null default true;
grant update (run_results, friend_runs, events, email_runs, email_territory, email_clubs, email_events) on public.notification_prefs to authenticated;

insert into public.app_config (key, value, description, is_public) values
  ('contested_min_runners', '2'::jsonb, 'Proposed: land counts as contested when this many different runners took cells from you within the window.', true),
  ('contested_window_days', '7'::jsonb, 'Proposed: window (days) for the contested-land notification.', true),
  ('invite_emails_per_day', '3'::jsonb, 'Most invitation emails one person receives per day (more invitations still appear in the app).', false)
on conflict (key) do nothing;

-- ---- 2. Email outbox -------------------------------------------------------------------------------
create table if not exists internal.email_outbox (
  dedupe_key text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  template text not null,
  data jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  reason text,
  provider_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_user_idx on internal.email_outbox (user_id, template, created_at desc);

-- Per-person unsubscribe token for the links in optional emails (never shown in the app or the API).
create table if not exists internal.email_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

create or replace function internal.email_token(p_user uuid) returns text
language plpgsql security definer set search_path = pg_catalog, internal, extensions as $$
declare
  v text;
begin
  insert into internal.email_tokens (user_id, token)
  values (p_user, translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'))
  on conflict (user_id) do nothing;
  select token into v from internal.email_tokens where user_id = p_user;
  return v;
end $$;

/** Which preference an email follows ('account' is always sent). Mirrors EMAIL_CATEGORY in core. */
create or replace function internal.email_category(p_template text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case p_template
    when 'welcome' then 'account'
    when 'run_summary' then 'runs'
    when 'territory_daily' then 'territory'
    when 'club_invite' then 'clubs' when 'club_approved' then 'clubs' when 'club_ownership' then 'clubs' when 'club_closed' then 'clubs'
    when 'event_registered' then 'events' when 'event_reminder' then 'events' when 'event_results' then 'events' when 'season_results' then 'events'
  end;
$$;

/**
 * Queue an email once. Returns false when the runner switched that kind of email off, the account is not
 * active, or the same email (dedupe key) was already queued; the worker re-checks preferences at send time.
 */
create or replace function internal.enqueue_email(p_user uuid, p_template text, p_data jsonb, p_dedupe text, p_run_at timestamptz default now())
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_cat text := internal.email_category(p_template);
  np public.notification_prefs;
begin
  if v_cat is null then raise exception 'unknown email template %', p_template; end if;
  if p_user is null or p_dedupe is null or not exists (select 1 from public.profiles where id = p_user and status = 'active') then return false; end if;
  select * into np from public.notification_prefs where user_id = p_user;
  if (v_cat = 'runs' and not coalesce(np.email_runs, false))
     or (v_cat = 'territory' and not coalesce(np.email_territory, false))
     or (v_cat = 'clubs' and not coalesce(np.email_clubs, true))
     or (v_cat = 'events' and not coalesce(np.email_events, true)) then
    return false;
  end if;
  insert into internal.email_outbox (dedupe_key, user_id, template, data) values (p_dedupe, p_user, p_template, coalesce(p_data, '{}'))
  on conflict (dedupe_key) do nothing;
  if not found then return false; end if;
  perform internal.enqueue_job('email', 'send_email', jsonb_build_object('key', p_dedupe), 'mail:' || p_dedupe, coalesce(p_run_at, now()));
  return true;
end $$;

/** One-click unsubscribe: switches one optional email category off for the token's owner. */
create or replace function internal.email_unsubscribe(p_token text, p_category text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid;
begin
  select user_id into v_user from internal.email_tokens where token = p_token;
  if v_user is null or p_category not in ('runs', 'territory', 'clubs', 'events') then return false; end if;
  update public.notification_prefs
     set email_runs = case when p_category = 'runs' then false else email_runs end,
         email_territory = case when p_category = 'territory' then false else email_territory end,
         email_clubs = case when p_category = 'clubs' then false else email_clubs end,
         email_events = case when p_category = 'events' then false else email_events end
   where user_id = v_user;
  perform internal.audit(v_user, 'user', 'email_unsubscribed', 'notification_prefs', v_user::text, jsonb_build_object('category', p_category));
  return true;
end $$;

-- ---- 3. Land notifications ---------------------------------------------------------------------------
/** In-app land item, one per run and person; a second layer (a club race) adds itself to the same item. */
create or replace function internal.notify_land(p_user uuid, p_kind text, p_object_type text, p_object_id text, p_data jsonb, p_layer jsonb, p_dedupe text, p_push boolean)
returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications as n (user_id, category, kind, actor_id, object_type, object_id, data, dedupe_key, push_state)
  values (p_user, 'competitive', p_kind, null, p_object_type, p_object_id,
          coalesce(p_data, '{}'::jsonb) || jsonb_build_object('layers', jsonb_build_array(p_layer)), p_dedupe,
          case when p_push then 'pending' else 'not_applicable' end)
  on conflict (user_id, dedupe_key) do update
    set data = n.data || jsonb_build_object('layers', coalesce(n.data -> 'layers', '[]'::jsonb) || jsonb_build_array(p_layer));
  if p_push then
    perform internal.enqueue_job('notifications', 'push_pending', jsonb_build_object('user_id', p_user), 'push:' || p_user::text, now() + interval '5 seconds');
  end if;
end $$;

/**
 * A capture on the all-time map or a club race was published: tell the runner what their run captured,
 * and the runners who lost cells that land changed hands ("contested" when several runners took cells
 * from them within the proposed window). Other runners are never named, and losses are not pushed.
 */
create or replace function internal.on_territory_event_published() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal, extensions as $$
declare
  v_comp public.competitions;
  v_claim public.loop_claims;
  v_root public.loop_claims;
  v_district text;
  v_gained integer;
  v_taken integer;
  v_cell bigint;
  v_takers integer;
  v_kind text;
  r record;
begin
  if new.kind <> 'capture' or new.claim_id is null then return null; end if;
  select * into v_comp from public.competitions where id = new.competition_id;
  if not found or v_comp.kind not in ('permanent', 'club') then return null; end if;
  select * into v_claim from public.loop_claims where id = new.claim_id;
  if not found then return null; end if;
  select * into v_root from public.loop_claims where id = coalesce(v_claim.parent_claim_id, v_claim.id);
  select d.name into v_district from public.districts d
   where v_root.polygon is not null and st_intersects(d.geom, st_pointonsurface(v_root.polygon)::geography)
   limit 1;

  select count(*) filter (where new_controller = v_claim.user_id and prior_controller is distinct from new_controller),
         count(*) filter (where new_controller = v_claim.user_id and prior_controller is not null and prior_controller <> v_claim.user_id),
         min(cell) filter (where new_controller = v_claim.user_id)
    into v_gained, v_taken, v_cell
    from internal.territory_event_cells where event_id = new.id;
  if v_gained > 0 and v_root.activity_id is not null then
    perform internal.notify_land(v_claim.user_id, 'territory_captured', 'activity', v_root.activity_id::text,
                                 jsonb_strip_nulls(jsonb_build_object('district', v_district, 'cell', v_cell::text)),
                                 jsonb_strip_nulls(jsonb_build_object('competition_id', v_comp.id, 'kind', v_comp.kind, 'name', v_comp.name, 'club_id', v_comp.club_id,
                                                                      'cells', v_gained, 'taken', v_taken)),
                                 'tcap:' || v_root.id::text, true);
  end if;

  for r in
    select ec.prior_controller as user_id, count(*)::integer as cells, min(ec.cell) as cell
      from internal.territory_event_cells ec
     where ec.event_id = new.id and ec.prior_controller is not null and ec.prior_controller is distinct from ec.new_controller
     group by ec.prior_controller
  loop
    if exists (select 1 from public.notification_prefs np where np.user_id = r.user_id and not np.territory_loss) then continue; end if;
    v_kind := 'territory_lost';
    v_takers := null;
    if v_comp.kind = 'permanent' then
      select count(distinct ec.new_controller) into v_takers
        from internal.territory_event_cells ec join internal.territory_events te on te.id = ec.event_id
       where ec.prior_controller = r.user_id and ec.new_controller is not null and ec.new_controller <> r.user_id
         and te.competition_id = new.competition_id and te.kind = 'capture'
         and coalesce(te.published_at, now()) > now() - make_interval(days => internal.config_int('contested_window_days', 7));
      if v_takers >= internal.config_int('contested_min_runners', 2)
         and not exists (select 1 from public.notifications n where n.user_id = r.user_id and n.kind = 'territory_contested'
                          and n.created_at > now() - interval '3 days') then
        v_kind := 'territory_contested';
      end if;
    end if;
    perform internal.notify_land(r.user_id, v_kind, 'cell', r.cell::text,
                                 jsonb_strip_nulls(jsonb_build_object('district', v_district,
                                                                      'runners', case when v_kind = 'territory_contested' then v_takers end)),
                                 jsonb_strip_nulls(jsonb_build_object('competition_id', v_comp.id, 'kind', v_comp.kind, 'name', v_comp.name, 'club_id', v_comp.club_id, 'cells', r.cells)),
                                 'tlost:' || v_root.id::text || ':' || r.user_id::text, false);
  end loop;
  return null;
end $$;
drop trigger if exists territory_events_notify on internal.territory_events;
create trigger territory_events_notify after update of published_at on internal.territory_events
  for each row when (old.published_at is null and new.published_at is not null)
  execute function internal.on_territory_event_published();

-- ---- 4. Community, social, event and season notifications ---------------------------------------
/** Friends' shared runs (mutual follows, posts they can see) and community announcements, once published. */
create or replace function internal.on_post_published() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  r record;
  v_club public.clubs;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return null; end if;
  if new.is_announcement and new.club_id is not null then
    select * into v_club from public.clubs where id = new.club_id and status = 'active';
    if not found then return null; end if;
    for r in select m.user_id from public.club_memberships m where m.club_id = new.club_id and m.state = 'active' and m.user_id <> new.author_id limit 5000 loop
      perform internal.notify(r.user_id, 'club', 'club_announcement', new.author_id, 'post', new.id::text,
                              jsonb_build_object('club_id', v_club.id, 'club_name', v_club.name, 'kind', v_club.kind), 'cann:' || new.id::text);
    end loop;
  elsif new.activity_id is not null and new.audience in ('followers', 'public') then
    for r in
      select f.follower_id as user_id from public.follows f
       where f.followee_id = new.author_id and f.state = 'accepted'
         and exists (select 1 from public.follows g where g.follower_id = new.author_id and g.followee_id = f.follower_id and g.state = 'accepted')
       limit 500
    loop
      perform internal.notify(r.user_id, 'social', 'friend_run', new.author_id, 'post', new.id::text, '{}', 'frun:' || new.id::text);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists posts_notify on public.posts;
create trigger posts_notify after insert or update of status on public.posts
  for each row execute function internal.on_post_published();

/** The owner and admins hear when someone joins (accepted invitation, approved request or open join). */
create or replace function internal.on_club_member_joined() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  c public.clubs;
  r record;
begin
  if new.state <> 'active' or new.role = 'owner' or (tg_op = 'UPDATE' and old.state = 'active') then return null; end if;
  select * into c from public.clubs where id = new.club_id and status = 'active';
  if not found then return null; end if;
  for r in select m.user_id from public.club_memberships m
            where m.club_id = new.club_id and m.state = 'active' and m.role in ('owner', 'organizer') and m.user_id <> new.user_id loop
    perform internal.notify(r.user_id, 'club', 'club_member_joined', new.user_id, 'club', new.club_id::text,
                            jsonb_build_object('club_name', c.name, 'kind', c.kind), 'cjoin:' || new.club_id::text || ':' || new.user_id::text);
  end loop;
  return null;
end $$;
drop trigger if exists club_memberships_joined_notify on public.club_memberships;
create trigger club_memberships_joined_notify after insert or update of state on public.club_memberships
  for each row execute function internal.on_club_member_joined();

/** A season race (public or club) settled: every runner who held land hears where they finished. */
create or replace function internal.on_season_settled() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_comp public.competitions;
  r record;
begin
  if new.status <> 'settled' or old.status = 'settled' then return null; end if;
  select * into v_comp from public.competitions where id = new.competition_id;
  if not found or v_comp.kind not in ('public', 'club') then return null; end if;
  for r in
    with areas as (
      select p.controller_id, sum(tc.area_m2) as area
        from internal.cell_control_public p join internal.territory_cells tc on tc.cell = p.cell
       where p.competition_id = new.competition_id and p.season_id = new.id and p.controller_id is not null
       group by p.controller_id
    )
    select controller_id, area, rank() over (order by round(area::numeric, 1) desc) as rk, count(*) over () as n from areas
    limit 20000
  loop
    perform internal.notify(r.controller_id, 'competitive', 'season_finished', null, 'competition', new.competition_id::text,
                            jsonb_strip_nulls(jsonb_build_object('name', v_comp.name, 'kind', v_comp.kind, 'club_id', v_comp.club_id, 'season', new.number,
                                                                 'rank', r.rk, 'runners', r.n, 'area_m2', round(r.area::numeric))),
                            'season_end:' || new.id::text);
  end loop;
  return null;
end $$;
drop trigger if exists seasons_settled_notify on public.seasons;
create trigger seasons_settled_notify after update of status on public.seasons
  for each row execute function internal.on_season_settled();

-- ---- 5. Email triggers -----------------------------------------------------------------------------
/** Notifications that also have an email (each follows its category switch; one email per notification). */
create or replace function internal.on_notification_email() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_template text := case new.kind
    when 'club_invite' then 'club_invite'
    when 'club_request_approved' then 'club_approved'
    when 'club_ownership_offer' then 'club_ownership'
    when 'club_deleted' then 'club_closed'
    when 'event_starting' then 'event_reminder'
    when 'event_finished' then 'event_results'
    when 'season_finished' then 'season_results'
    when 'territory_digest' then 'territory_daily'
  end;
begin
  if v_template is null then return null; end if;
  -- People cannot be emailed into annoyance: a few invitation emails a day at most (the rest stay in the app).
  if v_template = 'club_invite' and (select count(*) from internal.email_outbox o where o.user_id = new.user_id and o.template = 'club_invite'
                                       and o.created_at > now() - interval '1 day') >= internal.config_int('invite_emails_per_day', 3) then
    return null;
  end if;
  perform internal.enqueue_email(new.user_id, v_template,
                                 coalesce(new.data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('object_id', new.object_id, 'actor_id', new.actor_id, 'notification_id', new.id)),
                                 'n:' || new.id::text);
  return null;
end $$;
drop trigger if exists notifications_email on public.notifications;
create trigger notifications_email after insert on public.notifications
  for each row execute function internal.on_notification_email();

/** Joining an event (or rejoining one you left) confirms by email once per event. */
create or replace function internal.on_event_joined() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.left_at is not null or (tg_op = 'UPDATE' and old.left_at is null) then return null; end if;
  perform internal.enqueue_email(new.user_id, 'event_registered', jsonb_strip_nulls(jsonb_build_object('event_id', new.competition_id, 'club_id', new.club_id)),
                                 'evreg:' || new.competition_id::text || ':' || new.user_id::text);
  return null;
end $$;
drop trigger if exists event_participants_email on public.event_participants;
create trigger event_participants_email after insert or update of left_at on public.event_participants
  for each row execute function internal.on_event_joined();

/**
 * Welcome email once the address is confirmed (at sign-up for Apple and Google). Named to run after
 * on_auth_user_created, which creates the profile. Email bookkeeping never blocks signing in.
 */
create or replace function internal.on_auth_user_welcome() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.email is null or new.email_confirmed_at is null or (tg_op = 'UPDATE' and old.email_confirmed_at is not null) then return new; end if;
  begin
    perform internal.enqueue_email(new.id, 'welcome', '{}'::jsonb, 'welcome:' || new.id::text);
  exception when others then
    raise warning 'welcome email not queued: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_welcome on auth.users;
create trigger on_auth_user_welcome after insert or update of email_confirmed_at on auth.users
  for each row execute function internal.on_auth_user_welcome();

-- Retention: the outbox (ids and counts only, never addresses) is kept as long as notifications.
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
  delete from internal.email_outbox where created_at < now() - interval '180 days';
  delete from internal.moderation_evidence e using public.moderation_cases c
   where c.id = e.case_id and c.resolved_at < now() - interval '90 days';
  update public.data_exports set status = 'expired' where status = 'ready' and expires_at < now();
  return jsonb_build_object('evidence_candidates', v_evidence);
end $$;
