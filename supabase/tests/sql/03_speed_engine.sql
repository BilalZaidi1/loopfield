-- Speed titles: margin rule, replay independence from arrival order, invalidation replay,
-- publication delay, and strict independence from land (FR14, FR15, FR16, FR31, Appendix A).
begin;
select plan(12);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'a1@example.test'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'b2@example.test'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'c3@example.test');

insert into public.courses (id, region_id, creator_id, name) values ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Test loop');
insert into public.course_versions (id, course_id, version, path, length_m, closed, start_gate, finish_gate, start_bearing, finish_bearing, checkpoints, corridor_m)
values ('dddddddd-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 1,
        'SRID=4326;LINESTRING(67.0 24.86, 67.01 24.86, 67.01 24.87, 67.0 24.86)', 3200, true,
        'SRID=4326;LINESTRING(67.0 24.8599, 67.0 24.8601)', 'SRID=4326;LINESTRING(67.0 24.8599, 67.0 24.8601)', 90, 90, '[]', 20);
update public.courses set current_version_id = 'dddddddd-0000-4000-8000-000000000002' where id = 'dddddddd-0000-4000-8000-000000000001';

create function pg_temp.attempt(p_user uuid, p_hour int, p_seconds int, p_publish_after timestamptz default now() - interval '1 minute') returns uuid language plpgsql as $$
declare v_act uuid := gen_random_uuid(); v uuid;
begin
  insert into public.activities (id, user_id, started_at, ended_at, status) values (v_act, p_user, now() - interval '5 hours', now() - interval '4 hours', 'processed');
  insert into public.speed_attempts (activity_id, user_id, course_version_id, competition_id, season_id, status, rule_version, completed_at, elapsed_ms, uncertainty_ms, received_at, publish_after)
  values (v_act, p_user, 'dddddddd-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 'eligible', 'speed-test',
          date_trunc('day', now()) + make_interval(hours => p_hour), p_seconds * 1000, 1000, now(), p_publish_after)
  returning id into v;
  return v;
end $$;

create function pg_temp.champ() returns uuid language sql as $$
  select champion_id from internal.speed_titles where course_version_id = 'dddddddd-0000-4000-8000-000000000002' $$;
create function pg_temp.refresh(cause text default 'attempt') returns void language sql as $$
  select internal.refresh_title('dddddddd-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', cause) $$;

-- Land present before any speed activity; titles must never alter it.
insert into internal.territory_cells (cell, resolution, geom, area_m2, parent_r7) values (555, 11, 'SRID=4326;POLYGON((67 24.86,67.001 24.86,67.001 24.861,67 24.861,67 24.86))', 10000, 1);
insert into internal.cell_control (competition_id, season_id, cell, controller_id, claim_id, claim_completed_at)
values ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', 555, 'bbbbbbbb-0000-4000-8000-0000000000b2', null, now());

-- Arrival order C, A, B (completion order A 09:00, B 10:00, C 11:00).
create temp table att as select pg_temp.attempt('cccccccc-0000-4000-8000-0000000000c3', 11, 650) c;
select pg_temp.refresh();
alter table att add column a uuid; update att set a = pg_temp.attempt('aaaaaaaa-0000-4000-8000-0000000000a1', 9, 660);
select pg_temp.refresh();
alter table att add column b uuid; update att set b = pg_temp.attempt('bbbbbbbb-0000-4000-8000-0000000000b2', 10, 655);
select pg_temp.refresh();

select is(pg_temp.champ(), 'cccccccc-0000-4000-8000-0000000000c3'::uuid, 'C (650 s) beats the 660 s benchmark regardless of arrival order');
select is((select benchmark_ms from internal.speed_titles where course_version_id = 'dddddddd-0000-4000-8000-000000000002'), 650000, 'benchmark is C''s time');

-- Compute-only check of the near tie: A then B only.
select is((select last_kind from internal.compute_title('dddddddd-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041', null)),
          'takeover', 'C took the title from A by more than the margin');

-- Invalidate A: B becomes first champion at 655 s; C (650 s) is inside 1% of 655 s => B retains.
select lives_ok($$select internal.invalidate_attempt((select a from att), 'invalid', 'staff_invalidated', null)$$, 'A invalidated');
select is(pg_temp.champ(), 'bbbbbbbb-0000-4000-8000-0000000000b2'::uuid, 'after replay B holds the title (near tie protects the incumbent)');
select is((select kind from internal.speed_title_changes where course_version_id = 'dddddddd-0000-4000-8000-000000000002' order by id desc limit 1), 'correction', 'title change is logged as a correction');

-- Restore A via appeal: C champion again.
select lives_ok($$select internal.restore_attempt((select a from att), null)$$, 'A restored after appeal');
select is(pg_temp.champ(), 'cccccccc-0000-4000-8000-0000000000c3'::uuid, 'replay after restoration returns C');

-- Land untouched by every title operation.
select is((select controller_id from internal.cell_control where cell = 555), 'bbbbbbbb-0000-4000-8000-0000000000b2'::uuid, 'title changes never transfer land');

-- Publication delay: a newer winning attempt is not public until due.
create temp table att2 as select pg_temp.attempt('aaaaaaaa-0000-4000-8000-0000000000a1', 12, 600, now() + interval '30 minutes') x;
select pg_temp.refresh();
select is(pg_temp.champ(), 'aaaaaaaa-0000-4000-8000-0000000000a1'::uuid, 'authoritative state includes the new winning attempt');
select is((select published_champion_id from internal.speed_titles where course_version_id = 'dddddddd-0000-4000-8000-000000000002'), 'cccccccc-0000-4000-8000-0000000000c3'::uuid, 'published state waits for the publication delay');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select is((public.speed_route_detail('dddddddd-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000041') ->> 'required_ms')::int, 643500, 'route detail exposes the time needed (650 s - 6.5 s margin)');
reset role;

select * from finish();
rollback;
