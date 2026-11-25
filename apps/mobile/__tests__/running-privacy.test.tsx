/**
 * What leaves the phone while the running features are used. Analytics and error reports must never carry a
 * position (or, for the health features, a health value); positions go only to the server calls whose job is
 * to carry them: a live-link push, a planned route and path following.
 */
import { destination, type LatLng } from '@loopfield/core';
import { savePlannedRoute, snapLeg } from '@/features/plan/api';
import { createLiveLink, endLiveLink } from '@/features/live/api';
import { attachFollow, checkFollow, _resetFollowForTests } from '@/recording/follow';
import { attachLiveShare, pushLive, stopLiveShare, _resetLivePushForTests } from '@/recording/livePush';
import { captureAnalytics, captureConsole, payloads, problems, resetPayloads, type Payload } from './helpers/payloadCapture';
import { fix, resetDb, samples } from './helpers/recordingDbStub';

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('@/recording/db', () => require('./helpers/recordingDbStub').dbModule);
jest.mock('@/lib/analytics', () => ({ track: (e: string, p: Record<string, unknown>) => require('./helpers/payloadCapture').captureAnalytics(e, p) }));
jest.mock('@/lib/api', () => {
  const capture = require('./helpers/payloadCapture');
  return {
    ...jest.requireActual('@/lib/api'),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      capture.captureRequest(`rpc:${fn}`, args);
      return mockResults[fn] ?? null;
    }),
    callFunction: jest.fn(async (path: string, body: Record<string, unknown>) => {
      capture.captureRequest(path, body);
      return { snapped: false, reason: 'unavailable' };
    })
  };
});
jest.mock('@/lib/supabase', () => {
  const capture = require('./helpers/payloadCapture');
  const row = { id: 'r1', name: 'River loop', path: 'abc', distance_m: 1200, point_count: 3, is_loop: false, snapped: false, created_at: 'now', updated_at: 'now' };
  const chain = (table: string) => {
    const q = {
      insert: (body: unknown) => (capture.captureRequest(`${table}.insert`, body), q),
      update: (body: unknown) => (capture.captureRequest(`${table}.update`, body), q),
      delete: () => q,
      eq: () => q,
      select: () => q,
      order: () => Promise.resolve({ data: [row], error: null }),
      single: () => Promise.resolve({ data: row, error: null })
    };
    return q;
  };
  return { supabase: () => ({ from: chain }) };
});
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('@/lib/cues', () => ({ emitCue: jest.fn() }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })), scheduleNotificationAsync: jest.fn() }));

const mockResults: Record<string, unknown> = {};
const start: LatLng = { lat: 24.8607, lng: 67.0011 };
const along = (m: number, north = 0) => destination(destination(start, m, 90), north, 0);
const route = Array.from({ length: 11 }, (_, i) => along(i * 100));
const T0 = 1_800_000_000_000;
/** The calls whose job is to carry a position. */
const carriesPositions = (p: Payload) => ['rpc:live_link_push', 'planned_routes.insert', 'planned_routes.update', 'route-snap'].includes(p.name);

let restoreConsole: () => void = () => {};
beforeEach(() => {
  resetPayloads();
  resetDb();
  _resetFollowForTests();
  _resetLivePushForTests();
  for (const k of Object.keys(mockResults)) delete mockResults[k];
  restoreConsole = captureConsole();
});
afterEach(() => restoreConsole());

describe('payloads from the running features', () => {
  it('sends positions only where a route or a live link needs them (stage 1)', async () => {
    // Planning: saving a route and following paths send the line to our server, nowhere else.
    await savePlannedRoute({ name: 'River loop', path: route, snapped: false });
    await snapLeg(route[0]!, route[3]!);

    // A live link: created, shared positions, ended.
    mockResults.live_link_create = { token: 'tok_privacy_abcdefghijk', kind: 'run', created: true };
    mockResults.live_link_push = { ok: true, every_seconds: 30 };
    const link = await createLiveLink('run', false);
    attachLiveShare('s1', link.token, 'run', 30);
    samples.s1 = Array.from({ length: 20 }, (_, k) => fix(along(k * 25), T0 + k * 3000));
    await pushLive('s1', { force: true }, 200_000);

    // Following, with an off-route alert, and a failure whose message holds coordinates.
    attachFollow('s1', { kind: 'planned', refId: 'r1', name: 'River loop', path: route }, { offRouteM: 40, offRouteSeconds: 15 });
    samples.s1.push(...Array.from({ length: 12 }, (_, k) => fix(along(500, 90), T0 + 61_000 + k * 2000)));
    await checkFollow('s1', 10_000);
    Object.defineProperty(samples, 's1', { configurable: true, get: () => { throw new Error('bad fix at 24.86071, 67.00112'); } });
    await checkFollow('s1', 20_000);
    delete samples.s1;

    await stopLiveShare('s1');
    await endLiveLink(link.token, 'run');

    expect(problems({ allowNetwork: carriesPositions })).toEqual([]);
    // The check itself sees positions: without the allowance, the push, the route and path following are flagged.
    const flagged = new Set(problems().map((x) => x.split(':')[0]));
    expect([...flagged].sort()).toEqual(['network planned_routes.insert', 'network route-snap', 'network rpc'].sort());
    expect(payloads.filter((p) => p.channel === 'analytics').map((p) => p.name)).toEqual(expect.arrayContaining(['route_planned', 'live_link']));
    expect(payloads.some((p) => p.channel === 'error' && /route check failed/.test(String(p.body)))).toBe(true);
  });

  it('drops anything outside the event schema before it is sent', () => {
    captureAnalytics('route_planned', { action: 'created', distance_bucket: '5-10km', loop: true, snapped: true, lat: 24.8607123, path: 'abc' } as never);
    expect(problems()).toEqual([]);
  });
});
