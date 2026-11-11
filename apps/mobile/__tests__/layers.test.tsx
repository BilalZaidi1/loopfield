import { render, screen } from '@testing-library/react-native';
import { layerOutcome, LandCard, type ClaimJson, type LayerResult } from '@/features/results/ResultCards';
import { phaseText, startOptions, windowFrom } from '@/features/events/api';
import { routeForNotification } from '@/notifications/push';
import { layerSubtitle, layerTitle, resolveCompetitions, type Competition } from '@/state/competition';

jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), AndroidImportance: { DEFAULT: 3 } }));
jest.mock('@/lib/supabase', () => ({ supabase: jest.fn() }));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: null }), useUnits: () => 'metric' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

const comp = (id: string, kind: Competition['kind'], extra: Partial<Competition> = {}): Competition => ({
  id, kind, name: `${kind} ${id}`, region_id: 'r1', club_id: null, event_type: null, starts_at: null, ends_at: null, host_club_id: null, ...extra
});
const now = Date.now();
const race = comp('race', 'public');
const map = comp('map', 'permanent');
const club = comp('club', 'club', { club_id: 'k1' });
const live = comp('live', 'event', { event_type: 'territory', starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString() });
const later = comp('later', 'event', { event_type: 'territory', starts_at: new Date(now + 86_400_000).toISOString(), ends_at: new Date(now + 3 * 86_400_000).toISOString() });
const distance = comp('dist', 'event', { event_type: 'distance', region_id: null, starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString() });
const all = [race, map, club, live, later, distance];

describe('what the map shows and where runs count', () => {
  it('shows the all-time map by default and records for the public race', () => {
    const r = resolveCompetitions(all, null, null);
    expect(r.layer?.id).toBe('map');
    expect(r.competition?.id).toBe('race');
    expect(r.home?.id).toBe('map');
  });

  it('can show the season race or a live event while runs still record for the public race', () => {
    expect(resolveCompetitions(all, 'race', null).layer?.id).toBe('race');
    const ev = resolveCompetitions(all, 'live', null);
    expect(ev.layer?.id).toBe('live');
    expect(ev.competition?.id).toBe('race');
  });

  it('records for a club when its race is chosen, and calls that land "held now"', () => {
    const r = resolveCompetitions(all, 'club', null);
    expect(r.competition?.id).toBe('club');
    expect(r.layer?.id).toBe('club');
    expect(r.home?.id).toBe('club');
  });

  it('never offers upcoming or distance events as map layers, and falls back from them', () => {
    const r = resolveCompetitions(all, 'later', null);
    expect(r.layer?.id).toBe('map');
    expect(r.layers.map((l) => l.id)).toEqual(['map', 'race', 'live', 'club']);
    expect(resolveCompetitions(all, 'dist', null).layer?.id).toBe('map');
  });

  it('names layers in plain words', () => {
    expect(layerTitle(map)).toBe('All-time map');
    expect(layerTitle(race, { id: 's', number: 3, starts_at: '', ends_at: new Date(now + 5 * 86_400_000).toISOString(), status: 'active', timezone: 'UTC' })).toBe('Season 3 race');
    expect(layerSubtitle(map)).toMatch(/stays until someone takes it/);
    expect(layerSubtitle(race, { id: 's', number: 3, starts_at: '', ends_at: new Date(now + 5 * 86_400_000).toISOString(), status: 'active', timezone: 'UTC' }, now)).toBe('Starts fresh in 5 days');
  });
});

describe('a loop in every layer', () => {
  const layer = (kind: LayerResult['kind'], extra: Partial<LayerResult> = {}): LayerResult => ({
    claim_id: kind, competition_id: kind, season_id: 's', kind, name: kind === 'event' ? 'Weekend Takeover' : kind, status: 'eligible', reasons: [],
    cells: 25, area_m2: 50_000, published: true, gained_cells: 25, kept_cells: 0, taken_cells: 0, rivals: 0, ...extra
  });

  it('says what changed hands in each layer', () => {
    expect(layerOutcome(layer('permanent', { gained_cells: 12, kept_cells: 13, taken_cells: 4, rivals: 2 }))).toBe('+12 cells, 4 taken from 2 runners, 13 kept');
    expect(layerOutcome(layer('public', { gained_cells: 0, kept_cells: 25 }))).toBe('25 cells you already held');
    expect(layerOutcome(layer('event', { status: 'unranked', reasons: ['season_boundary'] }))).toBe("Not counted: the run crossed the event's start or end");
  });

  it('lists the layers under the land result', async () => {
    const claim: ClaimJson = {
      id: 'c', status: 'eligible', reasons: [], rule_version: 'territory-test', publish_after: null, published_at: null, provisional_until: null,
      raw_area_m2: 52_000, eligible_area_m2: 50_000, eligible_cell_count: 25, length_m: 1800, invalidation_reason: null, polygon: null
    };
    await render(<LandCard claim={claim} territoryRequested layers={[layer('permanent'), layer('public'), layer('event')]} />);
    expect(screen.getByText('All-time map')).toBeTruthy();
    expect(screen.getByText('Season race')).toBeTruthy();
    expect(screen.getByText('Weekend Takeover')).toBeTruthy();
  });
});

describe('events', () => {
  it('describes where an event stands', () => {
    expect(phaseText({ phase: 'upcoming', starts_at: new Date(now + 3.5 * 86_400_000).toISOString(), ends_at: '' }, now)).toBe('Starts in 4 days');
    expect(phaseText({ phase: 'live', starts_at: '', ends_at: new Date(now + 2 * 3600_000).toISOString() }, now)).toBe('Ends within a day');
    expect(phaseText({ phase: 'cancelled', starts_at: '', ends_at: '' }, now)).toBe('Cancelled');
  });

  it('offers clear start times and whole-day windows', () => {
    const wed = new Date(2026, 10, 11, 15, 0);
    const [n, tomorrow, monday] = startOptions(wed);
    expect(n!.at.getTime()).toBe(wed.getTime());
    expect([tomorrow!.at.getDate(), tomorrow!.at.getHours()]).toEqual([12, 6]);
    expect([monday!.at.getDay(), monday!.at.getDate()]).toEqual([1, 16]);
    const w = windowFrom(monday!.at, 7);
    expect(w.endsAt.getDate()).toBe(23);
  });

  it('opens event notifications on the event', () => {
    expect(routeForNotification({ kind: 'event_finished', object_type: 'competition', object_id: 'e1' })).toEqual({ pathname: '/events/[id]', params: { id: 'e1' } });
    expect(routeForNotification({ kind: 'club_challenge', object_type: 'competition', object_id: 'e2' })).toEqual({ pathname: '/events/[id]', params: { id: 'e2' } });
  });
});
