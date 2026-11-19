-- Back office: functions are executable by PUBLIC by default, so revoking from anon alone leaves them
-- reachable through /rest/v1/rpc without a session. Every new function checks the caller anyway; this
-- removes the anonymous path entirely (Supabase advisor: anon_security_definer_function_executable).
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in (
              'game_rules', 'support_create', 'support_reply', 'support_inbox', 'support_thread', 'support_unread_count',
              'ops_rbac', 'ops_save_role', 'ops_delete_role', 'ops_rules', 'ops_save_rules', 'ops_set_next_rules', 'ops_apply_rules_now',
              'ops_support_queue', 'ops_support_ticket', 'ops_support_reply', 'ops_support_update',
              'ops_users_list', 'ops_user_overview', 'ops_set_user_status', 'ops_sign_out_user', 'ops_reset_profile',
              'ops_metrics', 'ops_analytics_breakdowns', 'ops_analytics_funnel', 'ops_analytics_retention', 'ops_preferences', 'ops_set_preference',
              'ops_sql_run', 'ops_sql_catalog', 'ops_sql_saved', 'ops_sql_save', 'ops_sql_delete', 'ops_whoami', 'ops_grant_role'))
        or (n.nspname = 'authz' and p.proname = 'feature_enabled')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
