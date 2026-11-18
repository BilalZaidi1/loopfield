import { useMemo, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import { countryName } from '@/lib/countries';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Card, Chip, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { areaAt, parseWkbPolygons, placeLabel, type AreaShape } from './areas';

/** A supported area runners can belong to (a district inside a region), with its region and country. */
export interface District {
  id: string;
  name: string;
  region_id: string;
  region_name?: string | null;
  country_code?: string | null;
}

interface DistrictRow {
  id: string;
  name: string;
  region_id: string;
  regions: { name: string; country_code: string | null } | null;
}

export function useDistricts() {
  return useQuery({
    queryKey: ['districts'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase().from('districts').select('id, name, region_id, regions(name, country_code)').order('name');
      if (error) throw error;
      return ((data ?? []) as unknown as DistrictRow[]).map((d): District => ({ id: d.id, name: d.name, region_id: d.region_id, region_name: d.regions?.name ?? null, country_code: d.regions?.country_code ?? null }));
    }
  });
}

/** The areas' shapes, loaded only when the runner asks to use their location. */
async function loadAreaShapes(): Promise<AreaShape[]> {
  const { data, error } = await supabase().from('districts').select('id, name, region_id, geom, regions(name, country_code)');
  if (error) throw error;
  return ((data ?? []) as unknown as (DistrictRow & { geom: string | null })[]).map((d) => ({
    id: d.id,
    name: d.name,
    region_id: d.region_id,
    region_name: d.regions?.name ?? null,
    country_code: d.regions?.country_code ?? null,
    polygons: parseWkbPolygons(d.geom)
  }));
}

/** Districts grouped under "Country · Region", in name order. */
export function groupByRegion(districts: readonly District[]): { key: string; title: string; items: District[] }[] {
  const groups = new Map<string, { key: string; title: string; items: District[] }>();
  for (const d of districts) {
    const title = [countryName(d.country_code), d.region_name].filter(Boolean).join(' · ') || 'Supported areas';
    const g = groups.get(d.region_id) ?? { key: d.region_id, title, items: [] };
    g.items.push(d);
    groups.set(d.region_id, g);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

type Detect =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'done'; place: string | null; area: AreaShape | null }
  | { state: 'error'; message: string; settings?: boolean };

/**
 * City or district: pick a supported area, or let the phone find it. "Use my location" reads the position
 * once, checks on this phone which area contains it, and asks the phone's map service for the place's
 * name (city and country). Outside every supported area the detected city is kept as the profile's city
 * label with no area, since rankings and Discover only work inside areas. Nothing is saved until the
 * runner saves the form.
 */
export function AreaPicker({ value, cityLabel, onChange }: { value: string | null; cityLabel: string | null; onChange: (districtId: string | null, cityLabel: string | null) => void }) {
  const p = usePalette();
  const districts = useDistricts();
  const groups = useMemo(() => groupByRegion(districts.data ?? []), [districts.data]);
  const [detect, setDetect] = useState<Detect>({ state: 'idle' });

  const locate = async () => {
    setDetect({ state: 'busy' });
    try {
      if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) {
        return setDetect({ state: 'error', message: 'Location services are off on this phone. Turn them on, or pick your area below.', settings: true });
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        return setDetect({ state: 'error', message: 'Allow location to find your city, or pick your area below.', settings: Platform.OS !== 'web' });
      }
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000, requiredAccuracy: 2_000 }).catch(() => null))
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const { latitude, longitude } = pos.coords;
      const area = areaAt(await loadAreaShapes(), longitude, latitude);
      // The phone's own map service names the place; the browser has none, so the area's country is used.
      const named = await Location.reverseGeocodeAsync({ latitude, longitude }).then((r) => r[0] ?? null).catch(() => null);
      const place = placeLabel(named, countryName(area?.country_code ?? named?.isoCountryCode ?? null));
      if (area) onChange(area.id, area.name);
      else if (place) onChange(null, place.slice(0, 60));
      setDetect({ state: 'done', place, area });
    } catch {
      setDetect({ state: 'error', message: 'Your location could not be found just now. Try again outside, or pick your area below.' });
    }
  };

  const detectedOutside = !value && cityLabel ? cityLabel : null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Txt variant="label">City or district</Txt>
      <Button variant="secondary" icon="locate" label={detect.state === 'busy' ? 'Finding where you are…' : 'Use my location'} loading={detect.state === 'busy'} onPress={() => void locate()} accessibilityLabel="Use my location to find my city" />
      {detect.state === 'done' ? (
        <Card tone="soft" accessibilityLabel="Detected location">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="locate" color={p.primary} size={20} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>{detect.place ? `You're in ${detect.place}` : 'Location found'}</Txt>
          </View>
          <Txt color="textMuted">
            {detect.area
              ? `Your Loopfield area is ${detect.area.name}${detect.area.region_name ? `, part of ${detect.area.region_name}` : ''}. Rankings and Discover use it.`
              : detect.place
                ? 'Loopfield has no playing area here yet, so your profile shows this city without an area. Area rankings and Discover start once an area opens here.'
                : 'Loopfield has no playing area where you are yet. Area rankings and Discover start once one opens near you.'}
          </Txt>
        </Card>
      ) : null}
      {detect.state === 'error' ? (
        <Banner tone="warning" text={detect.message} action={detect.settings ? { label: 'Settings', onPress: () => void Linking.openSettings() } : undefined} />
      ) : null}
      {districts.isLoading ? <Txt variant="caption">Loading supported areas…</Txt> : null}
      {districts.error ? <Banner tone="warning" text="Supported areas could not be loaded. You can set this later." /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="City or district">
        <Chip label="Not set" selected={!value && !cityLabel} onPress={() => onChange(null, null)} />
        {detectedOutside ? <Chip icon="locate" label={detectedOutside} selected onPress={() => onChange(null, detectedOutside)} /> : null}
      </View>
      {groups.map((g) => (
        <View key={g.key} style={{ gap: spacing.xs }}>
          <Txt variant="caption" color="textMuted">{g.title}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={g.title}>
            {g.items.map((d) => <Chip key={d.id} label={d.name} selected={value === d.id} onPress={() => onChange(d.id, d.name)} />)}
          </View>
        </View>
      ))}
      <Txt variant="caption">{"Your position is only checked on this phone to find your area, and your phone's map service names the place. Loopfield does not keep your position."}</Txt>
    </View>
  );
}
