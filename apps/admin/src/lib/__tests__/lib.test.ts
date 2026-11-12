import { describe, expect, it } from 'vitest';
import { validateConfigValue, formatValue } from '../config-validate';
import { age, relativeTime, humanize } from '../format';
import { safeNext } from '../next-path';
import { friendlyError } from '../errors';
import { hasRole } from '../roles';

const meta = (over: Partial<Parameters<typeof validateConfigValue>[0]>) => ({
  key: 'k', label: 'Setting', value_type: 'integer' as const, min_value: null, max_value: null, allowed: null, ...over
});

describe('validateConfigValue mirrors the database rules', () => {
  it('checks integer bounds and wholeness', () => {
    const m = meta({ min_value: 1, max_value: 10 });
    expect(validateConfigValue(m, 5)).toBeNull();
    expect(validateConfigValue(m, 0)).toMatch(/between 1 and 10/);
    expect(validateConfigValue(m, 2.5)).toMatch(/whole number/);
    expect(validateConfigValue(m, '5')).toMatch(/number/);
  });
  it('requires booleans for switches', () => {
    expect(validateConfigValue(meta({ value_type: 'boolean' }), true)).toBeNull();
    expect(validateConfigValue(meta({ value_type: 'boolean' }), 'yes')).toMatch(/on or off/);
  });
  it('checks semantic versions', () => {
    const m = meta({ value_type: 'version' });
    expect(validateConfigValue(m, '1.2.3')).toBeNull();
    expect(validateConfigValue(m, '1.2')).toMatch(/1\.2\.3/);
  });
  it('never lets a core feature become premium', () => {
    const m = meta({ key: 'premium_features', value_type: 'string_array' });
    expect(validateConfigValue(m, ['route_insights'])).toBeNull();
    expect(validateConfigValue(m, ['territory'])).toMatch(/core feature/);
    expect(validateConfigValue(m, ['Bad Key'])).toMatch(/lowercase/);
  });
  it('needs a message while maintenance is on', () => {
    const m = meta({ key: 'maintenance_mode', value_type: 'object', allowed: ['enabled', 'message', 'until'] });
    expect(validateConfigValue(m, { enabled: true, message: null, until: null })).toMatch(/message/);
    expect(validateConfigValue(m, { enabled: true, message: 'Back at 3pm', until: null })).toBeNull();
    expect(validateConfigValue(m, { enabled: false, message: null, until: null, extra: 1 })).toMatch(/unknown field/);
  });
  it('needs all four achievement tiers', () => {
    const m = meta({ key: 'achievement_tier_points', value_type: 'object', allowed: ['bronze', 'silver', 'gold', 'platinum'] });
    expect(validateConfigValue(m, { bronze: 10, silver: 25, gold: 60, platinum: 150 })).toBeNull();
    expect(validateConfigValue(m, { bronze: 10 })).toMatch(/bronze, silver, gold and platinum/);
    expect(validateConfigValue(m, { bronze: 10, silver: 25, gold: 60, platinum: 5000 })).toMatch(/0 and 1000/);
  });
});

describe('formatting', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  it('formats relative times and ages', () => {
    expect(relativeTime('2026-11-12T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-12T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-11-12T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-16T12:00:00Z', now)).toBe('in 4 d');
    expect(age('2026-11-12T11:30:00Z', now)).toBe('30 min');
    expect(age('2026-11-12T11:00:00Z', now)).toBe('1 h');
    expect(age(null, now)).toBeNull();
  });
  it('formats values and keys', () => {
    expect(formatValue(true)).toBe('On');
    expect(formatValue([])).toBe('None');
    expect(formatValue(1200)).toBe('1,200');
    expect(humanize('territory_capture_enabled')).toBe('Territory capture enabled');
  });
});

describe('safety helpers', () => {
  it('only allows same-origin relative redirects', () => {
    expect(safeNext('/moderation?status=open')).toBe('/moderation?status=open');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('/mfa')).toBeNull();
  });
  it('explains database errors in plain words', () => {
    expect(friendlyError({ code: '42501', message: 'requires admin role' })).toMatch(/role does not allow/);
    expect(friendlyError({ code: '42501', message: 'requires multi-factor authentication' })).toMatch(/authenticator/);
    expect(friendlyError({ code: '22023', message: 'write a reason of at least 5 characters' })).toBe('Write a reason of at least 5 characters');
    expect(friendlyError({ message: 'relation "x" does not exist' })).toMatch(/Something went wrong/);
  });
  it('treats admin as every role, like authz.has_role', () => {
    expect(hasRole(['admin'], 'moderator')).toBe(true);
    expect(hasRole(['support'], 'moderator')).toBe(false);
  });
});
