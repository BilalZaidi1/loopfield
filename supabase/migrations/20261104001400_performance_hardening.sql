-- Performance hardening from the Supabase advisors run against loopfield-dev (5 Nov 2026):
--  * unindexed_foreign_keys: cover every foreign key so joins and cascading deletes (account
--    deletion) do not scan whole tables;
--  * auth_rls_initplan: evaluate auth.uid() once per statement instead of once per row by
--    wrapping it in a scalar sub-select. ALTER POLICY keeps each policy's name and roles.

create index if not exists club_email_invitations_inviter_id_fk_idx on internal.club_email_invitations (inviter_id);
create index if not exists moderation_actions_case_id_fk_idx on internal.moderation_actions (case_id);
create index if not exists recording_sessions_competition_id_fk_idx on internal.recording_sessions (competition_id);
create index if not exists recording_sessions_season_id_fk_idx on internal.recording_sessions (season_id);
create index if not exists activities_competition_id_fk_idx on public.activities (competition_id);
create index if not exists activities_season_id_fk_idx on public.activities (season_id);
create index if not exists appeals_decided_by_fk_idx on public.appeals (decided_by);
create index if not exists club_memberships_decided_by_fk_idx on public.club_memberships (decided_by);
create index if not exists club_memberships_invited_by_fk_idx on public.club_memberships (invited_by);
create index if not exists club_pins_pinned_by_fk_idx on public.club_pins (pinned_by);
create index if not exists club_pins_post_id_fk_idx on public.club_pins (post_id);
create index if not exists clubs_created_by_fk_idx on public.clubs (created_by);
create index if not exists clubs_region_id_fk_idx on public.clubs (region_id);
create index if not exists comments_author_id_fk_idx on public.comments (author_id);
create index if not exists conversation_prefs_conversation_id_fk_idx on public.conversation_prefs (conversation_id);
create index if not exists conversations_created_by_fk_idx on public.conversations (created_by);
create index if not exists conversations_member_b_fk_idx on public.conversations (member_b);
create index if not exists courses_creator_id_fk_idx on public.courses (creator_id);
create index if not exists courses_current_version_id_fk_idx on public.courses (current_version_id);
create index if not exists courses_region_id_fk_idx on public.courses (region_id);
create index if not exists exclusion_zones_created_by_fk_idx on public.exclusion_zones (created_by);
create index if not exists integrity_cases_assigned_to_fk_idx on public.integrity_cases (assigned_to);
create index if not exists integrity_cases_subject_user_id_fk_idx on public.integrity_cases (subject_user_id);
create index if not exists loop_claims_season_id_fk_idx on public.loop_claims (season_id);
create index if not exists mentions_author_id_fk_idx on public.mentions (author_id);
create index if not exists mentions_comment_id_fk_idx on public.mentions (comment_id);
create index if not exists mentions_mentioned_user_id_fk_idx on public.mentions (mentioned_user_id);
create index if not exists mentions_post_id_fk_idx on public.mentions (post_id);
create index if not exists moderation_cases_assigned_to_fk_idx on public.moderation_cases (assigned_to);
create index if not exists moderation_cases_subject_user_id_fk_idx on public.moderation_cases (subject_user_id);
create index if not exists notifications_actor_id_fk_idx on public.notifications (actor_id);
create index if not exists post_media_owner_id_fk_idx on public.post_media (owner_id);
create index if not exists posts_activity_id_fk_idx on public.posts (activity_id);
create index if not exists posts_route_course_id_fk_idx on public.posts (route_course_id);
create index if not exists profiles_district_id_fk_idx on public.profiles (district_id);
create index if not exists reactions_user_id_fk_idx on public.reactions (user_id);
create index if not exists reports_case_id_fk_idx on public.reports (case_id);
create index if not exists route_proposals_canonical_course_id_fk_idx on public.route_proposals (canonical_course_id);
create index if not exists route_proposals_region_id_fk_idx on public.route_proposals (region_id);
create index if not exists route_proposals_reviewed_by_fk_idx on public.route_proposals (reviewed_by);
create index if not exists route_proposals_source_activity_id_fk_idx on public.route_proposals (source_activity_id);
create index if not exists speed_attempts_competition_id_fk_idx on public.speed_attempts (competition_id);
create index if not exists speed_attempts_season_id_fk_idx on public.speed_attempts (season_id);
create index if not exists speed_attempts_user_id_fk_idx on public.speed_attempts (user_id);
create index if not exists staff_roles_granted_by_fk_idx on public.staff_roles (granted_by);
create index if not exists user_mutes_muted_id_fk_idx on public.user_mutes (muted_id);

alter policy activities_own_read on public.activities using (((user_id = ( select auth.uid())) AND (deleted_at IS NULL)));
alter policy activities_own_update on public.activities using (((user_id = ( select auth.uid())) AND (deleted_at IS NULL))) with check ((user_id = ( select auth.uid())));
alter policy appeals_read on public.appeals using (((user_id = ( select auth.uid())) OR authz.has_role(( select auth.uid()), 'integrity_reviewer'::text) OR authz.has_role(( select auth.uid()), 'moderator'::text)));
alter policy blocks_own_read on public.blocks using ((blocker_id = ( select auth.uid())));
alter policy club_memberships_read on public.club_memberships using (((user_id = ( select auth.uid())) OR ((state = 'active'::text) AND authz.is_active_member(club_id, ( select auth.uid()))) OR authz.is_organizer(club_id, ( select auth.uid()))));
alter policy club_pins_read on public.club_pins using ((authz.is_active_member(club_id, ( select auth.uid())) OR (EXISTS ( SELECT 1
   FROM clubs c
  WHERE ((c.id = club_pins.club_id) AND (c.visibility = 'public'::text))))));
alter policy clubs_read on public.clubs using (authz.can_view_club(id, ( select auth.uid())));
alter policy comments_read on public.comments using ((((author_id = ( select auth.uid())) AND (status <> 'deleted'::text)) OR ((status = 'visible'::text) AND authz.can_view_post(post_id, ( select auth.uid())) AND (NOT authz.is_blocked(author_id, ( select auth.uid()))))));
alter policy competitions_read on public.competitions using (((kind = 'public'::text) OR authz.is_active_member(club_id, ( select auth.uid()))));
alter policy consents_own_read on public.consents using ((user_id = ( select auth.uid())));
alter policy conversation_prefs_own on public.conversation_prefs using ((user_id = ( select auth.uid()))) with check (((user_id = ( select auth.uid())) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_prefs.conversation_id) AND ((c.member_a = ( select auth.uid())) OR (c.member_b = ( select auth.uid()))))))));
alter policy conversations_member_read on public.conversations using (((member_a = ( select auth.uid())) OR (member_b = ( select auth.uid()))));
alter policy data_exports_own_read on public.data_exports using ((user_id = ( select auth.uid())));
alter policy deletion_requests_own_read on public.deletion_requests using ((user_id = ( select auth.uid())));
alter policy entitlements_own_read on public.entitlements using ((user_id = ( select auth.uid())));
alter policy exploration_own_read on public.exploration_cells using ((user_id = ( select auth.uid())));
alter policy follows_own_read on public.follows using (((follower_id = ( select auth.uid())) OR (followee_id = ( select auth.uid()))));
alter policy integrity_cases_staff_read on public.integrity_cases using (authz.has_role(( select auth.uid()), 'integrity_reviewer'::text));
alter policy loop_claims_own_read on public.loop_claims using ((user_id = ( select auth.uid())));
alter policy mentions_read on public.mentions using (((mentioned_user_id = ( select auth.uid())) OR (author_id = ( select auth.uid()))));
alter policy moderation_cases_staff_read on public.moderation_cases using (authz.has_role(( select auth.uid()), 'moderator'::text));
alter policy notification_prefs_own_read on public.notification_prefs using ((user_id = ( select auth.uid())));
alter policy notification_prefs_own_update on public.notification_prefs using ((user_id = ( select auth.uid()))) with check ((user_id = ( select auth.uid())));
alter policy notifications_own_read on public.notifications using ((user_id = ( select auth.uid())));
alter policy notifications_own_update on public.notifications using ((user_id = ( select auth.uid()))) with check ((user_id = ( select auth.uid())));
alter policy post_media_read on public.post_media using (((owner_id = ( select auth.uid())) OR ((status = 'ready'::text) AND authz.can_view_post(post_id, ( select auth.uid())))));
alter policy posts_read on public.posts using (authz.can_view_post_row(author_id, audience, club_id, status, publish_after, ( select auth.uid())));
alter policy profiles_read on public.profiles using (authz.can_view_profile(id, ( select auth.uid())));
alter policy profiles_update_own on public.profiles using ((id = ( select auth.uid()))) with check (((id = ( select auth.uid())) AND (status = 'active'::text)));
alter policy protected_areas_own on public.protected_areas using ((user_id = ( select auth.uid()))) with check ((user_id = ( select auth.uid())));
alter policy push_tokens_own on public.push_tokens using ((user_id = ( select auth.uid()))) with check ((user_id = ( select auth.uid())));
alter policy reactions_delete on public.reactions using ((user_id = ( select auth.uid())));
alter policy reactions_insert on public.reactions with check (((user_id = ( select auth.uid())) AND authz.can_view_post(post_id, ( select auth.uid())) AND (NOT (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = reactions.post_id) AND authz.is_blocked(p.author_id, ( select auth.uid()))))))));
alter policy reactions_read on public.reactions using ((authz.can_view_post(post_id, ( select auth.uid())) AND (NOT authz.is_blocked(user_id, ( select auth.uid())))));
alter policy reports_own_read on public.reports using ((reporter_id = ( select auth.uid())));
alter policy route_proposals_read on public.route_proposals using (((creator_id = ( select auth.uid())) OR authz.has_role(( select auth.uid()), 'route_reviewer'::text)));
alter policy seasons_read on public.seasons using ((EXISTS ( SELECT 1
   FROM competitions c
  WHERE ((c.id = seasons.competition_id) AND ((c.kind = 'public'::text) OR authz.is_active_member(c.club_id, ( select auth.uid())))))));
alter policy speed_attempts_own_read on public.speed_attempts using ((user_id = ( select auth.uid())));
alter policy staff_roles_own_read on public.staff_roles using (((user_id = ( select auth.uid())) OR authz.has_role(( select auth.uid()), 'admin'::text)));
alter policy mutes_own_read on public.user_mutes using ((muter_id = ( select auth.uid())));
alter policy user_settings_own_read on public.user_settings using ((user_id = ( select auth.uid())));
alter policy user_settings_own_update on public.user_settings using ((user_id = ( select auth.uid()))) with check ((user_id = ( select auth.uid())));
alter policy avatars_delete_own on storage.objects using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text)));
alter policy avatars_select on storage.objects using (((bucket_id = 'avatars'::text) AND authz.can_view_profile(((storage.foldername(name))[1])::uuid, ( select auth.uid()))));
alter policy avatars_update_own on storage.objects using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text))) with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text)));
alter policy avatars_write_own on storage.objects with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text)));
alter policy media_uploads_insert_own on storage.objects with check (((bucket_id = 'media-uploads'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text) AND (EXISTS ( SELECT 1
   FROM post_media m
  WHERE ((m.upload_path = objects.name) AND (m.owner_id = ( select auth.uid())) AND (m.status = 'uploaded'::text))))));
alter policy media_uploads_select_own on storage.objects using (((bucket_id = 'media-uploads'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text)));
alter policy media_uploads_update_own on storage.objects using (((bucket_id = 'media-uploads'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text))) with check (((bucket_id = 'media-uploads'::text) AND ((storage.foldername(name))[1] = (( select auth.uid()))::text)));
alter policy post_media_select_authorized on storage.objects using (((bucket_id = 'post-media'::text) AND authz.can_view_media_object(name, ( select auth.uid()))));
