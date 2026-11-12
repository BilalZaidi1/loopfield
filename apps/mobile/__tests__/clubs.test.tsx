import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { kindLabel, roleLabel, type ClubDetail } from '@/features/clubs/api';
import { ClubCover, ClubLogo, clubTone } from '@/features/clubs/ClubBits';
import CreateClub from '../app/(app)/club/create';
import Manage from '../app/(app)/club/[id]/organizer';

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), rpc: jest.fn(async () => []) }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: 'me' }), useUnits: () => 'metric' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/features/social/media', () => ({ useSignedUrl: () => ({ data: null }), prepareImage: jest.fn(), uploadToBucket: jest.fn() }));
jest.mock('@/features/social/PostCard', () => ({ useFeed: () => ({ data: { pages: [[]] } }) }));

const mockState: { club: ClubDetail | null } = { club: null };
const mockRemove = jest.fn();
const mockBranding = jest.fn(async () => {});
const mockParams: { id?: string; kind?: string } = { id: 'c1' };
const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, error: null });
jest.mock('@/features/clubs/api', () => ({
  ...jest.requireActual('@/features/clubs/api'),
  useClub: () => ({ data: mockState.club, isLoading: false }),
  useClubAdmin: () => ({ branding: { ...mutation(), mutateAsync: mockBranding }, details: mutation(), visibility: mutation(), setRole: mutation(), offer: mutation(), cancelOffer: mutation(), respondOffer: mutation(), remove: { ...mutation(), mutate: mockRemove } })
}));

const club = (extra: Partial<ClubDetail>): ClubDetail => ({
  id: 'c1', name: 'Harbour Striders', kind: 'community', visibility: 'public', join_policy: 'request', posting_policy: 'members', description: null, rules: null,
  my_role: 'owner', my_state: 'active', member_count: 12, pending_requests: 0, avatar_path: null, cover_path: null, artwork: null, region_id: null, ownership_offer: null,
  ...extra
} as ClubDetail);

/** Lets the screen's queries resolve (react-query notifies on a timer) before asserting. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

describe('community and group words', () => {
  it('calls admins admins and keeps the two products apart', () => {
    expect(roleLabel('organizer')).toBe('Admin');
    expect(roleLabel('owner')).toBe('Owner');
    expect(kindLabel('group')).toBe('Group');
    expect(kindLabel('community')).toBe('Community');
  });

  it('shows a monogram until a logo is uploaded, artwork on the cover, and a new photo in the preview', async () => {
    await render(<ClubLogo club={{ id: 'c1', name: 'Harbour Striders', avatar_path: null }} size={40} />);
    expect(screen.getByText('HS')).toBeTruthy();
    await render(<ClubCover club={{ id: 'c1', cover_path: null, artwork: 'tide' }} width={320} height={120} />);
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGPath');
    expect(screen.queryByLabelText('Cover photo')).toBeNull();
    await render(<ClubCover club={{ id: 'c1', cover_path: null, artwork: 'tide' }} width={320} height={120} preview={{ photoUri: 'file:///new-cover.jpg' }} />);
    expect(screen.getByLabelText('Cover photo')).toBeTruthy();
  });

  it("uses the colour the owner chose, and a stable one until they choose", () => {
    expect(clubTone({ id: 'c1', tone: 'green' })).toBe('green');
    expect(clubTone({ id: 'c1' })).toBe(clubTone({ id: 'c1', tone: null }));
    expect(['violet', 'blue', 'green', 'orange']).toContain(clubTone({ id: 'c1' }));
  });
});

describe('starting a community or a group', () => {
  it('starts only a community from "New community"', async () => {
    mockParams.kind = 'community';
    await render(wrap(<CreateClub />));
    expect(screen.getByText(/A club or local community/)).toBeTruthy();
    expect(screen.queryByText(/A private crew/)).toBeNull();
    expect(screen.getByText('Who can see it')).toBeTruthy();
  });

  it('starts only a group from "New group"', async () => {
    mockParams.kind = 'group';
    await render(wrap(<CreateClub />));
    expect(screen.getByText(/A private crew/)).toBeTruthy();
    expect(screen.queryByText(/A club or local community/)).toBeNull();
    expect(screen.queryByText('Who can see it')).toBeNull();
    delete mockParams.kind;
  });
});

describe('managing a community or group', () => {
  beforeEach(() => mockRemove.mockClear());

  it('gives the owner of a community visibility, ownership and deletion', async () => {
    mockState.club = club({});
    await render(wrap(<Manage />));
    await settle();
    expect(screen.getByText('Who can see and join')).toBeTruthy();
    expect(screen.getByText('Ownership')).toBeTruthy();
    expect(screen.getAllByText('Delete community').length).toBeGreaterThan(0);
    expect(screen.getByText(/Join requests/)).toBeTruthy();
  });

  it('keeps groups simple: no requests, visibility, rules or announcements', async () => {
    mockState.club = club({ kind: 'group', visibility: 'private', join_policy: 'invite_only' });
    await render(wrap(<Manage />));
    await settle();
    expect(screen.queryByText(/Join requests/)).toBeNull();
    expect(screen.queryByText('Who can see and join')).toBeNull();
    expect(screen.queryByText('Announcements and moderation')).toBeNull();
    expect(screen.queryByText('Rules')).toBeNull();
    expect(screen.getAllByText('Delete group').length).toBeGreaterThan(0);
  });

  it('shows admins no ownership or deletion controls', async () => {
    mockState.club = club({ my_role: 'organizer' });
    await render(wrap(<Manage />));
    await settle();
    expect(screen.queryByText('Ownership')).toBeNull();
    expect(screen.queryByText(/^Delete /)).toBeNull();
    expect(screen.queryByText('Who can see and join')).toBeNull();
  });

  it('explains deletion and deletes only after the name is typed', async () => {
    mockState.club = club({});
    await render(wrap(<Manage />));
    await settle();
    expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    const button = screen.getByRole('button', { name: /Delete community/ });
    await fireEvent.press(button);
    expect(mockRemove).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Type "Harbour Striders" to confirm'), 'harbour striders');
    await fireEvent.press(screen.getByRole('button', { name: /Delete community/ }));
    expect(mockRemove).toHaveBeenCalledWith('harbour striders', expect.anything());
  });

  it('lets admins choose a colour and a plain cover, and saves both at once', async () => {
    mockBranding.mockClear();
    mockState.club = club({ my_role: 'organizer', artwork: 'tide' });
    await render(wrap(<Manage />));
    await settle();
    await fireEvent.press(screen.getByRole('radio', { name: 'Green' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Plain' }));
    await fireEvent.press(screen.getByRole('button', { name: /Save the new look/ }));
    await settle();
    expect(mockBranding).toHaveBeenCalledWith(expect.objectContaining({ tone: 'green', clearArtwork: true, artwork: null, clearCover: false }));
  });

  it('turns members away from the manage screen', async () => {
    mockState.club = club({ my_role: 'member' });
    await render(wrap(<Manage />));
    await settle();
    expect(screen.getByText('Admins only')).toBeTruthy();
  });
});
