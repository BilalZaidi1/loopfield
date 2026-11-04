-- RLS, grants and authoritative-write protections (FR27, FR43, FR52 boundaries).
begin;
select plan(22);

-- Every public table has RLS enabled.
select is(
  (select count(*)::int from pg_tables t join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
    where t.schemaname = 'public' and not c.relrowsecurity), 0, 'all public tables have RLS enabled');

-- Users
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test');
select is((select count(*)::int from public.profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2, 'profiles created by auth trigger');
select is((select count(*)::int from public.user_settings where territory_competition_enabled), 0, 'contest sharing is off until explicitly enabled (FR01)');

-- Anonymous callers see nothing private and can call no RPC.
set local role anon;
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select public.feed_following()$$, '42501', null, 'anon cannot execute RPCs');
reset role;

-- Authenticated user A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 2, 'A can see active, unblocked profiles');
select throws_ok($$insert into public.loop_claims (activity_id, user_id, competition_id, rule_version, received_at) values (gen_random_uuid(), auth.uid(), '00000000-0000-4000-8000-000000000031', 'x', now())$$,
  '42501', null, 'clients cannot write loop claims');
select throws_ok($$update public.entitlements set is_active = true$$, '42501', null, 'clients cannot write entitlements');
select throws_ok($$select * from internal.cell_control$$, '42501', null, 'internal schema is closed to clients');
select throws_ok($$select internal.apply_claim(gen_random_uuid())$$, '42501', null, 'clients cannot call internal functions');
select throws_ok($$update public.user_settings set territory_competition_enabled = true$$, '42501', null, 'contest consent flags only change through set_consent');
select throws_ok($$update public.profiles set status = 'active' where id = auth.uid()$$, '42501', null, 'clients cannot change account status');
select lives_ok($$update public.profiles set display_name = 'Ali' where id = auth.uid()$$, 'A can edit own display name');
select is((select count(*)::int from public.profiles where display_name = 'Ali'), 1, 'own edit applied');
select lives_ok($$update public.profiles set display_name = 'Hacked' where id = '22222222-2222-4222-8222-222222222222'$$, 'update of another profile is silently filtered');
reset role;
select is((select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'New runner', 'another user''s profile was not modified');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok($$select public.set_consent('territory_competition', true, 'v1')$$, 'set_consent works for the owner');
select is((select territory_competition_enabled from public.user_settings where user_id = auth.uid()), true, 'consent flag follows the ledger');
select is((select count(*)::int from public.consents where user_id = auth.uid() and kind = 'territory_competition'), 1, 'consent version and timestamp are stored');
-- Protected areas are private to their owner.
select lives_ok($$insert into public.protected_areas (user_id, label, center, radius_m) values (auth.uid(), 'home', 'SRID=4326;POINT(67.0 24.86)'::extensions.geography, 300)$$, 'owner can add a protected area');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.protected_areas), 0, 'B cannot see A''s protected areas');
select is((select count(*)::int from public.consents), 0, 'B cannot see A''s consents');
reset role;

select * from finish();
rollback;
