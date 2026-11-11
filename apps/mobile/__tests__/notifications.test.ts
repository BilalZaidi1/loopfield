import { filterOf, presentNotification, type NotificationLike } from '@/notifications/present';
import { routeForNotification } from '@/notifications/push';

jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), AndroidImportance: { DEFAULT: 3 } }));
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));

const n = (kind: string, extra: Partial<NotificationLike> = {}): NotificationLike => ({ category: 'competitive', kind, object_type: null, data: {}, actor: null, ...extra });

describe('notification centre', () => {
  it('files every kind under one tab', () => {
    expect(filterOf(n('territory_lost'))).toBe('land');
    expect(filterOf(n('territory_digest'))).toBe('land');
    expect(filterOf(n('event_starting'))).toBe('events');
    expect(filterOf(n('season_finished'))).toBe('events');
    expect(filterOf(n('club_challenge', { category: 'club' }))).toBe('events');
    expect(filterOf(n('badge_earned'))).toBe('milestones');
    expect(filterOf(n('friend_run', { category: 'social' }))).toBe('social');
    expect(filterOf(n('message', { category: 'message' }))).toBe('social');
    expect(filterOf(n('club_member_joined', { category: 'club' }))).toBe('clubs');
    expect(filterOf(n('appeal_decided', { category: 'system' }))).toBe('account');
  });

  it('says what a run captured, all-time map first, with the area and what came from others', () => {
    const shown = presentNotification(n('territory_captured', {
      data: { district: 'Dev North', layers: [{ kind: 'club', name: 'Harbour Striders race', cells: 9 }, { kind: 'permanent', name: 'All-time map', cells: 20, taken: 10 }] }
    }), 'metric');
    expect(shown.title).toBe('Your land is on the map');
    expect(shown.body).toBe('Your run captured 20 cells on the all-time map (and 9 in Harbour Striders race) near Dev North, 10 of them from other runners.');
  });

  it('describes losses and contested land without naming anyone', () => {
    const lost = presentNotification(n('territory_lost', { data: { district: 'Dev North', layers: [{ kind: 'permanent', cells: 5 }] } }), 'metric');
    expect(lost.body).toBe('Another runner took 5 of your cells on the all-time map near Dev North.');
    const contested = presentNotification(n('territory_contested', { data: { district: 'Dev North', runners: 3 } }), 'metric');
    expect(contested.title).toBe('Your land near Dev North is contested');
    expect(contested.body).toMatch(/^3 runners have taken cells from you this week/);
  });

  it('names the community, the season result and the friend', () => {
    expect(presentNotification(n('club_member_joined', { category: 'club', actor: { display_name: 'Sana' }, data: { club_name: 'Harbour Striders', kind: 'community' } }), 'metric').title)
      .toBe('Sana joined Harbour Striders');
    expect(presentNotification(n('season_finished', { data: { name: 'Karachi race', season: 3, rank: 2, runners: 41, area_m2: 25_000 } }), 'metric').body)
      .toBe('You finished 2nd of 41 with 2.50 ha. A new season has started.');
    expect(presentNotification(n('friend_run', { category: 'social', actor: { display_name: 'Ali' } }), 'metric').title).toBe('Ali shared a run');
  });

  it('opens the right place', () => {
    expect(routeForNotification({ kind: 'territory_lost', object_type: 'cell', object_id: '300402', data: {} })).toEqual({ pathname: '/territory/[cell]', params: { cell: '300402' } });
    expect(routeForNotification({ kind: 'territory_captured', object_type: 'activity', object_id: 'a1', data: {} })).toEqual({ pathname: '/activities/[id]', params: { id: 'a1' } });
    expect(routeForNotification({ kind: 'season_finished', object_type: 'competition', object_id: 'c1', data: {} })).toBe('/seasons');
    expect(routeForNotification({ kind: 'club_member_joined', object_type: 'club', object_id: 'k1', data: {} })).toEqual({ pathname: '/club/[id]/members', params: { id: 'k1' } });
    expect(routeForNotification({ kind: 'club_announcement', object_type: 'post', object_id: 'p1', data: {} })).toEqual({ pathname: '/post/[id]', params: { id: 'p1' } });
    expect(routeForNotification({ kind: 'club_deleted', object_type: 'club', object_id: 'k1', data: {} })).toBe('/clubs');
  });
});
