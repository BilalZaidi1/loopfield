import { safePushPreview } from '@loopfield/core';
import type { IconName } from '@/components/icons';
import { fmtArea } from '@/lib/format';

export interface NotificationLike {
  category: 'social' | 'message' | 'club' | 'competitive' | 'system';
  kind: string;
  object_type: string | null;
  data: Record<string, unknown> | null;
  actor: { display_name: string } | null;
}

/** Tabs of the notification centre. */
export type NotificationFilter = 'all' | 'land' | 'social' | 'clubs' | 'events' | 'milestones' | 'account';

export const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'land', label: 'Land' },
  { value: 'social', label: 'Social' },
  { value: 'clubs', label: 'Communities' },
  { value: 'events', label: 'Events' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'account', label: 'Account' }
];

const EVENT_KINDS = new Set(['event_starting', 'event_finished', 'event_cancelled', 'club_challenge', 'season_finished']);

export function filterOf(n: Pick<NotificationLike, 'category' | 'kind'>): Exclude<NotificationFilter, 'all'> {
  if (EVENT_KINDS.has(n.kind)) return 'events';
  if (n.kind === 'badge_earned') return 'milestones';
  if (n.kind.startsWith('territory') || n.kind === 'title_digest' || n.kind === 'points_refunded') return 'land';
  if (n.category === 'social' || n.category === 'message') return 'social';
  if (n.category === 'club') return 'clubs';
  return 'account';
}

interface Layer {
  kind?: string;
  name?: string;
  cells?: number;
  taken?: number;
}

const layerName = (l: Layer) => (l.kind === 'permanent' ? 'the all-time map' : l.name ?? 'a race');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

/** Main layer first (the all-time map), then the others in a short tail. */
function layerSentence(layers: Layer[], verbCells: (l: Layer) => string): string {
  const sorted = [...layers].sort((a, b) => (a.kind === 'permanent' ? -1 : b.kind === 'permanent' ? 1 : 0));
  const [first, ...rest] = sorted;
  if (!first) return '';
  const tail = rest.length ? ` (and ${rest.map((l) => `${l.cells ?? 0} in ${layerName(l)}`).join(', ')})` : '';
  return `${verbCells(first)} on ${layerName(first)}${tail}`;
}

/**
 * What a notification row says in the app. Pushes use the content-free preview from core; the list can
 * name the badge, event, community or area (never the other runner in a land change).
 */
export function presentNotification(n: NotificationLike, units: 'metric' | 'imperial'): { title: string; body: string; icon: IconName } {
  const base = safePushPreview(n.kind, n.actor?.display_name ?? null);
  const d = (n.data ?? {}) as Record<string, unknown> & { layers?: Layer[] };
  const name = typeof d.name === 'string' ? d.name : null;
  const club = typeof d.club_name === 'string' ? d.club_name : null;
  const near = typeof d.district === 'string' ? ` near ${d.district}` : '';
  const who = n.actor?.display_name ?? 'Someone';
  const layers = Array.isArray(d.layers) ? d.layers : [];
  switch (n.kind) {
    case 'territory_captured': {
      const main = layers.find((l) => l.kind === 'permanent') ?? layers[0];
      const taken = main?.taken ? `, ${main.taken} of them from other runners` : '';
      return { icon: 'hexagon', title: 'Your land is on the map', body: layers.length ? `Your run captured ${layerSentence(layers, (l) => plural(l.cells ?? 0, 'cell'))}${near}${taken}.` : base.body };
    }
    case 'territory_lost':
      return { icon: 'hexagon', title: 'Land changed hands', body: layers.length ? `Another runner took ${layerSentence(layers, (l) => `${l.cells ?? 0} of your cells`)}${near}.` : base.body };
    case 'territory_contested': {
      const runners = typeof d.runners === 'number' ? d.runners : null;
      return {
        icon: 'flag',
        title: `Your land${near} is contested`,
        body: `${runners ? `${runners} runners have` : 'Several runners have'} taken cells from you this week. Plan a loop when it suits you.`
      };
    }
    case 'territory_digest': {
      const gained = typeof d.gained_cells === 'number' ? d.gained_cells : 0;
      const lost = typeof d.lost_cells === 'number' ? d.lost_cells : 0;
      const parts = [gained ? `captured ${plural(gained, 'cell')}` : null, lost ? `lost ${plural(lost, 'cell')}` : null].filter(Boolean);
      return { icon: 'hexagon', title: 'Daily land update', body: parts.length ? `Today you ${parts.join(' and ')}.` : base.body };
    }
    case 'friend_run':
      return { icon: 'route', title: `${who} shared a run`, body: 'Open it to cheer or comment.' };
    case 'club_member_joined':
      return { icon: 'clubs', title: `${who} joined ${club ?? 'your community'}`, body: d.kind === 'group' ? 'They can see the group and its chat now.' : 'Say hello in the community feed.' };
    case 'club_announcement':
      return { icon: 'bell', title: `Announcement in ${club ?? 'your community'}`, body: `${who} posted an announcement.` };
    case 'club_deleted':
      return { icon: 'clubs', title: `${club ?? 'A community'} was deleted`, body: 'Its posts, race and challenges are gone. Your runs and land are not affected.' };
    case 'season_finished': {
      const rank = typeof d.rank === 'number' ? d.rank : null;
      const runners = typeof d.runners === 'number' ? d.runners : null;
      const area = typeof d.area_m2 === 'number' ? fmtArea(d.area_m2, units) : null;
      return {
        icon: 'trophy',
        title: `${name ?? 'Season'}${typeof d.season === 'number' ? ` · season ${d.season}` : ''}: results`,
        body: rank ? `You finished ${ordinal(rank)}${runners ? ` of ${runners}` : ''}${area ? ` with ${area}` : ''}. A new season has started.` : base.body
      };
    }
    case 'badge_earned': {
      const title = typeof d.title === 'string' ? d.title : null;
      const tier = typeof d.tier === 'string' ? d.tier : null;
      return title ? { icon: 'trophy', title: `Badge earned: ${title}`, body: `${tier ? `${tier[0]!.toUpperCase()}${tier.slice(1)} badge` : 'New badge'} added to your collection` } : { icon: 'trophy', ...base };
    }
    case 'points_refunded':
      return { icon: 'bolt', title: typeof d.points === 'number' ? `${d.points} points refunded` : base.title, body: base.body };
    case 'event_finished': {
      const rank = typeof d.rank === 'number' ? d.rank : null;
      const clubRank = typeof d.club_rank === 'number' ? d.club_rank : null;
      return name
        ? { icon: 'flag', title: `${name}: results`, body: rank ? `You finished ${ordinal(rank)}${clubRank ? `; your club finished ${ordinal(clubRank)}` : ''}.` : 'The event has finished. See the final standings.' }
        : { icon: 'flag', ...base };
    }
    case 'event_starting':
    case 'event_cancelled':
      return { icon: 'flag', title: name ?? base.title, body: base.body };
    case 'club_challenge':
      return { icon: 'flag', title: name ? `New challenge: ${name}` : base.title, body: club ? `${n.actor?.display_name ?? 'An admin'} set it for ${club}` : base.body };
  }
  const icon: IconName = n.object_type === 'competition' ? 'flag' : ({ social: 'heart', message: 'chat', club: 'clubs', competitive: 'hexagon', system: 'info' } as const)[n.category] ?? 'bell';
  return { icon, ...base };
}
