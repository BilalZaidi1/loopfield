-- Running features R3: the heart-rate strap switch. Strap readings and imported routes stay on the phone, so the
-- server only carries the switch, readable by the app and changeable from the back office.
begin;
select plan(4);

select is((select value from public.app_config where key = 'ble_sensors_enabled'), 'true'::jsonb, 'heart-rate straps are on by default');
select ok((select is_public from public.app_config where key = 'ble_sensors_enabled'), 'and the app can read the switch');
select is((select (category, min_role)::text from internal.config_registry where key = 'ble_sensors_enabled'), '(switch,territory_operator)',
          'it is a switch in App control');
select is((select value_type from internal.config_registry where key = 'disabled_health_cards'), 'string_array',
          'suspended health cards take any card id, including training and imported_routes');

select * from finish();
rollback;
