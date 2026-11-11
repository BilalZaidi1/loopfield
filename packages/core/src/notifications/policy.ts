/**
 * Notification delivery policy (FR25, FR45): categories, quiet hours across time zones,
 * daily digests and safe push previews (no message text, health readings or private route details).
 */

export type NotificationCategory = 'social' | 'message' | 'club' | 'competitive' | 'system';

export interface NotificationPrefs {
  social: boolean;
  messages: boolean;
  clubs: boolean;
  competitiveDigest: boolean;
  territoryLoss: boolean;
  marketing: boolean;
  quietStart: string | null; // "22:00"
  quietEnd: string | null; // "07:00"
  timezone: string; // IANA
}

export const DEFAULT_PREFS: NotificationPrefs = {
  social: true,
  messages: true,
  clubs: true,
  competitiveDigest: true,
  territoryLoss: true,
  marketing: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  timezone: 'UTC'
};

export function categoryEnabled(prefs: NotificationPrefs, category: NotificationCategory, kind?: string): boolean {
  switch (category) {
    case 'social':
      return prefs.social;
    case 'message':
      return prefs.messages;
    case 'club':
      return prefs.clubs;
    case 'competitive':
      return prefs.competitiveDigest && (kind !== 'territory_lost' || prefs.territoryLoss);
    case 'system':
      return true;
  }
}

/** Minutes since local midnight in an IANA zone. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function inQuietHours(prefs: NotificationPrefs, now: Date): boolean {
  if (!prefs.quietStart || !prefs.quietEnd) return false;
  const start = toMinutes(prefs.quietStart);
  const end = toMinutes(prefs.quietEnd);
  if (start === end) return false;
  const local = localMinutes(now, prefs.timezone);
  return start < end ? local >= start && local < end : local >= start || local < end;
}

/** Push text never includes message bodies, health values, exact times or route details. */
export function safePushPreview(kind: string, actorName: string | null): { title: string; body: string } {
  const who = actorName ?? 'Someone';
  switch (kind) {
    case 'message':
      return { title: 'New message', body: `${who} sent you a message` };
    case 'follow_request':
      return { title: 'Follow request', body: `${who} asked to follow you` };
    case 'follow_accepted':
      return { title: 'New follower', body: `${who} accepted your request` };
    case 'comment':
      return { title: 'New comment', body: `${who} commented on your post` };
    case 'mention':
      return { title: 'Mention', body: `${who} mentioned you` };
    case 'reaction':
      return { title: 'Cheer', body: `${who} cheered your post` };
    case 'club_invite':
      return { title: 'Club invitation', body: 'You have a new club invitation' };
    case 'club_request_approved':
      return { title: 'Club', body: 'Your request to join was approved' };
    case 'territory_digest':
      return { title: 'Daily territory update', body: 'Your land changed today. Open to see the details.' };
    case 'title_digest':
      return { title: 'Route title update', body: 'A route title you hold or chased changed.' };
    case 'badge_earned':
      return { title: 'Badge earned', body: 'You completed a challenge. Open to see your new badge.' };
    case 'points_refunded':
      return { title: 'Points refunded', body: 'A run that took your ground was ruled invalid, so your points are back.' };
    case 'appeal_decided':
      return { title: 'Review complete', body: 'A decision on your request is ready.' };
    case 'export_ready':
      return { title: 'Export ready', body: 'Your data export is ready to download.' };
    default:
      return { title: 'Loopfield', body: 'You have a new update' };
  }
}
