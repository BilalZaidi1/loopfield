-- Development seed data. Creates one clearly-labelled development region so the app and tests can
-- exercise competition flows. It contains NO users, activities, posts or health data: production
-- screens never show fabricated activity. Do not run against production.
--
-- The development region boundary is an approximate rectangle around central Karachi chosen only
-- because it is the founder's location; the launch city remains an open decision (PRD §1, §20).

insert into public.regions (id, slug, name, timezone, geom, status, exclusion_review_status, exclusion_set_version, country_code)
values (
  '00000000-0000-4000-8000-000000000001', 'dev-karachi', 'Development region (Karachi test area)', 'Asia/Karachi',
  extensions.st_multi(extensions.st_makeenvelope(66.95, 24.80, 67.15, 24.98, 4326))::extensions.geography,
  'active', 'reviewed', 'dev-exclusions-1', 'PK'
) on conflict (id) do nothing;

insert into public.districts (id, region_id, slug, name, geom) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'dev-south', 'Dev South',
   extensions.st_multi(extensions.st_makeenvelope(66.95, 24.80, 67.15, 24.89, 4326))::extensions.geography),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'dev-north', 'Dev North',
   extensions.st_multi(extensions.st_makeenvelope(66.95, 24.89, 67.15, 24.98, 4326))::extensions.geography)
on conflict (id) do nothing;

-- One reviewed development exclusion (a placeholder "restricted" rectangle) to exercise the rule.
insert into public.exclusion_zones (id, region_id, set_version, kind, geom, reason)
values ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'dev-exclusions-1', 'restricted',
        extensions.st_multi(extensions.st_makeenvelope(67.120, 24.950, 67.130, 24.960, 4326))::extensions.geography,
        'Development placeholder exclusion')
on conflict (id) do nothing;

insert into public.competitions (id, kind, region_id, name)
values ('00000000-0000-4000-8000-000000000031', 'public', '00000000-0000-4000-8000-000000000001', 'Development public competition')
on conflict (id) do nothing;

insert into public.seasons (id, competition_id, number, starts_at, ends_at, status, grid_resolution, boundary_band_m, territory_rules_version, speed_rules_version, exclusion_set_version)
values ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000031', 1,
        date_trunc('day', now()) - interval '1 day', date_trunc('day', now()) + interval '27 days', 'active', 11, 10,
        'territory-2026.11.0-proposed', 'speed-2026.11.0-proposed', 'dev-exclusions-1')
on conflict (id) do nothing;
