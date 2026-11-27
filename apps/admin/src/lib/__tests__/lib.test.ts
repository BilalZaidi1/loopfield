import { describe, expect, it } from 'vitest';
import { validateConfigValue, formatValue } from '../config-validate';
import { age, relativeTime, humanize } from '../format';
import { safeNext } from '../next-path';
import { friendlyError } from '../errors';
import { hasPermission, roleLabel } from '../roles';

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
    expect(hasPermission(['moderation', 'users.view'], 'moderation')).toBe(true);
    expect(hasPermission(['support'], 'moderation')).toBe(false);
    expect(roleLabel('analyst')).toBe('Analyst');
    expect(roleLabel('night_shift')).toBe('Night shift');
  });
});

import { bandSpans, chosenWidgets, DEFAULT_WIDGETS } from '../widgets';
import { niceTicks, placeLabels, tickFormat } from '../../components/charts';

describe('bandSpans', () => {
  it('fills complete rows and shares the last row evenly', () => {
    expect(bandSpans(4, 4, 2)).toEqual(Array(4).fill('col-span-12 md:col-span-6 xl:col-span-3'));
    expect(bandSpans(5, 4, 2, 2).at(-1)).toBe('col-span-12 md:col-span-12 xl:col-span-12');
    expect(bandSpans(3, 3, 2)).toEqual(['col-span-12 md:col-span-6 xl:col-span-4', 'col-span-12 md:col-span-6 xl:col-span-4', 'col-span-12 md:col-span-12 xl:col-span-4']);
    expect(bandSpans(2, 4, 2, 2)).toEqual(Array(2).fill('col-span-6 md:col-span-6 xl:col-span-6'));
  });
});

describe('chosenWidgets', () => {
  it('drops widgets the person may not see and unknown ids', () => {
    expect(chosenWidgets(['kpi_runs', 'queues', 'nope'], []).map((w) => w.id)).toEqual(['queues']);
    expect(chosenWidgets(undefined, ['analytics', 'support']).map((w) => w.id)).toEqual(DEFAULT_WIDGETS);
  });
});

describe('niceTicks', () => {
  it('rounds the axis to clean steps', () => {
    expect(niceTicks(416)).toEqual([0, 200, 400, 600]);
    expect(niceTicks(9.5)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('steps counts by whole numbers', () => {
    expect(niceTicks(1, 4, true)).toEqual([0, 1]);
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7, 4, true)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(10, 4, true)).toEqual([0, 5, 10]);
    expect(niceTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('labels each tick with its true value', () => {
    expect(niceTicks(1).map(tickFormat(niceTicks(1)))).toEqual(['0', '0.25', '0.5', '0.75', '1']);
    expect(niceTicks(9.5).map(tickFormat(niceTicks(9.5)))).toEqual(['0', '2.5', '5', '7.5', '10']);
    expect(niceTicks(52_000).map(tickFormat(niceTicks(52_000)))).toEqual(['0', '20K', '40K', '60K']);
  });
});

describe('placeLabels', () => {
  it('keeps the latest day inside the chart and drops labels that would touch it', () => {
    const placed = placeLabels([
      { i: 0, x: 60, text: '20 Oct' }, { i: 15, x: 200, text: '5 Nov' }, { i: 25, x: 280, text: '13 Nov' }, { i: 29, x: 296, text: '18 Nov' }
    ], 300);
    expect(placed.map((l) => [l.text, l.anchor])).toEqual([['20 Oct', 'middle'], ['5 Nov', 'middle'], ['18 Nov', 'end']]);
    expect(placed.at(-1)!.x).toBeLessThan(300);
  });
});

import { endedMessage, HEALTH_CARD_LABELS, lengthCheck, shapeLabel, sharingLines, snapAlertState, sourceLabel, stretchText, waitedText } from '../running';

describe('running tools', () => {
  it('describes a runner\'s live sharing with counts and yes or no only', () => {
    const on = sharingLines({ live_links: 2, friends_sharing: true, live_links_enabled: true, friends_live_enabled: true });
    expect(on).toEqual({ live: 'Active · 2 open links', friends: 'On', note: null, anything: true });
    const off = sharingLines({ live_links: 0, friends_sharing: false, live_links_enabled: false, friends_live_enabled: true });
    expect(off.live).toBe('None');
    expect(off.anything).toBe(false);
    expect(off.note).toBe('Switched off in App control: Live links. Nothing is shared that way until it is back on.');
    expect(sharingLines(undefined).live).toBe('Not available');
  });

  it('says what support ended', () => {
    expect(endedMessage({ links_ended: 3, friend_sharing_off: false })).toBe('Ended 3 live links. The runner is told in the app.');
    expect(endedMessage({ links_ended: 1, friend_sharing_off: true })).toBe('Ended 1 live link and turned off sharing with friends. The runner is told in the app.');
    expect(endedMessage({ links_ended: 0, friend_sharing_off: true })).toBe('Turned off sharing with friends. The runner is told in the app.');
    expect(endedMessage({ links_ended: 0, friend_sharing_off: false })).toBe('Nothing was open, so nothing changed.');
  });

  it('labels proposals for reviewers', () => {
    expect(sourceLabel({ from_m: 1200, to_m: 2700 })).toBe('Part of a run');
    expect(sourceLabel({ from_m: null, to_m: null })).toBe('Whole run');
    expect(stretchText({ from_m: 1200, to_m: 2700 })).toBe('1.2 to 2.7 km along the run');
    expect(stretchText({ from_m: null, to_m: null })).toBeNull();
    expect(shapeLabel({ shape: 'a_to_b', closed: false })).toBe('Start to finish');
    expect(shapeLabel({ shape: undefined, closed: true })).toBe('Loop');
    expect(waitedText(0.4)).toBe('under an hour');
    expect(waitedText(5.6)).toBe('5 h');
    expect(waitedText(53.2)).toBe('2 days 5 h');
    expect(waitedText(24)).toBe('1 day');
    expect(lengthCheck(1500, 1000, 5000)).toEqual({ ok: true, text: '1.5 km, limits 1.0–5.0 km' });
    expect(lengthCheck(800, 1000, 5000).ok).toBe(false);
  });

  it('warns about path-following requests only once a level is set', () => {
    expect(snapAlertState(5000, 0)).toBe('unset');
    expect(snapAlertState(1000, 10_000)).toBe('ok');
    expect(snapAlertState(8500, 10_000)).toBe('near');
    expect(snapAlertState(10_000, 10_000)).toBe('over');
  });

  it('offers the health cards the app can hide, and refuses others', () => {
    const cards = meta({ key: 'disabled_health_cards', label: 'Suspended health cards', value_type: 'string_array', allowed: Object.keys(HEALTH_CARD_LABELS) });
    expect(validateConfigValue(cards, ['training', 'imported_routes'])).toBeNull();
    expect(validateConfigValue(cards, ['traning'])).toMatch(/not one of the options/);
    expect(validateConfigValue(meta({ key: 'premium_features', value_type: 'string_array' }), ['anything_new'])).toBeNull();
  });

  it('puts the four running tiles on the default Overview', () => {
    expect(DEFAULT_WIDGETS).toEqual(expect.arrayContaining(['kpi_live_links', 'kpi_route_snap', 'kpi_running_now', 'kpi_routes_waiting']));
    expect(chosenWidgets(undefined, []).map((w) => w.id)).toEqual(expect.arrayContaining(['kpi_live_links', 'kpi_routes_waiting']));
  });
});
