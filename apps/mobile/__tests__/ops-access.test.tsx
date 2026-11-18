import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { allowed, qrSvg, StaffGate } from '@/features/ops/StaffGate';
import { switchRows, toolsFor, type ConfigRow } from '@/features/ops/tools';
import { parseWhoAmI } from '@/state/staff';
import { Txt } from '@/components/ui';

// jest.mock factories are hoisted above imports, so they load their stand-ins with require.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('@/state/session', () => ({ useSession: () => mockSession }));
jest.mock('@/lib/supabase', () => ({ supabase: () => ({ auth: { mfa: mockMfa } }) }));

const mockSession: { userId: string; staff: { permissions: string[] } } = { userId: 'me', staff: { permissions: [] } };
const mockLevel: { current: 'aal1' | 'aal2' } = { current: 'aal1' };
const mockMfa = {
  getAuthenticatorAssuranceLevel: jest.fn(async () => ({ data: { currentLevel: mockLevel.current }, error: null })),
  listFactors: jest.fn(async () => ({ data: { totp: [] as { id: string; created_at: string }[], all: [] as { id: string; factor_type: string; status: string }[] }, error: null })),
  enroll: jest.fn(async () => ({ data: { id: 'f-new', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: 'ABCDEFGHIJKLMNOP', uri: 'otpauth://totp/Loopfield:me?secret=ABCDEFGHIJKLMNOP' } }, error: null })),
  unenroll: jest.fn(async () => ({ data: {}, error: null })),
  challengeAndVerify: jest.fn(async ({ code }: { factorId: string; code: string }) => {
    if (code !== '123456') return { data: null, error: { message: 'Invalid TOTP code entered' } };
    mockLevel.current = 'aal2';
    return { data: {}, error: null };
  })
};

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

beforeEach(() => {
  mockLevel.current = 'aal1';
  mockSession.staff = { permissions: [] };
  jest.clearAllMocks();
});

describe('operator permissions', () => {
  it('reads permissions from ops_whoami, never role names', () => {
    expect(parseWhoAmI({ roles: ['night_moderator'], role_labels: ['Night moderator'], permissions: ['moderation'], require_mfa: true })).toEqual({ permissions: ['moderation'], roles: ['night_moderator'], roleLabels: ['Night moderator'], requireMfa: true });
    expect(parseWhoAmI(null).permissions).toEqual([]);
  });

  it('shows a custom role with only moderation just the moderation tool', () => {
    expect(toolsFor(['moderation']).map((t) => t.key)).toEqual(['moderation']);
    expect(toolsFor(['territory']).map((t) => t.key)).toEqual(['system', 'seasons']);
    expect(toolsFor(['jobs']).map((t) => t.key)).toEqual(['system']);
    expect(toolsFor([])).toEqual([]);
    expect(allowed(['support'], 'any')).toBe(true);
    expect(allowed(['support'], ['moderation', 'integrity'])).toBe(false);
  });

  it('lists every switch the back office registers, in its order', () => {
    const row = (key: string, category: string, sort: number) => ({ key, category, sort, label: key, value: true, value_type: 'boolean', allowed: null, help: null, can_edit: true, last_changed_by: null, last_reason: null, last_changed_at: null }) as ConfigRow;
    expect(switchRows([row('paywall_enabled', 'monetization', 1), row('comments_enabled', 'switch', 17), row('territory_capture_enabled', 'switch', 10)]).map((r) => r.key)).toEqual(['territory_capture_enabled', 'comments_enabled']);
  });

  it('puts every operator screen behind the staff gate', () => {
    const dir = join(__dirname, '../app/(app)/ops');
    const files = (function walk(d: string): string[] {
      return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.tsx') ? [join(d, f)] : []));
    })(dir);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect([f, readFileSync(f, 'utf8').includes('<StaffGate')]).toEqual([f, true]);
  });
});

describe('authenticator code before operator screens', () => {
  const tool = <Txt>Moderation queue</Txt>;

  it('keeps staff without the permission out', async () => {
    mockSession.staff = { permissions: ['routes'] };
    await render(wrap(<StaffGate need="moderation" title="Moderation">{tool}</StaffGate>));
    await settle();
    expect(screen.getByText('Not part of your role')).toBeTruthy();
    expect(screen.queryByText('Moderation queue')).toBeNull();
  });

  it('asks for the code in an aal1 session and opens the tool once it is right', async () => {
    mockSession.staff = { permissions: ['moderation'] };
    mockMfa.listFactors.mockResolvedValueOnce({ data: { totp: [{ id: 'f1', created_at: '2026-11-12T09:00:00Z' }], all: [] }, error: null });
    await render(wrap(<StaffGate need="moderation" title="Moderation">{tool}</StaffGate>));
    await settle();
    expect(screen.getByText('Enter your authenticator code')).toBeTruthy();
    expect(screen.queryByText('Moderation queue')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '999999');
    await fireEvent.press(screen.getByText('Verify'));
    await settle();
    expect(screen.getByText('That code did not work. Enter the newest code your authenticator app shows.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '12 34 56');
    await fireEvent.press(screen.getByText('Verify'));
    await settle();
    expect(mockMfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f1', code: '123456' });
    expect(screen.getByText('Moderation queue')).toBeTruthy();
  });

  it('enrols an authenticator first when the account has none', async () => {
    mockSession.staff = { permissions: ['moderation'] };
    mockMfa.listFactors
      .mockResolvedValueOnce({ data: { totp: [], all: [] }, error: null })
      .mockResolvedValueOnce({ data: { totp: [], all: [{ id: 'stale', factor_type: 'totp', status: 'unverified' }] }, error: null });
    await render(wrap(<StaffGate need="any" title="Operator tools">{tool}</StaffGate>));
    await settle();
    await fireEvent.press(screen.getByText('Set up authenticator'));
    await settle();
    expect(mockMfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
    expect(mockMfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Loopfield app', issuer: 'Loopfield' });
    expect(screen.getByLabelText('QR code for your authenticator app')).toBeTruthy();
    await fireEvent.press(screen.getByText('Type a key instead'));
    expect(screen.getByText('ABCD EFGH IJKL MNOP')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    await fireEvent.press(screen.getByText('Verify'));
    await settle();
    expect(mockMfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f-new', code: '123456' });
    expect(screen.getByText('Moderation queue')).toBeTruthy();
  });

  it('opens straight away in a session that already has the code', async () => {
    mockSession.staff = { permissions: ['moderation'] };
    mockLevel.current = 'aal2';
    await render(wrap(<StaffGate need="moderation" title="Moderation">{tool}</StaffGate>));
    await settle();
    expect(screen.getByText('Moderation queue')).toBeTruthy();
    expect(mockMfa.listFactors).not.toHaveBeenCalled();
  });

  it('accepts the QR code as markup or as a data URL', () => {
    expect(qrSvg('<svg/>')).toBe('<svg/>');
    expect(qrSvg('data:image/svg+xml;utf-8,<svg/>')).toBe('<svg/>');
    expect(qrSvg('data:image/svg+xml;utf-8,%3Csvg%2F%3E')).toBe('<svg/>');
  });
});
