jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), AndroidImportance: { DEFAULT: 3 } }));
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));

import { routeForNotification } from '@/notifications/push';

describe('notification routing', () => {
  const n = (kind: string, object_type: string | null, object_id: string | null, data: Record<string, unknown> = {}) => ({ kind, object_type, object_id, data });

  it('routes social objects to their screens', () => {
    expect(routeForNotification(n('comment', 'post', 'p1'))).toEqual({ pathname: '/post/[id]', params: { id: 'p1' } });
    expect(routeForNotification(n('follow_request', 'profile', 'u1'))).toBe('/connections');
    expect(routeForNotification(n('follow_accepted', 'profile', 'u1'))).toEqual({ pathname: '/profile/[id]', params: { id: 'u1' } });
  });

  it('routes messages by channel without exposing content', () => {
    expect(routeForNotification(n('message', 'conversation', 'c1', { channel_id: 'dm_x' }))).toEqual({ pathname: '/inbox/[channel]', params: { channel: 'dm_x' } });
    expect(routeForNotification(n('message', 'conversation', 'c1'))).toBe('/inbox');
  });

  it('routes digests, club requests, exports and decisions', () => {
    expect(routeForNotification(n('territory_digest', 'digest', null))).toBe('/map');
    expect(routeForNotification(n('title_digest', 'digest', null))).toBe('/routes');
    expect(routeForNotification(n('club_join_request', 'club', 'k1'))).toEqual({ pathname: '/club/[id]/organizer', params: { id: 'k1' } });
    expect(routeForNotification(n('export_ready', 'data_export', 'e1'))).toBe('/settings/account');
    expect(routeForNotification(n('appeal_decided', 'integrity_case', 'i1'))).toBe('/appeals');
    expect(routeForNotification(n('route_decided', 'route_proposal', 'r1'))).toBe('/proposals');
    expect(routeForNotification(n('unknown', null, null))).toBe('/notifications');
  });
});
