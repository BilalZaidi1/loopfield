-- Enhancements, part 4 (fixes found in review after part 2 was deployed):
--   * A shared run stays hidden until its publication delay has passed (posts.publish_after). Friends and
--     community members are now told when the post becomes visible, not when it is created, so a
--     notification can never reveal a run that just finished.
--   * A land item counts each layer once, even when a claim is published again after a review.

/** Tells friends about a shared run, or members about an announcement, once the post is visible. */
create or replace function internal.notify_post_published(p_post uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
declare
  p public.posts;
  v_club public.clubs;
  r record;
begin
  select * into p from public.posts where id = p_post;
  if not found or p.status <> 'published' or p.publish_after > now() then return; end if;
  if p.is_announcement and p.club_id is not null then
    select * into v_club from public.clubs where id = p.club_id and status = 'active';
    if not found then return; end if;
    for r in select m.user_id from public.club_memberships m where m.club_id = p.club_id and m.state = 'active' and m.user_id <> p.author_id limit 5000 loop
      perform internal.notify(r.user_id, 'club', 'club_announcement', p.author_id, 'post', p.id::text,
                              jsonb_build_object('club_id', v_club.id, 'club_name', v_club.name, 'kind', v_club.kind), 'cann:' || p.id::text);
    end loop;
  elsif p.activity_id is not null and p.audience in ('followers', 'public') then
    for r in
      select f.follower_id as user_id from public.follows f
       where f.followee_id = p.author_id and f.state = 'accepted'
         and exists (select 1 from public.follows g where g.follower_id = p.author_id and g.followee_id = f.follower_id and g.state = 'accepted')
       limit 500
    loop
      perform internal.notify(r.user_id, 'social', 'friend_run', p.author_id, 'post', p.id::text, '{}', 'frun:' || p.id::text);
    end loop;
  end if;
end $$;

create or replace function internal.on_post_published() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, internal as $$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return null; end if;
  if not ((new.is_announcement and new.club_id is not null) or (new.activity_id is not null and new.audience in ('followers', 'public'))) then return null; end if;
  if new.publish_after > now() then
    perform internal.enqueue_job('notifications', 'notify_post', jsonb_build_object('post_id', new.id), 'notifypost:' || new.id::text, new.publish_after);
  else
    perform internal.notify_post_published(new.id);
  end if;
  return null;
end $$;

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
    set data = n.data || jsonb_build_object('layers',
          (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(coalesce(n.data -> 'layers', '[]'::jsonb)) x
            where x ->> 'competition_id' is distinct from p_layer ->> 'competition_id') || jsonb_build_array(p_layer));
  if p_push then
    perform internal.enqueue_job('notifications', 'push_pending', jsonb_build_object('user_id', p_user), 'push:' || p_user::text, now() + interval '5 seconds');
  end if;
end $$;
