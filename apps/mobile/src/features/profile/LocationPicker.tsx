import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import * as Location from 'expo-location';
import { countryName, findCountries } from '@/lib/countries';
import { Banner, Button, ListGroup, Row, Sheet, TextField, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, usePalette } from '@/theme/tokens';
import { areaAt } from './areas';
import { loadAreaShapes } from './districts';
import { PLACE_MAX, placeFromGeocode, placeText, sameCity } from './location';

/** The location part of the profile form, as typed (empty strings for parts not set). */
export interface LocationDraft {
  city: string;
  countryCode: string | null;
  area: string;
  showArea: boolean;
  /** Loopfield's playing area the phone found the runner in, if any; only detection sets it. */
  districtId: string | null;
}

export const NO_LOCATION: LocationDraft = { city: '', countryCode: null, area: '', showArea: false, districtId: null };

type Status =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'found'; text: string; partial: boolean }
  | { state: 'error'; message: string; settings?: boolean };

/**
 * Where the runner runs: "Use my location" asks the phone once where it is and lets the phone's own map
 * service name the city, country and neighbourhood (anywhere in the world); every part stays editable.
 * The city and country show on the profile and decide city and country rankings and Discover; the
 * neighbourhood is shown only to the runner unless they choose to show it. The position itself is never
 * sent anywhere: the phone also checks on its own whether it lies in one of Loopfield's playing areas.
 */
export function LocationPicker({ value, onChange }: { value: LocationDraft; onChange: (next: LocationDraft) => void }) {
  const p = usePalette();
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => findCountries(query), [query]);
  const country = countryName(value.countryCode);
  const set = (patch: Partial<LocationDraft>) => onChange({ ...value, ...patch });

  const locate = async () => {
    setStatus({ state: 'busy' });
    try {
      if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) {
        return setStatus({ state: 'error', message: 'Location is off on this phone. Turn it on, or type your city below.', settings: true });
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        return setStatus({ state: 'error', message: 'Allow location to fill this in, or type your city below.', settings: Platform.OS !== 'web' });
      }
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000, requiredAccuracy: 2_000 }).catch(() => null))
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const { latitude, longitude } = pos.coords;
      const [named, shapes] = await Promise.all([
        Location.reverseGeocodeAsync({ latitude, longitude }).then((r) => r[0] ?? null).catch(() => null),
        loadAreaShapes().catch(() => [])
      ]);
      const place = placeFromGeocode(named);
      const district = areaAt(shapes, longitude, latitude);
      const countryCode = place.countryCode ?? district?.country_code ?? null;
      if (!place.city && !countryCode) {
        return setStatus({ state: 'error', message: Platform.OS === 'web' ? 'This browser cannot name places. Type your city and choose your country below.' : 'Your phone could not name this place just now. Type your city and choose your country below.' });
      }
      const city = place.city ?? value.city;
      const area = place.area ?? (sameCity(city, value.city) ? value.area : '');
      onChange({ city, countryCode: countryCode ?? value.countryCode, area, showArea: value.showArea && Boolean(area), districtId: district?.id ?? null });
      setStatus({ state: 'found', text: placeText(place.city, countryCode, place.area) ?? '', partial: !place.city });
    } catch {
      setStatus({ state: 'error', message: 'Your location could not be found just now. Try again outside, or type your city below.' });
    }
  };

  const hasPlace = Boolean(value.city.trim() || value.countryCode);
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Txt variant="label">Where you run</Txt>
        <Txt variant="caption">Your city and country show on your profile. They decide your city and country rankings and who you meet in Discover.</Txt>
      </View>
      <Button variant="secondary" icon="locate" label={status.state === 'busy' ? 'Finding where you are…' : 'Use my location'} loading={status.state === 'busy'}
        onPress={() => void locate()} accessibilityLabel="Use my location to fill in my city and country" />
      {status.state === 'found' ? (
        <Banner tone="success" text={status.partial ? `Found ${status.text}. Type your city below, then save.` : `Found ${status.text}. Check the names below, then save.`} />
      ) : null}
      {status.state === 'error' ? (
        <Banner tone="warning" text={status.message} action={status.settings ? { label: 'Settings', onPress: () => void Linking.openSettings() } : undefined} />
      ) : null}
      <TextField label="City" value={value.city} onChangeText={(t) => set({ city: t.slice(0, PLACE_MAX) })} autoCapitalize="words" placeholder="For example Karachi" />
      <View style={{ gap: spacing.xs + 2 }}>
        <Txt variant="label">Country</Txt>
        <Pressable onPress={() => { setQuery(''); setPicking(true); }} accessibilityRole="button" accessibilityLabel={country ? `Country: ${country}. Change` : 'Choose your country'}
          style={({ pressed }) => ({ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.surface, opacity: pressed ? 0.75 : 1 })}>
          <Icon name="globe" color={country ? p.text : p.textSubtle} size={20} />
          <Txt style={{ flex: 1 }} color={country ? 'text' : 'textSubtle'}>{country ?? 'Choose your country'}</Txt>
          <Icon name="chevron-down" color={p.textMuted} size={20} />
        </Pressable>
        {value.city.trim() && !value.countryCode ? <Txt variant="caption">Choose your country as well, so runners in your city can find you.</Txt> : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <TextField label="Area or neighbourhood (optional)" value={value.area} onChangeText={(t) => set({ area: t.slice(0, PLACE_MAX), showArea: value.showArea && Boolean(t.trim()) })}
          autoCapitalize="words" placeholder="For example Gulistan-e-Johar" />
        {value.area.trim() ? null : <Txt variant="caption">Only you see your area unless you choose to show it.</Txt>}
      </View>
      {value.area.trim() ? (
        <Toggle label="Show my area on my profile" value={value.showArea} onChange={(v) => set({ showArea: v })}
          description={value.showArea ? `Others see ${placeText(value.city, value.countryCode, value.area) ?? value.area.trim()}.` : `Only you see it. Others see ${placeText(value.city, value.countryCode) ?? 'your city'}.`} />
      ) : null}
      {hasPlace ? <Button variant="ghost" size="sm" icon="close" label="Remove my location" onPress={() => { onChange(NO_LOCATION); setStatus({ state: 'idle' }); }} /> : null}
      <Txt variant="caption">{"Your position is checked once, on this phone, to fill these in, and your phone's map service names the place. Loopfield does not keep your position."}</Txt>

      <Sheet visible={picking} title="Country" onClose={() => setPicking(false)}>
        <TextField label="Search countries" value={query} onChangeText={setQuery} autoCapitalize="words" placeholder="Type a country" />
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          {matches.length ? (
            <ListGroup>
              {matches.map((c) => (
                <Row key={c.code} title={c.name} accessibilityLabel={c.code === value.countryCode ? `${c.name}, selected` : c.name}
                  right={c.code === value.countryCode ? <Icon name="check" color={p.primary} size={22} /> : undefined}
                  onPress={() => { set({ countryCode: c.code }); setPicking(false); }} />
              ))}
            </ListGroup>
          ) : <Txt color="textMuted">No country matches that name.</Txt>}
        </ScrollView>
      </Sheet>
    </View>
  );
}
