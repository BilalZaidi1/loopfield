import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { areaAt, contains, parseWkbPolygons, placeLabel, type AreaShape } from '@/features/profile/areas';
import { AreaPicker, groupByRegion } from '@/features/profile/AreaPicker';
import { countryName } from '@/lib/countries';
import { fmtRuleDistance } from '@/lib/format';

// The two halves of the development test area around central Karachi, exactly as loopfield-dev returns them.
// (Self-contained: jest hoists the mock factories that read it above everything else in this file.)
const mockRows = [
  { id: 'north', name: 'Dev North', region_id: 'dev', regions: { name: 'Development region (Karachi test area)', country_code: 'PK' },
    geom: '0106000020E61000000100000001030000000100000005000000CDCCCCCCCCBC5040A4703D0AD7E33840CDCCCCCCCCBC50407B14AE47E1FA38409A99999999C950407B14AE47E1FA38409A99999999C95040A4703D0AD7E33840CDCCCCCCCCBC5040A4703D0AD7E33840' },
  { id: 'south', name: 'Dev South', region_id: 'dev', regions: { name: 'Development region (Karachi test area)', country_code: 'PK' },
    geom: '0106000020E61000000100000001030000000100000005000000CDCCCCCCCCBC5040CDCCCCCCCCCC3840CDCCCCCCCCBC5040A4703D0AD7E338409A99999999C95040A4703D0AD7E338409A99999999C95040CDCCCCCCCCCC3840CDCCCCCCCCBC5040CDCCCCCCCCCC3840' }
];
const ROWS = mockRows;
const DEV_NORTH = mockRows[0]!.geom;
const REGION = mockRows[0]!.regions;

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
  reverseGeocodeAsync: jest.fn(async () => mockPlace.named)
}));

const mockPlace: { permission: string; coords: { latitude: number; longitude: number }; named: { city?: string; country?: string; isoCountryCode?: string }[] } = {
  permission: 'granted', coords: { latitude: 24.93, longitude: 67.05 }, named: [{ city: 'Karachi', country: 'Pakistan', isoCountryCode: 'PK' }]
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

describe('supported areas', () => {
  const shapes: AreaShape[] = ROWS.map((r) => ({ id: r.id, name: r.name, region_id: r.region_id, region_name: r.regions.name, country_code: r.regions.country_code, polygons: parseWkbPolygons(r.geom) }));

  it('reads PostGIS shapes as the database sends them', () => {
    const [north] = parseWkbPolygons(DEV_NORTH);
    expect(north![0]).toHaveLength(5);
    expect(north![0]![0]![0]).toBeCloseTo(66.95, 6);
    expect(north![0]![0]![1]).toBeCloseTo(24.89, 6);
    expect(parseWkbPolygons('not hex')).toEqual([]);
    expect(parseWkbPolygons('0101000020E6100000')).toEqual([]);
  });

  it('finds the area a position is in, and none outside them all', () => {
    expect(areaAt(shapes, 67.05, 24.93)?.name).toBe('Dev North');
    expect(areaAt(shapes, 67.05, 24.85)?.name).toBe('Dev South');
    expect(areaAt(shapes, 55.27, 25.2)).toBeNull();
    // A hole in a polygon is not inside it.
    expect(contains([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]], [5, 5])).toBe(false);
  });

  it('names countries and groups areas under their region', () => {
    expect(countryName('PK')).toBe('Pakistan');
    expect(countryName('ae')).toBe('United Arab Emirates');
    expect(countryName(null)).toBeNull();
    expect(groupByRegion([{ id: 'n', name: 'Dev North', region_id: 'dev', region_name: REGION.name, country_code: 'PK' }])[0]!.title).toBe('Pakistan · Development region (Karachi test area)');
    expect(placeLabel({ city: 'Karachi', country: 'Pakistan' }, null)).toBe('Karachi, Pakistan');
    expect(placeLabel(null, 'Pakistan')).toBe('Pakistan');
  });

  it('writes rule distances so short minimums never round to zero', () => {
    expect(fmtRuleDistance(400, 'metric')).toBe('400 m');
    expect(fmtRuleDistance(1_500, 'metric')).toBe('1.5 km');
    expect(fmtRuleDistance(30_000, 'metric')).toBe('30 km');
    expect(fmtRuleDistance(400, 'imperial')).toBe('1,312 ft');
  });
});

describe('the city picker', () => {
  it('detects the country, city and Loopfield area from the location', async () => {
    const onChange = jest.fn();
    mockPlace.coords = { latitude: 24.93, longitude: 67.05 };
    await render(wrap(<AreaPicker value={null} cityLabel={null} onChange={onChange} />));
    await settle();
    expect(screen.getByText('Pakistan · Development region (Karachi test area)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use my location to find my city'));
    await settle();
    expect(onChange).toHaveBeenCalledWith('north', 'Dev North');
    expect(screen.getByText("You're in Karachi, Pakistan")).toBeTruthy();
    expect(screen.getByText(/Your Loopfield area is Dev North, part of Development region \(Karachi test area\)/)).toBeTruthy();
  });

  it('keeps the detected city outside every area, without an area', async () => {
    const onChange = jest.fn();
    mockPlace.coords = { latitude: 25.2, longitude: 55.27 };
    mockPlace.named = [{ city: 'Dubai', country: 'United Arab Emirates', isoCountryCode: 'AE' }];
    await render(wrap(<AreaPicker value={null} cityLabel={null} onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to find my city'));
    await settle();
    expect(onChange).toHaveBeenCalledWith(null, 'Dubai, United Arab Emirates');
    expect(screen.getByText(/Loopfield has no playing area here yet/)).toBeTruthy();
  });

  it('asks for location access instead of guessing', async () => {
    mockPlace.permission = 'denied';
    const onChange = jest.fn();
    await render(wrap(<AreaPicker value={null} cityLabel={null} onChange={onChange} />));
    await settle();
    await fireEvent.press(screen.getByLabelText('Use my location to find my city'));
    await settle();
    expect(screen.getByText('Allow location to find your city, or pick your area below.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    mockPlace.permission = 'granted';
  });
});
