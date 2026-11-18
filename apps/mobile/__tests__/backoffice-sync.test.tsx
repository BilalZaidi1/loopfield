import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { TERRITORY_RULES, SPEED_RULES } from '@loopfield/core';
import { parseAppConfig, shareRouteMinMeters, APP_CONFIG_REFRESH_MS, PAUSED_TEXT } from '@/lib/appConfig';
import { rulesForVersion } from '@/lib/gameRules';
import { versionBelow } from '@/lib/version';
import { explainReason } from '@/features/results/reasons';
import { SystemGate, UPDATE_PROMPT_KEY } from '@/features/system/SystemGate';
import { contactSupport, SuspendedNotice, supportHref } from '@/components/Notices';
import { useSupportUnread } from '@/features/support/api';
import { Txt } from '@/components/ui';
import PostDetail from '../app/(app)/post/[id]';
import Help from '../app/(app)/help';

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), rpc: jest.fn(async (fn: string) => mockRpc(fn)) }));
jest.mock('@/lib/appConfig', () => {
  const actual = jest.requireActual('@/lib/appConfig');
  const current = () => ({ settings: actual.parseAppConfig(mockConfig.raw), loaded: true, error: null });
  return { ...actual, useAppConfig: current, useAppConfigSync: () => ({ ...current(), refetch: mockRefetch }), useFeature: (k: string) => actual.parseAppConfig(mockConfig.raw).enabled[k] };
});
jest.mock('@/state/session', () => ({ useSession: () => mockSession, useUnits: () => 'metric' }));
jest.mock('@/recording/db', () => ({ activeSession: () => mockRun.active }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', applicationId: 'dev.loopfield.app.preview' }));
jest.mock('expo-updates', () => ({ updateId: null, isEmbeddedLaunch: true }));
jest.mock('@/features/social/PostCard', () => ({ PostCard: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'p1' }),
  useFocusEffect: (cb: () => void) => jest.requireActual<typeof import('react')>('react').useEffect(cb, [cb])
}));

const mockConfig: { raw: Record<string, unknown> } = { raw: {} };
const mockRefetch = jest.fn();
const mockRun: { active: unknown } = { active: null };
const mockSession: { userId: string | null; profile: { status: string } | null; staff: { permissions: string[] }; settings: null } = { userId: 'me', profile: { status: 'active' }, staff: { permissions: [] }, settings: null };
const mockRpcResults: Record<string, unknown> = {};
function mockRpc(fn: string) {
  return fn in mockRpcResults ? mockRpcResults[fn] : null;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
const router = () => (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router;

beforeEach(() => {
  mockConfig.raw = {};
  mockRun.active = null;
  mockSession.profile = { status: 'active' };
  mockSession.staff = { permissions: [] };
  for (const k of Object.keys(mockRpcResults)) delete mockRpcResults[k];
  router().push.mockClear();
  void AsyncStorage.clear();
});

describe('settings from the back office', () => {
  it('falls back to the built-in values and never switches a feature off by accident', () => {
    const s = parseAppConfig(null);
    expect(Object.values(s.enabled).every(Boolean)).toBe(true);
    expect(s.maintenance.enabled).toBe(false);
    expect([s.postMaxChars, s.commentMaxChars, s.postMaxPhotos]).toEqual([2000, 1000, 5]);
    expect(parseAppConfig({ comments_enabled: 'nonsense', post_max_chars: -4 }).enabled.comments_enabled).toBe(true);
    expect(APP_CONFIG_REFRESH_MS).toBe(300_000);
  });

  it('reads switches, limits, versions and maintenance as the back office saves them', () => {
    const s = parseAppConfig({
      comments_enabled: false, avatar_uploads_enabled: false, club_creation_enabled: 'false', post_max_chars: 280, comment_max_chars: 140, post_max_photos: 2,
      latest_app_version: { ios: '0.2.0', android: '0.1.5' }, min_supported_app_version: '0.1.0',
      maintenance_mode: { enabled: true, message: 'Moving to a new database', until: '2026-11-18T12:00:00Z' }
    });
    expect([s.enabled.comments_enabled, s.enabled.avatar_uploads_enabled, s.enabled.club_creation_enabled, s.enabled.route_proposals_enabled]).toEqual([false, false, false, true]);
    expect([s.postMaxChars, s.commentMaxChars, s.postMaxPhotos]).toEqual([280, 140, 2]);
    expect(s.latestVersion).toEqual({ ios: '0.2.0', android: '0.1.5' });
    expect(s.maintenance).toEqual({ enabled: true, message: 'Moving to a new database', until: '2026-11-18T12:00:00Z' });
    expect(parseAppConfig({ latest_app_version: { android: 'soon' } }).latestVersion.android).toBeNull();
  });

  it('shares routes only from the larger of the minimum and three times the hidden ends', () => {
    expect(shareRouteMinMeters(parseAppConfig({}))).toBe(600);
    expect(shareRouteMinMeters(parseAppConfig({ share_map_min_distance_m: 600, share_route_trim_m: 300 }))).toBe(900);
    expect(shareRouteMinMeters(parseAppConfig({ share_map_min_distance_m: 1500, share_route_trim_m: 200 }))).toBe(1500);
  });

  it('compares versions part by part', () => {
    expect(versionBelow('0.1.0', '0.1.1')).toBe(true);
    expect(versionBelow('0.10.0', '0.9.9')).toBe(false);
    expect(versionBelow('1.0', '1.0.0')).toBe(false);
  });
});

describe('maintenance and updates', () => {
  const app = <Txt>The app</Txt>;

  it('covers the app with the back office message and when it is back', async () => {
    mockConfig.raw = { maintenance_mode: { enabled: true, message: 'Moving to a new database. Runs stay safe.', until: new Date(Date.now() + 3_600_000).toISOString() } };
    await render(<SystemGate promptReady>{app}</SystemGate>);
    expect(screen.getByText('Down for maintenance')).toBeTruthy();
    expect(screen.getByText('Moving to a new database. Runs stay safe.')).toBeTruthy();
    expect(screen.getByText(/^Back by /)).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
    expect(screen.queryByText('Continue as staff')).toBeNull();
    await fireEvent.press(screen.getByText('Check again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('never interrupts a run that is recording', async () => {
    mockConfig.raw = { maintenance_mode: { enabled: true, message: 'Back soon, sorry.', until: null } };
    mockRun.active = { id: 'run', state: 'recording' };
    await render(<SystemGate promptReady>{app}</SystemGate>);
    expect(screen.getByText('The app')).toBeTruthy();
    expect(screen.queryByText('Down for maintenance')).toBeNull();
  });

  it('lets staff with any permission continue past it', async () => {
    mockConfig.raw = { maintenance_mode: { enabled: true, message: 'Back soon, sorry.', until: null } };
    mockSession.staff = { permissions: ['moderation'] };
    await render(<SystemGate promptReady>{app}</SystemGate>);
    await fireEvent.press(screen.getByText('Continue as staff'));
    expect(screen.getByText('The app')).toBeTruthy();
  });

  it('blocks builds below the minimum version until they are updated', async () => {
    mockConfig.raw = { min_supported_app_version: '0.2.0' };
    await render(<SystemGate promptReady>{app}</SystemGate>);
    expect(screen.getByText('Update Loopfield')).toBeTruthy();
    expect(screen.getByText(/This version \(0\.1\.0\) is no longer supported/)).toBeTruthy();
  });

  it('offers a newer version once, then remembers it was seen', async () => {
    mockConfig.raw = { latest_app_version: { ios: '0.1.1', android: '0.1.1' } };
    await render(<SystemGate promptReady>{app}</SystemGate>);
    await settle();
    expect(screen.getByText('Update available')).toBeTruthy();
    expect(screen.getByText(/Version 0\.1\.1 of Loopfield is out \(you have 0\.1\.0\)/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Not now'));
    expect(await AsyncStorage.getItem(UPDATE_PROMPT_KEY)).toBe('0.1.1');
    await render(<SystemGate promptReady>{app}</SystemGate>);
    await settle();
    expect(screen.queryByText('Update available')).toBeNull();
    expect(screen.getByText('The app')).toBeTruthy();
  });
});

describe('kill switches and limits in the comment box', () => {
  const post = { id: 'p1', comments_enabled: true, comment_count: 0, status: 'published', is_mine: false, audience: 'public' };

  it('shows that comments are paused instead of a box that would fail', async () => {
    mockConfig.raw = { comments_enabled: false };
    mockRpcResults.post_detail = post;
    mockRpcResults.post_comments = [];
    await render(wrap(<PostDetail />));
    await settle();
    expect(screen.getByText('Comments are paused for now. You can still read them.')).toBeTruthy();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
  });

  it('limits comments to the length set in the back office', async () => {
    mockConfig.raw = { comment_max_chars: 140 };
    mockRpcResults.post_detail = post;
    mockRpcResults.post_comments = [];
    await render(wrap(<PostDetail />));
    await settle();
    expect(screen.getByLabelText('Add a comment').props.maxLength).toBe(140);
  });

  it('explains the suspended state where commenting is blocked', async () => {
    mockSession.profile = { status: 'suspended' };
    mockRpcResults.post_detail = post;
    mockRpcResults.post_comments = [];
    await render(wrap(<PostDetail />));
    await settle();
    expect(screen.getByText('Commenting is paused while your account is suspended.')).toBeTruthy();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
  });

  it('has a paused note for every switch', () => {
    for (const text of Object.values(PAUSED_TEXT)) expect(text).toMatch(/paused for now|held back/);
  });
});

describe('rules from the running season', () => {
  // A rule version saved in the back office (versions are free text there; the built-in type is a literal).
  const season = { ...TERRITORY_RULES, version: 'territory-2026.11.18-ops', minLoopLengthMeters: { ...TERRITORY_RULES.minLoopLengthMeters, value: 400 } } as unknown as typeof TERRITORY_RULES;
  const km = (m: number) => (m < 1000 ? `${m} m` : `${m / 1000} km`);

  it('explains a loop that did not count with the numbers it was judged by', () => {
    expect(explainReason('too_short', { territory: rulesForVersion('territory-2026.11.18-ops', season, TERRITORY_RULES) }, km)).toBe('The loop is shorter than the 400 m minimum.');
    expect(explainReason('too_short', { territory: rulesForVersion(TERRITORY_RULES.version, season, TERRITORY_RULES) }, km)).toBe('The loop is shorter than the 1 km minimum.');
    // A result judged under some other version keeps the general wording rather than guess numbers.
    expect(explainReason('too_short', { territory: rulesForVersion('territory-older', season, TERRITORY_RULES) }, km)).toBe('The loop is shorter than the supported minimum length.');
    expect(explainReason('low_coverage', { speed: SPEED_RULES }, km)).toBe('Less than 95% of the route was covered within 20 m of the course.');
  });

  it('shows the season minimum loop in Help', async () => {
    mockRpcResults.game_rules = { territory_version: 'territory-2026.11.18-ops', territory: { minLoopLengthMeters: 400 }, speed_version: 'speed-2026.11.0-proposed', speed: {} };
    await render(wrap(<Help />));
    await settle();
    expect(screen.getByText(/Loops must be 400 m/)).toBeTruthy();
    expect(screen.getByText(/territory-2026\.11\.18-ops/)).toBeTruthy();
  });
});

describe('support', () => {
  function Probe() {
    const n = useSupportUnread();
    return <Txt>{`unread ${n}`}</Txt>;
  }

  it('counts unread replies', async () => {
    mockRpcResults.support_unread_count = 2;
    await render(wrap(<Probe />));
    await settle();
    expect(screen.getByText('unread 2')).toBeTruthy();
  });

  it('prefills a support message with its category, subject and context', () => {
    expect(supportHref('competition', 'My loop was not counted', 'run:abc')).toEqual({ pathname: '/support/new', params: { category: 'competition', subject: 'My loop was not counted', context: 'run:abc' } });
    contactSupport('account', 'My account is suspended', 'account:suspended');
    expect(router().push).toHaveBeenCalledWith({ pathname: '/support/new', params: { category: 'account', subject: 'My account is suspended', context: 'account:suspended' } });
  });

  it('gives a suspended account its ways out: support and appeals', async () => {
    await render(<SuspendedNotice what="account" />);
    expect(screen.getByText('Your account is suspended')).toBeTruthy();
    await fireEvent.press(screen.getByText('Message support'));
    expect(router().push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/support/new', params: expect.objectContaining({ category: 'account' }) }));
    await fireEvent.press(screen.getByLabelText('Your reviews and appeals'));
    expect(router().push).toHaveBeenCalledWith('/appeals');
  });
});
