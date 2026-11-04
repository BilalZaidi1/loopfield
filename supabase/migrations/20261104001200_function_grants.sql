-- Function privileges: nothing is executable by anon; authenticated users may call only the listed
-- RPCs. Internal and authorization helpers are not callable through the API.

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke execute on all functions in schema internal from public, anon, authenticated;
alter default privileges in schema internal revoke execute on functions from public, anon, authenticated;

do $$
declare
  f text;
  rpc text[] := array[
    'set_consent', 'set_full_private_mode', 'follow', 'unfollow', 'respond_follow_request', 'remove_follower',
    'block_user', 'unblock_user', 'mute_user', 'profile_card', 'connections', 'search_profiles',
    'create_post', 'finalize_post_media', 'update_post', 'delete_post', 'feed_following', 'feed_discover', 'club_feed',
    'profile_posts', 'post_detail', 'resolve_content_link', 'add_comment', 'delete_comment', 'post_comments', 'toggle_reaction',
    'create_club', 'update_club', 'join_club', 'leave_club', 'invite_to_club', 'invite_to_club_by_email', 'accept_club_email_invite',
    'respond_club_invite', 'decide_join_request', 'remove_club_member', 'set_club_role', 'pin_club_post', 'club_remove_post',
    'club_detail', 'club_members', 'discover_clubs', 'my_clubs',
    'submit_report', 'submit_appeal', 'mark_notifications_read', 'badge_counts', 'messaging_eligibility',
    'activity_detail', 'delete_activity', 'propose_route', 'withdraw_route_proposal', 'request_data_export', 'request_account_deletion',
    'can_access_competition', 'current_season', 'territory_viewport_safe', 'exclusions_viewport', 'territory_leaderboard',
    'territory_cell_detail', 'my_territory_events', 'my_territory_summary', 'my_claim_cells', 'season_history',
    'speed_routes_in_view', 'speed_route_detail', 'my_titles',
    'my_staff_roles', 'ops_moderation_queue', 'ops_moderation_case', 'ops_moderate', 'ops_route_queue', 'ops_review_route',
    'ops_set_course_status', 'ops_integrity_queue', 'ops_integrity_detail', 'ops_set_hold', 'ops_resolve_integrity',
    'ops_decide_content_appeal', 'ops_add_exclusion', 'ops_set_region_review', 'ops_set_switch', 'ops_replay_season',
    'ops_grant_role', 'ops_dead_jobs', 'ops_retry_job'
  ];
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (rpc)
  loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

grant execute on all functions in schema public to service_role;
grant execute on all functions in schema internal to service_role;
grant execute on all functions in schema authz to anon, authenticated, service_role;
