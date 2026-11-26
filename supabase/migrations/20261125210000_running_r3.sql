-- Running features, stage 3 (R3): Bluetooth heart-rate straps and maps of imported runs. Both live on the phone:
-- strap readings and imported routes go into the phone's health cache and are never uploaded, so the server only
-- needs the strap switch. Maps of imported runs have no switch of their own: the back office hides them by adding
-- `imported_routes` to `disabled_health_cards`, as it does for `training`.

insert into public.app_config (key, value, is_public, description) values
  ('ble_sensors_enabled', 'true', true, 'Off hides heart-rate straps and stops the phone connecting to one.')
on conflict (key) do nothing;

insert into internal.config_registry (key, label, category, value_type, min_value, max_value, allowed, min_role, sort, help) values
  ('ble_sensors_enabled', 'Heart-rate straps', 'switch', 'boolean', null, null, null, 'territory_operator', 28,
   'Off hides Settings → Sensors and no strap is connected during runs. Readings already on phones stay there.')
on conflict (key) do update set label = excluded.label, category = excluded.category, value_type = excluded.value_type, min_value = excluded.min_value,
  max_value = excluded.max_value, allowed = excluded.allowed, min_role = excluded.min_role, sort = excluded.sort, help = excluded.help;
