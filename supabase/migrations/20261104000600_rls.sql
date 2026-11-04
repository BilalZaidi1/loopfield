-- Row Level Security and explicit privileges. Every public table has RLS enabled. Client writes to
-- authoritative territory, ranking, title and entitlement records are impossible: those tables have
-- no INSERT/UPDATE/DELETE grant for API roles, and most social writes go through checked RPCs.

-- Start from zero: Supabase grants broad default privileges on public tables.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all tables in schema internal to service_role;
grant all on all sequences in schema public, internal to service_role;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Configuration and geography --------------------------------------------------------------
grant select on public.app_config, public.regions, public.districts to anon, authenticated;
create policy app_config_read on public.app_config for select to anon, authenticated using (is_public);
create policy regions_read on public.regions for select to anon, authenticated using (true);
create policy districts_read on public.districts for select to anon, authenticated using (true);

-- Identity ------------------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (handle, display_name, bio, avatar_path, district_id, city_label, visibility, discoverable, onboarding_completed_at) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (authz.can_view_profile(id, auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and status = 'active');

grant select on public.user_settings to authenticated;
grant update (messages_from, default_post_audience, full_private_mode, units, analytics_enabled, selected_competition_id) on public.user_settings to authenticated;
create policy user_settings_own_read on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy user_settings_own_update on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.consents to authenticated;
create policy consents_own_read on public.consents for select to authenticated using (user_id = auth.uid());

grant select, delete on public.protected_areas to authenticated;
grant insert (user_id, label, center, radius_m), update (label, center, radius_m) on public.protected_areas to authenticated;
create policy protected_areas_own on public.protected_areas for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.staff_roles to authenticated;
create policy staff_roles_own_read on public.staff_roles for select to authenticated using (user_id = auth.uid() or authz.has_role(auth.uid(), 'admin'));

grant select on public.notification_prefs to authenticated;
grant update (social, messages, clubs, competitive_digest, territory_loss, marketing, quiet_start, quiet_end, timezone) on public.notification_prefs to authenticated;
create policy notification_prefs_own_read on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy notification_prefs_own_update on public.notification_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Competition ---------------------------------------------------------------------------------
grant select on public.competitions, public.seasons to authenticated;
create policy competitions_read on public.competitions for select to authenticated
  using (kind = 'public' or authz.is_active_member(club_id, auth.uid()));
create policy seasons_read on public.seasons for select to authenticated
  using (exists (select 1 from public.competitions c where c.id = competition_id and (c.kind = 'public' or authz.is_active_member(c.club_id, auth.uid()))));

-- exclusion_zones: no client access (exposed only as unavailable cells through RPC).

grant select on public.activities to authenticated;
grant update (title, notes, perceived_effort) on public.activities to authenticated;
create policy activities_own_read on public.activities for select to authenticated using (user_id = auth.uid() and deleted_at is null);
create policy activities_own_update on public.activities for update to authenticated using (user_id = auth.uid() and deleted_at is null) with check (user_id = auth.uid());

grant select on public.loop_claims, public.speed_attempts, public.exploration_cells to authenticated;
create policy loop_claims_own_read on public.loop_claims for select to authenticated using (user_id = auth.uid());
create policy speed_attempts_own_read on public.speed_attempts for select to authenticated using (user_id = auth.uid());
create policy exploration_own_read on public.exploration_cells for select to authenticated using (user_id = auth.uid());

grant select on public.courses, public.course_versions to authenticated;
create policy courses_read on public.courses for select to authenticated using (status in ('active', 'suspended'));
create policy course_versions_read on public.course_versions for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.status in ('active', 'suspended')));

grant select on public.route_proposals to authenticated;
create policy route_proposals_read on public.route_proposals for select to authenticated
  using (creator_id = auth.uid() or authz.has_role(auth.uid(), 'route_reviewer'));

grant select on public.integrity_cases to authenticated;
create policy integrity_cases_staff_read on public.integrity_cases for select to authenticated using (authz.has_role(auth.uid(), 'integrity_reviewer'));

grant select on public.appeals to authenticated;
create policy appeals_read on public.appeals for select to authenticated
  using (user_id = auth.uid() or authz.has_role(auth.uid(), 'integrity_reviewer') or authz.has_role(auth.uid(), 'moderator'));

-- Social --------------------------------------------------------------------------------------
grant select on public.clubs to authenticated;
create policy clubs_read on public.clubs for select to authenticated using (authz.can_view_club(id, auth.uid()));

grant select on public.club_memberships to authenticated;
create policy club_memberships_read on public.club_memberships for select to authenticated using (
  user_id = auth.uid()
  or (state = 'active' and authz.is_active_member(club_id, auth.uid()))
  or authz.is_organizer(club_id, auth.uid())
);

grant select on public.follows to authenticated;
create policy follows_own_read on public.follows for select to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());

grant select on public.blocks, public.user_mutes to authenticated;
create policy blocks_own_read on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy mutes_own_read on public.user_mutes for select to authenticated using (muter_id = auth.uid());

grant select on public.posts to authenticated;
create policy posts_read on public.posts for select to authenticated
  using (authz.can_view_post_row(author_id, audience, club_id, status, publish_after, auth.uid()));

grant select on public.post_media to authenticated;
create policy post_media_read on public.post_media for select to authenticated
  using (owner_id = auth.uid() or (status = 'ready' and authz.can_view_post(post_id, auth.uid())));

grant select on public.comments to authenticated;
create policy comments_read on public.comments for select to authenticated using (
  (author_id = auth.uid() and status <> 'deleted')
  or (status = 'visible' and authz.can_view_post(post_id, auth.uid()) and not authz.is_blocked(author_id, auth.uid()))
);

grant select, insert, delete on public.reactions to authenticated;
create policy reactions_read on public.reactions for select to authenticated
  using (authz.can_view_post(post_id, auth.uid()) and not authz.is_blocked(user_id, auth.uid()));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and authz.can_view_post(post_id, auth.uid())
              and not exists (select 1 from public.posts p where p.id = post_id and authz.is_blocked(p.author_id, auth.uid())));
create policy reactions_delete on public.reactions for delete to authenticated using (user_id = auth.uid());

grant select on public.mentions to authenticated;
create policy mentions_read on public.mentions for select to authenticated using (mentioned_user_id = auth.uid() or author_id = auth.uid());

grant select on public.club_pins to authenticated;
create policy club_pins_read on public.club_pins for select to authenticated using (authz.is_active_member(club_id, auth.uid()) or exists (
  select 1 from public.clubs c where c.id = club_id and c.visibility = 'public'));

grant select on public.conversations to authenticated;
create policy conversations_member_read on public.conversations for select to authenticated using (member_a = auth.uid() or member_b = auth.uid());

grant select, insert, update on public.conversation_prefs to authenticated;
create policy conversation_prefs_own on public.conversation_prefs for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and (c.member_a = auth.uid() or c.member_b = auth.uid())));

grant select on public.moderation_cases to authenticated;
create policy moderation_cases_staff_read on public.moderation_cases for select to authenticated using (authz.has_role(auth.uid(), 'moderator'));

grant select on public.reports to authenticated;
create policy reports_own_read on public.reports for select to authenticated using (reporter_id = auth.uid());

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, delete on public.push_tokens to authenticated;
grant insert (user_id, token, platform), update (last_seen_at, disabled_at) on public.push_tokens to authenticated;
create policy push_tokens_own on public.push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Billing and lifecycle -----------------------------------------------------------------------
grant select on public.entitlements, public.data_exports, public.deletion_requests to authenticated;
create policy entitlements_own_read on public.entitlements for select to authenticated using (user_id = auth.uid());
create policy data_exports_own_read on public.data_exports for select to authenticated using (user_id = auth.uid());
create policy deletion_requests_own_read on public.deletion_requests for select to authenticated using (user_id = auth.uid());

-- Internal schema stays closed to API roles.
revoke all on all tables in schema internal from anon, authenticated;
revoke all on all functions in schema internal from public, anon, authenticated;
grant execute on all functions in schema internal to service_role;
