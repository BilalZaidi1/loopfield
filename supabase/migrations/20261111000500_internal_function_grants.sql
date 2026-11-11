-- Internal functions are reached only through security-definer RPCs, triggers and the job runner, never
-- directly by app users. Per-schema default privileges cannot take back PUBLIC's EXECUTE on new
-- functions, so the functions added on 11 Nov are closed here explicitly (signed-in and anonymous users
-- also have no USAGE on the schema; this is defence in depth). Safe to re-run.
revoke execute on all functions in schema internal from public, anon, authenticated;
-- Exception: the avatar parts check runs inside a CHECK constraint on profiles, which signed-in runners
-- update themselves, so it stays executable (it is a pure validation and reveals nothing).
grant execute on function internal.valid_avatar_style(jsonb) to authenticated, service_role;
