-- Supabase's Data API (PostgREST) preloads the safeupdate library, which rejects an UPDATE or DELETE
-- without a WHERE clause ("UPDATE requires a WHERE clause", HTTP 400). The other test files connect
-- directly and never meet that check, so this file fails on any function that would trip it. Where the
-- library is installed (Supabase images have it, plain PostgreSQL does not) it is loaded first, so the
-- calls at the end run exactly as they do through the API.
do $$ begin load 'safeupdate'; exception when others then null; end $$;

begin;
select plan(6);

-- Candidate statements in a function body: comments and string literals removed, every parenthesised
-- group (subqueries, CTE bodies) checked on its own, then the rest split at semicolons.
create function pg_temp.statements(p_src text) returns setof text language plpgsql immutable as $f$
declare
  s text := p_src;
begin
  s := regexp_replace(s, '--[^\n]*', '', 'g');
  s := regexp_replace(s, '/\*.*?\*/', '', 'g');
  s := regexp_replace(s, '''[^'']*''', '''''', 'g');
  while s ~ '\([^()]*\)' loop
    return query select m[1] from regexp_matches(s, '\(([^()]*)\)', 'g') m;
    s := regexp_replace(s, '\([^()]*\)', '[]', 'g');
  end loop;
  return query select x from regexp_split_to_table(s, ';') x;
end $f$;

create function pg_temp.unguarded(p_stmt text) returns boolean language sql immutable as $f$
  select ((p_stmt ~* '\mupdate\s+(only\s+)?[a-z_."]+(\s+(as\s+)?[a-z_]+)?\s+set\M' and p_stmt !~* '\mdo\s+update\s+set\M')
          or p_stmt ~* '\mdelete\s+from\M')
     and p_stmt !~* '\mwhere\M';
$f$;

select is((select count(*)::integer from pg_temp.statements($s$
    update t set a = 1;
    delete from u;
    update t set a = (select 1 from x where true);
    with d as (delete from v returning *) select 1;
    insert into t values (1) on conflict (a) do update set a = 2;
    update t set a = 1 where b;
    -- update t set a = 1
    perform f('delete from w');
  $s$) s where pg_temp.unguarded(s)), 4,
  'the scan finds UPDATE and DELETE without WHERE, including in CTEs and around subqueries');

select is(
  (select coalesce(string_agg(distinct n.nspname || '.' || p.proname, ', '), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral pg_temp.statements(p.prosrc) s(stmt)
    where p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))
      and n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage', 'realtime', 'graphql', 'graphql_public',
                            'vault', 'pgsodium', 'cron', 'net', 'supabase_functions', 'pgbouncer')
      and n.nspname !~ '^pg_(temp|toast)'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and pg_temp.unguarded(s.stmt)),
  '',
  'every UPDATE and DELETE in a function has a WHERE clause (the Data API rejects them otherwise)');

-- Through the guard (when it is loaded): the console's metrics when the hourly refresh is old ---------
create temp table guard_probe (a integer);
create function pg_temp.guard_loaded() returns boolean language plpgsql as $f$
begin
  delete from guard_probe;
  return false;
exception when cardinality_violation then
  return true;
end $f$;
select diag(case when pg_temp.guard_loaded() then 'safeupdate is loaded: the calls below run as they do through the Data API'
                 else 'safeupdate is not installed here: the scan above is the guard' end);

insert into auth.users (id, email) values ('b7000000-0000-4000-8000-000000000007', 'analyst@guards.test');
insert into public.staff_roles (user_id, role) values ('b7000000-0000-4000-8000-000000000007', 'analyst');
update internal.metrics_meta set refreshed_at = now() - interval '1 hour' where id;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'b7000000-0000-4000-8000-000000000007', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select lives_ok($$select public.ops_metrics(current_date - 6, current_date)$$, 'the console loads metrics when the hourly refresh is old');
reset role;
select ok((select refreshed_at from internal.metrics_meta where id) > now() - interval '1 minute', 'and that load refreshes today''s numbers');

-- A refresh that fails (here: no row can be written) is skipped, and the figures still load.
update internal.metrics_meta set refreshed_at = now() - interval '1 hour' where id;
alter table internal.metrics_daily add constraint guard_test_no_writes check (false) not valid;
set local role authenticated;
select lives_ok($$select public.ops_metrics(current_date - 6, current_date)$$, 'a failed refresh never stops the figures loading');
reset role;
select ok((select refreshed_at from internal.metrics_meta where id) < now() - interval '30 minutes', 'and the failed refresh changes nothing');

select * from finish();
rollback;
