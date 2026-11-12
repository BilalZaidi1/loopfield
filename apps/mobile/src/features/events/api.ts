import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import { track } from '@/lib/analytics';

export type EventPhase = 'upcoming' | 'live' | 'finishing' | 'finished' | 'cancelled';

/** An event as the server lists it (`list_events`). Standings and land never leave the event. */
export interface EventRow {
  id: string;
  name: string;
  description: string | null;
  event_type: 'territory' | 'distance';
  team_mode: 'individual' | 'club';
  visibility: 'public' | 'members';
  region_id: string | null;
  region_name: string | null;
  host_club_id: string | null;
  host_club_name: string | null;
  host_avatar_path: string | null;
  host_tone?: import('@/features/clubs/api').ClubTone | null;
  starts_at: string;
  ends_at: string;
  target_m: number | null;
  season_id: string | null;
  phase: EventPhase;
  participants: number;
  joined: boolean;
  my_club_id: string | null;
  can_manage: boolean;
}

export interface StandingRow {
  rank: number;
  entrant_kind: 'runner' | 'club';
  /** Null for a runner you blocked (shown as "A runner"). */
  entrant_id: string | null;
  handle: string | null;
  display_name: string;
  avatar_path: string | null;
  /** Square metres of land (territory events) or metres of verified distance (distance events). */
  value: number;
  /** Runners counted for a club (club events). */
  members: number | null;
  is_me: boolean;
}

const host = (e: EventRow) => (e.host_club_id ? 'club' : 'operator');

export const useEvents = (scope: 'current' | 'finished') =>
  useQuery({ queryKey: ['events', scope], staleTime: 60_000, queryFn: () => rpc<EventRow[]>('list_events', { p_scope: scope }) });

export const useClubEvents = (clubId: string | undefined) =>
  useQuery({ queryKey: ['events', 'club', clubId], enabled: Boolean(clubId), queryFn: () => rpc<EventRow[]>('list_events', { p_club: clubId }) });

export const useEvent = (id: string | undefined) =>
  useQuery({
    queryKey: ['event', id],
    enabled: Boolean(id),
    queryFn: async () => (await rpc<EventRow[]>('list_events', { p_event: id }))[0] ?? null
  });

export const useEventStandings = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['event_standings', id],
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    queryFn: () => rpc<StandingRow[]>('event_standings', { p_event: id, p_limit: 100 })
  });

function useInvalidateEvents() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['events'] });
    void qc.invalidateQueries({ queryKey: ['competitions'] });
    if (id) {
      void qc.invalidateQueries({ queryKey: ['event', id] });
      void qc.invalidateQueries({ queryKey: ['event_standings', id] });
    }
  };
}

export function useJoinEvent(event: EventRow | null | undefined) {
  const refresh = useInvalidateEvents();
  return useMutation({
    mutationFn: (clubId: string | null) => rpc<void>('join_event', { p_event: event!.id, p_club: clubId }),
    onSuccess: () => {
      if (event) track('event_action', { action: 'joined', event_type: event.event_type, team_mode: event.team_mode, host: host(event) });
      refresh(event?.id);
    }
  });
}

export function useLeaveEvent(event: EventRow | null | undefined) {
  const refresh = useInvalidateEvents();
  return useMutation({
    mutationFn: () => rpc<void>('leave_event', { p_event: event!.id }),
    onSuccess: () => {
      if (event) track('event_action', { action: 'left', event_type: event.event_type, team_mode: event.team_mode, host: host(event) });
      refresh(event?.id);
    }
  });
}

export function useCancelEvent(event: EventRow | null | undefined) {
  const refresh = useInvalidateEvents();
  return useMutation({
    mutationFn: () => rpc<void>('cancel_event', { p_event: event!.id }),
    onSuccess: () => {
      if (event) track('event_action', { action: 'cancelled', event_type: event.event_type, team_mode: event.team_mode, host: host(event) });
      refresh(event?.id);
    }
  });
}

export interface NewEvent {
  name: string;
  description: string;
  eventType: 'territory' | 'distance';
  teamMode: 'individual' | 'club';
  regionId: string | null;
  startsAt: Date;
  endsAt: Date;
  targetM: number | null;
}

/** Club organisers create challenges for their members; operators create region or worldwide events. */
export function useCreateEvent(clubId: string | null) {
  const refresh = useInvalidateEvents();
  return useMutation({
    mutationFn: (e: NewEvent) =>
      clubId
        ? rpc<string>('create_club_event', {
            p_club: clubId,
            p_name: e.name.trim(),
            p_description: e.description.trim() || null,
            p_event_type: e.eventType,
            p_starts_at: e.startsAt.toISOString(),
            p_ends_at: e.endsAt.toISOString(),
            p_target_m: e.targetM
          })
        : rpc<string>('ops_create_event', {
            p_name: e.name.trim(),
            p_description: e.description.trim() || null,
            p_event_type: e.eventType,
            p_team_mode: e.teamMode,
            p_region: e.regionId,
            p_starts_at: e.startsAt.toISOString(),
            p_ends_at: e.endsAt.toISOString(),
            p_target_m: e.targetM
          }),
    onSuccess: (_id, e) => {
      track('event_action', { action: 'created', event_type: e.eventType, team_mode: e.teamMode, host: clubId ? 'club' : 'operator' });
      refresh();
    }
  });
}

/** Start options for the create forms: today (now), tomorrow 06:00, next Monday 06:00 (local time). */
export function startOptions(now = new Date()): { value: string; label: string; at: Date }[] {
  const at6 = (d: Date) => {
    const x = new Date(d);
    x.setHours(6, 0, 0, 0);
    return x;
  };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  return [
    { value: 'now', label: 'Now', at: new Date(now) },
    { value: 'tomorrow', label: 'Tomorrow', at: at6(tomorrow) },
    { value: 'monday', label: 'Next Monday', at: at6(monday) }
  ];
}

/** The event window from a start and a whole number of days (ends at the same local time). */
export function windowFrom(start: Date, days: number): { startsAt: Date; endsAt: Date } {
  const end = new Date(start);
  end.setDate(start.getDate() + days);
  return { startsAt: start, endsAt: end };
}

/** "Starts in 3 days", "Ends in 2 days", "Ended 4 Nov", for list rows and the detail header. */
export function phaseText(e: Pick<EventRow, 'phase' | 'starts_at' | 'ends_at'>, now = Date.now()): string {
  const days = (iso: string) => Math.ceil((Date.parse(iso) - now) / 86_400_000);
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  switch (e.phase) {
    case 'upcoming': {
      const d = days(e.starts_at);
      return d <= 1 ? 'Starts within a day' : `Starts in ${d} days`;
    }
    case 'live': {
      const d = days(e.ends_at);
      return d <= 1 ? 'Ends within a day' : `Ends in ${d} days`;
    }
    case 'finishing':
      return 'Finished · results within a day';
    case 'cancelled':
      return 'Cancelled';
    default:
      return `Ended ${date(e.ends_at)}`;
  }
}
