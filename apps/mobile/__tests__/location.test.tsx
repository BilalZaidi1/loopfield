import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { areaAt, contains, parseWkbPolygons, type AreaShape } from '@/features/profile/areas';
import { placeFromGeocode, placeText, sameCity } from '@/features/profile/location';
import { LocationPicker, NO_LOCATION, type LocationDraft } from '@/features/profile/LocationPicker';
import { countryName, findCountries } from '@/lib/countries';
import { fmtRuleDistance } from '@/lib/format';

// The two halves of the development test area around central Karachi, exactly as loopfield-dev returns them.
// (Self-contained: jest hoists the mock factories that read it above everything else in this file.)
const mockRows = [
  { id: 'north', name: 'Dev North', region_id: 'dev', regions: { name: 'Development region (Karachi test area)', country_code: 'PK' },
    geom: '0106000020E61000000100000001030000000100000005000000CDCCCCCCCCBC5040A4703D0AD7E33840CDCCCCCCCCBC50407B14AE47E1FA38409A99999999C950407B14AE47E1FA38409A99999999C95040A4703D0AD7E33840CDCCCCCCCCBC5040A4703D0AD7E33840' },
  { id: 'south', name: 'Dev South', region_id: 'dev', regions: { name: 'Development region (Karachi test area)', country_code: 'PK' },
    geom: '0106000020E61000000100000001030000000100000005000000CDCCCCCCCCBC5040CDCCCCCCCCCC3840CDCCCCCCCCBC5040A4703D0AD7E338409A99999999C95040A4703D0AD7E338409A99999999C95040CDCCCCCCCCCC3840CDCCCCCCCCBC5040CDCCCCCCCCCC3840' }
];

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({ from: () => ({ select: (cols: string) => {
    const rows = cols.includes('geom') ? mockRows : mockRows.map(({ geom: _geom, ...r }) => r);
    const result = Promise.resolve({ data: rows, error: null });
    return Object.assign(result, { order: () => result });
  } }) })
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  hasServicesEnabledAsync: jest.fn(async () => true),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: mockPlace.permission })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: mockPlace.coords })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: mockPlace.coords })),
  reverseGeocodeAsync: jest.fn(async () => {
    if (!mockPlace.named) throw new Error('Geocoding is not available on this platform');
    return mockPlace.named;
  })
}));

const KARACHI = [{ city: 'Karachi', district: 'Gulistan-e-Johar', subregion: 'Karachi East', region: 'Sindh', country: 'Pakistan', isoCountryCode: 'PK' }];
const mockPlace: { permission: string; coords: { latitude: number; longitude: number }; named: Record<string, string>[] | null } = {
  permission: 'granted', coords: { latitude: 24.93, longitude: 67.12 }, named: KARACHI
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

/** The picker inside a form that keeps its value, reporting every change. */
function Harness({ initial = NO_LOCATION, onChange }: { initial?: LocationDraft; onChange: (v: LocationDraft) => void }) {
  const [value, setValue] = useState(initial);
  return <LocationPicker value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
}

beforeEach(() => {
  mockPlace.permission = 'granted';
  mockPlace.coords = { latitude: 24.93, longitude: 67.12 };
  mockPlace.named = KARACHI;
});

describe('places', () => {
  it('reads the city, country and neighbourhood from the phone geocoder, anywhere', () => {
    expect(placeFromGeocode(KARACHI[0])).toEqual({ city: 'Karachi', countryCode: 'PK', area: 'Gulistan-e-Johar' });
    expect(placeFromGeocode({ city: 'London', district: 'Hackney', isoCountryCode: 'gb' })).toEqual({ city: 'London', countryCode: 'GB', area: 'Hackney' });
    // Without a city the county stands in; a neighbourhood that only repeats the city is dropped.
    expect(placeFromGeocode({ subregion: 'Kreis Steinburg', district: 'Kreis Steinburg', isoCountryCode: 'DE' })).toEqual({ city: 'Kreis Steinburg', countryCode: 'DE', area: null });
    expect(placeFromGeocode({ city: '  New   York ', isoCountryCode: 'USA' })).toEqual({ city: 'New York', countryCode: null, area: null });
    expect(placeFromGeocode(null)).toEqual({ city: null, countryCode: null, area: null });
  });

  it('writes a place with the parts that are known', () => {
    expect(placeText('Karachi', 'PK', 'Gulistan-e-Johar')).toBe('Gulistan-e-Johar, Karachi, Pakistan');
    expect(placeText('Karachi', 'PK')).toBe('Karachi, Pakistan');
    expect(placeText('Karachi, Pakistan', 'PK')).toBe('Karachi, Pakistan');
    expect(placeText(null, 'GB')).toBe('United Kingdom');
    expect(placeText('Lahore', null)).toBe('Lahore');
    expect(placeText(' ', null)).toBeNull();
    expect(sameCity(' karachi', 'Karachi ')).toBe(true);
    expect(sameCity(null, null)).toBe(false);
  });

  it('finds countries by name or code', () => {
    expect(countryName('PK')).toBe('Pakistan');
    expect(findCountries('pak')[0]).toEqual({ code: 'PK', name: 'Pakistan' });
    expect(findCountries('gb')[0]!.name).toBe('United Kingdom');
    expect(findCountries('united').map((c) => c.code)).toEqual(expect.arrayContaining(['AE', 'GB', 'US']));
    expect(findCountries('zzzz')).toEqual([]);
  });

  it('still knows which playing area a position is in', () => {
    const shapes: AreaShape[] = mockRows.map((r) => ({ id: r.id, name: r.name, region_id: r.region_id, region_name: r.regions.name, country_code: r.regions.country_code, polygons: parseWkbPolygons(r.geom) }));
    const [north] = parseWkbPolygons(mockRows[0]!.geom);
    expect(north![0]![0]![0]).toBeCloseTo(66.95, 6);
    expect(parseWkbPolygons('not hex')).toEqual([]);
    expect(areaAt(shapes, 67.05, 24.93)?.id).toBe('north');
    expect(areaAt(shapes, 67.05, 24.85)?.id).toBe('south');
    expect(areaAt(shapes, 55.27, 25.2)).toBeNull();
    expect(contains([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]], [5, 5])).toBe(false);
  });

  it('writes rule distances so short minimums never round to zero', () => {
    expect(fmtRuleDistance(400, 'metric')).toBe('400 m');
    expect(fmtRuleDistance(1_500, 'metric')).toBe('1.5 km');
    expect(fmtRuleDistance(400, 'imperial')).toBe('1,312 ft');
  });
});

describe('where you run', () => {
  it('fills in city, country and area from the location, without naming playing areas', async () => {
    const onChange = jest.fn();
    await render(wrap(<Harness onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to fill in my city and country'));
    await settle();
    expect(onChange).toHaveBeenLastCalledWith({ city: 'Karachi', countryCode: 'PK', area: 'Gulistan-e-Johar', showArea: false, districtId: 'north' });
    expect(screen.getByText('Found Gulistan-e-Johar, Karachi, Pakistan. Check the names below, then save.')).toBeTruthy();
    expect(screen.getByLabelText('Country: Pakistan. Change')).toBeTruthy();
    expect(screen.queryByText(/Dev North|Dev South/)).toBeNull();
    // The area stays private until the runner chooses to show it.
    expect(screen.getByText('Only you see it. Others see Karachi, Pakistan.')).toBeTruthy();
  });

  it('works outside every playing area', async () => {
    const onChange = jest.fn();
    mockPlace.coords = { latitude: 51.55, longitude: -0.06 };
    mockPlace.named = [{ city: 'London', district: 'Hackney', country: 'United Kingdom', isoCountryCode: 'GB' }];
    await render(wrap(<Harness onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to fill in my city and country'));
    await settle();
    expect(onChange).toHaveBeenLastCalledWith({ city: 'London', countryCode: 'GB', area: 'Hackney', showArea: false, districtId: null });
  });

  it('keeps the country when the phone cannot name the place', async () => {
    const onChange = jest.fn();
    mockPlace.named = null;
    await render(wrap(<Harness onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to fill in my city and country'));
    await settle();
    expect(onChange).toHaveBeenLastCalledWith({ city: '', countryCode: 'PK', area: '', showArea: false, districtId: 'north' });
    expect(screen.getByText('Found Pakistan. Type your city below, then save.')).toBeTruthy();
  });

  it('asks for location access instead of guessing', async () => {
    mockPlace.permission = 'denied';
    const onChange = jest.fn();
    await render(wrap(<Harness onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to fill in my city and country'));
    await settle();
    expect(screen.getByText('Allow location to fill this in, or type your city below.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the runner type everything and choose to show their area', async () => {
    const onChange = jest.fn();
    await render(wrap(<Harness onChange={onChange} />));
    await settle();
    await fireEvent.changeText(screen.getByLabelText('City'), 'Karachi');
    expect(screen.getByText('Choose your country as well, so runners in your city can find you.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Choose your country'));
    await fireEvent.changeText(screen.getByLabelText('Search countries'), 'paki');
    await fireEvent.press(screen.getByText('Pakistan'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ city: 'Karachi', countryCode: 'PK' }));
    expect(screen.queryByText('Show my area on my profile')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Area or neighbourhood (optional)'), 'Clifton');
    await fireEvent(screen.getByLabelText('Show my area on my profile'), 'valueChange', true);
    expect(onChange).toHaveBeenLastCalledWith({ city: 'Karachi', countryCode: 'PK', area: 'Clifton', showArea: true, districtId: null });
    expect(screen.getByText('Others see Clifton, Karachi, Pakistan.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Remove my location'));
    expect(onChange).toHaveBeenLastCalledWith(NO_LOCATION);
  });
});
