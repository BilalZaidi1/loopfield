-- Back office: in-app support conversations.
--
-- Runners write to support from the app (Settings → Help and feedback); staff with the support
-- permission answer from the console. Runners only ever see their own conversations and never see
-- internal notes or which staff member replied. Replies notify the runner (in-app and push).

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('bug', 'feedback', 'account', 'competition', 'safety', 'billing', 'other')),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'pending', 'solved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles (id) on delete set null,
  app_version text check (char_length(app_version) <= 40),
  platform text check (platform in ('ios', 'android', 'web')),
  device text check (char_length(device) <= 120),
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 4096),
  runner_unread boolean not null default false,
  staff_unread boolean not null default true,
  first_response_at timestamptz,
  solved_at timestamptz,
  last_runner_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_user_idx on public.support_tickets (user_id, last_message_at desc);
create index support_tickets_queue_idx on public.support_tickets (status, last_message_at desc);
create index support_tickets_assignee_idx on public.support_tickets (assigned_to, status) where assigned_to is not null;

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null check (author_kind in ('runner', 'staff', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  check (not internal or author_kind = 'staff')
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy support_tickets_own_read on public.support_tickets for select to authenticated using (user_id = (select auth.uid()));
create policy support_messages_own_read on public.support_messages for select to authenticated
  using (not internal and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));
revoke insert, update, delete, truncate on public.support_tickets, public.support_messages from anon, authenticated;
revoke select on public.support_tickets, public.support_messages from anon;
grant select on public.support_tickets, public.support_messages to authenticated;

insert into internal.rate_limit_catalog (action, label, default_limit, window_seconds, sort)
values ('support_message', 'Support replies', 60, 3600, 61) on conflict (action) do nothing;
update internal.config_registry set allowed = (select array_agg(action order by sort) from internal.rate_limit_catalog) where key = 'rate_limits';

-- ---------------------------------------------------------------------------------------------
-- Runner side (the app)
-- ---------------------------------------------------------------------------------------------
create or replace function public.support_create(p_category text, p_subject text, p_body text, p_context jsonb default '{}',
                                                 p_app_version text default null, p_platform text default null, p_device text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- Suspended runners can still write to support; deleted accounts cannot.
  if not exists (select 1 from public.profiles where id = v_user and status in ('active', 'suspended')) then
    raise exception 'this account is not available' using errcode = '42501';
  end if;
  perform internal.enforce_rate_limit(v_user::text, 'support_ticket', 12, 3600);
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'write a message' using errcode = '22023'; end if;
  insert into public.support_tickets (user_id, category, subject, app_version, platform, device, context)
  values (v_user, p_category, btrim(coalesce(p_subject, '')), left(p_app_version, 40),
          case when p_platform in ('ios', 'android', 'web') then p_platform end, left(p_device, 120), coalesce(p_context, '{}'::jsonb))
  returning id into v_id;
  insert into public.support_messages (ticket_id, author_id, author_kind, body) values (v_id, v_user, 'runner', btrim(p_body));
  return v_id;
end $$;

create or replace function public.support_reply(p_ticket uuid, p_body text) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v_user uuid := auth.uid();
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket and user_id = v_user for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if t.status = 'closed' then raise exception 'this conversation is closed. Start a new one from Help and feedback.' using errcode = '22023'; end if;
  perform internal.enforce_rate_limit(v_user::text, 'support_message', 60, 3600);
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'write a message' using errcode = '22023'; end if;
  insert into public.support_messages (ticket_id, author_id, author_kind, body) values (p_ticket, v_user, 'runner', btrim(p_body));
  update public.support_tickets set status = 'open', solved_at = null, staff_unread = true, last_runner_message_at = now(),
                                    last_message_at = now(), updated_at = now()
   where id = p_ticket;
end $$;

-- The runner's conversations, newest first, with the last visible message.
create or replace function public.support_inbox() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status, 'unread', t.runner_unread,
           'created_at', t.created_at, 'last_message_at', t.last_message_at,
           'last_message', (select jsonb_build_object('body', left(m.body, 160), 'from', m.author_kind, 'at', m.created_at)
                              from public.support_messages m where m.ticket_id = t.id and not m.internal order by m.created_at desc limit 1))
           order by t.last_message_at desc), '[]'::jsonb)
    from public.support_tickets t where t.user_id = auth.uid();
$$;

-- One conversation for the runner; opening it marks the replies as read.
create or replace function public.support_thread(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket and user_id = auth.uid();
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if t.runner_unread then update public.support_tickets set runner_unread = false where id = p_ticket; end if;
  return jsonb_build_object(
    'id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status, 'created_at', t.created_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.author_kind, 'body', m.body, 'at', m.created_at) order by m.created_at)
                            from public.support_messages m where m.ticket_id = t.id and not m.internal), '[]'::jsonb));
end $$;

create or replace function public.support_unread_count() returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*)::integer from public.support_tickets where user_id = auth.uid() and runner_unread;
$$;

-- ---------------------------------------------------------------------------------------------
-- Staff side (the console)
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_support_queue(p_view text default 'open', p_query text default null, p_limit integer default 50,
                                                    p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('support');
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
                 'open', count(*) filter (where status = 'open'),
                 'mine', count(*) filter (where status in ('open', 'pending') and assigned_to = v),
                 'unassigned', count(*) filter (where status = 'open' and assigned_to is null),
                 'pending', count(*) filter (where status = 'pending'),
                 'solved', count(*) filter (where status in ('solved', 'closed')),
                 'all', count(*),
                 'urgent', count(*) filter (where status = 'open' and priority in ('high', 'urgent')),
                 'oldest_open', min(last_runner_message_at) filter (where status = 'open'))
               from public.support_tickets),
    'items', coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.last_message_at desc) from (
      select t.id, t.subject, t.category, t.status, t.priority, t.staff_unread, t.created_at, t.last_message_at, t.last_runner_message_at,
             t.first_response_at, t.platform, t.app_version,
             jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'status', p.status) as runner,
             (select jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name) from public.profiles a where a.id = t.assigned_to) as assignee,
             (select jsonb_build_object('body', left(m.body, 160), 'from', m.author_kind, 'internal', m.internal, 'at', m.created_at)
                from public.support_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last_message,
             (select count(*) from public.support_messages m where m.ticket_id = t.id and not m.internal) as messages
        from public.support_tickets t join public.profiles p on p.id = t.user_id
       where case coalesce(p_view, 'open')
               when 'open' then t.status = 'open'
               when 'mine' then t.status in ('open', 'pending') and t.assigned_to = v
               when 'unassigned' then t.status = 'open' and t.assigned_to is null
               when 'pending' then t.status = 'pending'
               when 'solved' then t.status in ('solved', 'closed')
               else true end
         and (v_q is null or t.subject ilike '%' || v_q || '%' or p.handle ilike v_q || '%' or p.display_name ilike '%' || v_q || '%')
         and (p_before is null or t.last_message_at < p_before)
       order by t.last_message_at desc
       limit v_limit) x), '[]'::jsonb));
end $$;

create or replace function public.ops_support_ticket(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('support');
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if t.staff_unread then update public.support_tickets set staff_unread = false where id = p_ticket; end if;
  return jsonb_build_object(
    'ticket', to_jsonb(t),
    'runner', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name, 'status', p.status,
                 'joined_at', p.created_at, 'avatar_kind', p.avatar_kind,
                 'runs', (select count(*) from public.activities a where a.user_id = p.id and a.deleted_at is null),
                 'last_run_at', (select max(a.started_at) from public.activities a where a.user_id = p.id and a.deleted_at is null),
                 'tickets', (select count(*) from public.support_tickets o where o.user_id = p.id))
               from public.profiles p where p.id = t.user_id),
    'assignee', (select jsonb_build_object('id', a.id, 'handle', a.handle, 'display_name', a.display_name) from public.profiles a where a.id = t.assigned_to),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from', m.author_kind, 'body', m.body, 'internal', m.internal,
                   'at', m.created_at, 'author', case when m.author_kind = 'staff' then (select handle from public.profiles s where s.id = m.author_id) end)
                   order by m.created_at) from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb),
    'other_tickets', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'subject', o.subject, 'status', o.status, 'created_at', o.created_at)
                   order by o.created_at desc) from (select * from public.support_tickets o where o.user_id = t.user_id and o.id <> t.id
                   order by o.created_at desc limit 10) o), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name) order by p.handle)
                   from (select distinct sr.user_id from public.staff_roles sr where sr.revoked_at is null) s
                   join public.profiles p on p.id = s.user_id where authz.has_role(s.user_id, 'support')), '[]'::jsonb),
    'me', v);
end $$;

create or replace function public.ops_support_reply(p_ticket uuid, p_body text, p_internal boolean default false, p_status text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('support');
  t public.support_tickets;
  v_msg uuid;
  v_status text;
begin
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'write a message' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('open', 'pending', 'solved', 'closed') then raise exception 'unknown status' using errcode = '22023'; end if;
  insert into public.support_messages (ticket_id, author_id, author_kind, body, internal)
  values (p_ticket, v, 'staff', btrim(p_body), coalesce(p_internal, false)) returning id into v_msg;
  if coalesce(p_internal, false) then
    update public.support_tickets set status = coalesce(p_status, status), updated_at = now(),
                                      solved_at = case when p_status = 'solved' then now() else solved_at end
     where id = p_ticket;
  else
    v_status := coalesce(p_status, 'pending');
    update public.support_tickets
       set status = v_status, runner_unread = true, first_response_at = coalesce(first_response_at, now()),
           solved_at = case when v_status = 'solved' then now() else null end,
           assigned_to = coalesce(assigned_to, v), last_message_at = now(), updated_at = now()
     where id = p_ticket;
    perform internal.notify(t.user_id, 'system', 'support_reply', null, 'support_ticket', p_ticket::text,
                            jsonb_build_object('subject', t.subject), 'support:' || v_msg::text);
  end if;
  if p_status is not null and p_status is distinct from t.status then
    perform internal.audit(v, 'staff', 'support_status', 'support_ticket', p_ticket::text, jsonb_build_object('from', t.status, 'to', p_status));
  end if;
end $$;

create or replace function public.ops_support_update(p_ticket uuid, p_status text default null, p_priority text default null,
                                                     p_assignee uuid default null, p_unassign boolean default false)
returns void language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  v uuid := internal.require_role('support');
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  if p_status is not null and p_status not in ('open', 'pending', 'solved', 'closed') then raise exception 'unknown status' using errcode = '22023'; end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'unknown priority' using errcode = '22023'; end if;
  if p_assignee is not null and not authz.has_role(p_assignee, 'support') then raise exception 'that person cannot answer support' using errcode = '22023'; end if;
  update public.support_tickets
     set status = coalesce(p_status, status),
         solved_at = case when p_status = 'solved' then now() when p_status in ('open', 'pending') then null else solved_at end,
         priority = coalesce(p_priority, priority),
         assigned_to = case when p_unassign then null else coalesce(p_assignee, assigned_to) end,
         updated_at = now()
   where id = p_ticket;
  if p_status = 'solved' and t.status <> 'solved' then
    insert into public.support_messages (ticket_id, author_kind, body)
    values (p_ticket, 'system', 'Marked as solved. Reply here if you still need help.');
  end if;
  perform internal.audit(v, 'staff', 'support_updated', 'support_ticket', p_ticket::text, jsonb_strip_nulls(jsonb_build_object(
    'status', case when p_status is distinct from t.status then p_status end,
    'priority', case when p_priority is distinct from t.priority then p_priority end,
    'assignee', case when p_unassign then 'none' when p_assignee is distinct from t.assigned_to then p_assignee::text end)));
end $$;

-- Solved conversations close a week after the last message; runners then start a new one.
create or replace function internal.support_autoclose() returns integer
language sql security definer set search_path = pg_catalog, public as $$
  with c as (
    update public.support_tickets set status = 'closed', updated_at = now()
     where status = 'solved' and last_message_at < now() - interval '7 days' returning 1)
  select count(*)::integer from c;
$$;

grant execute on function public.support_create(text, text, text, jsonb, text, text, text) to authenticated;
grant execute on function public.support_reply(uuid, text) to authenticated;
grant execute on function public.support_inbox() to authenticated;
grant execute on function public.support_thread(uuid) to authenticated;
grant execute on function public.support_unread_count() to authenticated;
grant execute on function public.ops_support_queue(text, text, integer, timestamptz) to authenticated;
grant execute on function public.ops_support_ticket(uuid) to authenticated;
grant execute on function public.ops_support_reply(uuid, text, boolean, text) to authenticated;
grant execute on function public.ops_support_update(uuid, text, text, uuid, boolean) to authenticated;
revoke all on function public.support_create(text, text, text, jsonb, text, text, text) from anon;
revoke all on function public.support_reply(uuid, text) from anon;
revoke all on function public.support_inbox() from anon;
revoke all on function public.support_thread(uuid) from anon;
revoke all on function public.support_unread_count() from anon;
revoke all on function public.ops_support_queue(text, text, integer, timestamptz) from anon;
revoke all on function public.ops_support_ticket(uuid) from anon;
revoke all on function public.ops_support_reply(uuid, text, boolean, text) from anon;
revoke all on function public.ops_support_update(uuid, text, text, uuid, boolean) from anon;
revoke all on function internal.support_autoclose() from public;
