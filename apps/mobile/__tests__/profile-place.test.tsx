import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ProfileForm } from '@/features/profile/ProfileForm';
import { existingRequest } from '@/features/appeals/requests';
import type { Profile } from '@/state/session';

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => ({}) }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/features/avatar/AvatarBuilder', () => ({ AvatarBuilder: () => null }));
jest.mock('@/features/social/media', () => ({ useSignedUrl: () => ({ data: null }), prepareImage: jest.fn(), uploadToBucket: jest.fn() }));
jest.mock('@/lib/appConfig', () => ({ ...jest.requireActual('@/lib/appConfig'), useFeature: (key: string) => mockFeatures[key] ?? true }));
jest.mock('@/state/session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/supabase', () => ({
  supabase: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({ eq: async () => { mockWrites.push({ table, patch }); return { error: null }; } })
    })
  })
}));

const mockFeatures: Record<string, boolean> = {};
const mockWrites: { table: string; patch: Record<string, unknown> }[] = [];
const mockSession = {
  userId: 'me',
  refresh: jest.fn(async () => undefined),
  settings: { area_label: 'Gulistan-e-Johar', show_area: true, units: 'metric' }
};

const PROFILE: Profile = {
  id: 'me', handle: 'bilal_runs', display_name: 'Bilal', bio: null, avatar_path: null, district_id: 'north', city_label: 'Karachi', country_code: 'PK',
  visibility: 'private', discoverable: false, status: 'active', onboarding_completed_at: '2026-11-01T10:00:00Z'
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
const write = (table: string) => mockWrites.find((w) => w.table === table)?.patch;

beforeEach(() => {
  mockWrites.length = 0;
  for (const k of Object.keys(mockFeatures)) delete mockFeatures[k];
});

describe('saving where you run', () => {
  it('keeps city and country on the profile and the area in the runner\'s own settings', async () => {
    const onSaved = jest.fn();
    await render(wrap(<ProfileForm profile={PROFILE} units="metric" submitLabel="Save" onSaved={onSaved} />));
    await settle();
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(write('profiles')).toEqual(expect.objectContaining({ city_label: 'Karachi', country_code: 'PK', district_id: 'north' }));
    expect(write('profiles')).not.toHaveProperty('area_label');
    expect(write('user_settings')).toEqual({ units: 'metric', area_label: 'Gulistan-e-Johar', show_area: true });
    expect(onSaved).toHaveBeenCalled();
  });

  it('clears everything, the playing area too, when the location is removed', async () => {
    await render(wrap(<ProfileForm profile={PROFILE} units="metric" submitLabel="Save" onSaved={jest.fn()} />));
    await settle();
    await fireEvent.press(screen.getByText('Remove my location'));
    await fireEvent.press(screen.getByText('Save'));
    await settle();
    expect(write('profiles')).toEqual(expect.objectContaining({ city_label: null, country_code: null, district_id: null }));
    expect(write('user_settings')).toEqual({ units: 'metric', area_label: null, show_area: false });
  });

  it('keeps the drawn avatar while photo uploads are paused', async () => {
    mockFeatures.avatar_uploads_enabled = false;
    await render(wrap(<ProfileForm profile={PROFILE} units="metric" submitLabel="Save" onSaved={jest.fn()} />));
    await settle();
    expect(screen.queryByText('Photo')).toBeNull();
    expect(screen.getByText('Avatar')).toBeTruthy();
    expect(screen.getByText('New profile photos are paused for now. You can still make a drawn avatar, and your current picture stays.')).toBeTruthy();
    expect(screen.getByLabelText('Make an avatar (optional)')).toBeTruthy();
  });
});

describe('a review of a suspension', () => {
  const row = (created_at: string, status: 'submitted' | 'upheld' = 'submitted') => ({ id: created_at, object_type: 'account_action', object_id: 'x', reason: 'Please look again', status, response: null, created_at, decided_at: null });

  it('is asked once per suspension', () => {
    const since = '2026-11-18T09:00:00Z';
    expect(existingRequest([row('2026-11-01T09:00:00Z', 'upheld')], 'account_action', 'me', since)).toBeUndefined();
    expect(existingRequest([row('2026-11-18T09:05:00Z')], 'account_action', 'me', since)?.id).toBe('2026-11-18T09:05:00Z');
    // Without the suspension's start, only an open request counts.
    expect(existingRequest([row('2026-11-01T09:00:00Z', 'upheld')], 'account_action', 'me', null)).toBeUndefined();
    expect(existingRequest([row('2026-11-01T09:00:00Z')], 'account_action', 'me', null)).toBeDefined();
  });

  it('other decisions match by what was decided', () => {
    const post = { ...row('2026-11-18T09:05:00Z'), object_type: 'post', object_id: 'p1' };
    expect(existingRequest([post], 'post', 'p1', null)).toBe(post);
    expect(existingRequest([post], 'post', 'p2', null)).toBeUndefined();
  });
});
