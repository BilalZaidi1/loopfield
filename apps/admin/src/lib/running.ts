import type { LiveSharing, RouteProposalRow } from '@/lib/types';

/**
 * The running tools (route builder, live links, runners out right now, live runs with friends, stretch
 * proposals, shoes) as the console shows them. Staff only ever see counts, and whether sharing is on.
 */

/** The PostHog dashboard for the running tools (docs/BACK_OFFICE.md, Running features). Opening it needs a PostHog login. */
export const RUNNING_TOOLS_DASHBOARD_URL: string | null = 'https://eu.posthog.com/project/333912/dashboard/1155435';

/** The health cards the app can hide (App control → disabled_health_cards), in the app's order. */
export const HEALTH_CARD_LABELS: Record<string, string> = {
  heart_rate: 'Heart rate',
  steps: 'Steps',
  calories: 'Active calories',
  sleep: 'Sleep',
  resting_hr: 'Resting heart rate',
  hrv: 'Heart-rate variability',
  vo2_max: 'VO₂ max',
  training: 'Training',
  imported_routes: 'Maps of imported runs'
};

/** Reasons reviewers can pick when declining a proposal; the reason is sent to the runner. */
export const ROUTE_DECLINE_PRESETS = [
  'Start or finish in an unsafe spot',
  'Too close to an existing route',
  'Runs along busy roads without pavements',
  'Not a good route to race'
];

/** What a reviewer confirms before approving a start-to-finish route. */
export const START_TO_FINISH_CHECKLIST = [
  'The start and the finish are in safe spots, not in the middle of a crossing',
  'It avoids busy roads without pavements',
  'It is not an existing route run backwards'
];

const kmText = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

/** The badge: "Part of a run" or "Whole run". */
export function sourceLabel(r: Pick<RouteProposalRow, 'from_m' | 'to_m'>): 'Part of a run' | 'Whole run' {
  return r.from_m != null && r.to_m != null ? 'Part of a run' : 'Whole run';
}

/** Where the part starts and ends: "1.2 to 2.7 km along the run" (null for a whole run). */
export function stretchText(r: Pick<RouteProposalRow, 'from_m' | 'to_m'>): string | null {
  return r.from_m != null && r.to_m != null ? `${kmText(r.from_m).replace(' km', '')} to ${kmText(r.to_m)} along the run` : null;
}

export function shapeLabel(r: Pick<RouteProposalRow, 'shape' | 'closed'>): 'Loop' | 'Start to finish' {
  const shape = r.shape ?? (r.closed ? 'loop' : 'a_to_b');
  return shape === 'a_to_b' ? 'Start to finish' : 'Loop';
}

/** "1 day 2 h", "5 h", "under an hour". */
export function waitedText(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return 'under an hour';
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  if (!d) return `${h} h`;
  return `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}`;
}

/** The length check: within the limits the server used, or the plain length when they are unknown. */
export function lengthCheck(length_m: number, min: number | null | undefined, max: number | null | undefined): { ok: boolean; text: string } {
  if (min == null || max == null) return { ok: true, text: kmText(length_m) };
  return { ok: length_m >= min && length_m <= max, text: `${kmText(length_m)}, limits ${kmText(min).replace(' km', '')}–${kmText(max)}` };
}

/** Where path-following requests this month stand against the alert level (0 means no alert set). */
export function snapAlertState(month: number, alert: number): 'unset' | 'ok' | 'near' | 'over' {
  if (!alert || alert <= 0) return 'unset';
  if (month >= alert) return 'over';
  return month >= 0.8 * alert ? 'near' : 'ok';
}

/** The runner panel's two lines. Never positions, links or who they share with. */
export function sharingLines(s: LiveSharing | undefined): { live: string; friends: string; note: string | null; anything: boolean } {
  if (!s) return { live: 'Not available', friends: 'Not available', note: null, anything: false };
  const live = s.live_links ? `Active · ${s.live_links} open link${s.live_links === 1 ? '' : 's'}` : 'None';
  const friends = s.friends_sharing ? 'On' : 'Off';
  const paused = [!s.live_links_enabled && 'Live links', !s.friends_live_enabled && 'Live runs with friends'].filter(Boolean);
  const note = paused.length ? `Switched off in App control: ${paused.join(' and ')}. Nothing is shared that way until it is back on.` : null;
  return { live, friends, note, anything: s.live_links > 0 || s.friends_sharing };
}

/** The toast after support ends a runner's live sharing. */
export function endedMessage(r: { links_ended: number; friend_sharing_off: boolean }): string {
  const links = r.links_ended ? `Ended ${r.links_ended} live link${r.links_ended === 1 ? '' : 's'}` : '';
  if (!links && !r.friend_sharing_off) return 'Nothing was open, so nothing changed.';
  const friends = r.friend_sharing_off ? (links ? ' and turned off sharing with friends' : 'Turned off sharing with friends') : '';
  return `${links}${friends}. The runner is told in the app.`;
}
