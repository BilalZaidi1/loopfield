const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago" — or "in 4 d" for future times. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = now.getTime() - t;
  const abs = Math.abs(diff);
  let text: string;
  if (abs < MINUTE) return diff >= 0 ? 'just now' : 'in under a minute';
  if (abs < HOUR) text = `${Math.round(abs / MINUTE)} min`;
  else if (abs < DAY) text = `${Math.round(abs / HOUR)} h`;
  else text = `${Math.round(abs / DAY)} d`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** Age of the oldest item in a queue, for SLA hints: "12 min", "3 h", "2 d". */
export function age(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h`;
  return `${Math.round(diff / DAY)} d`;
}

export function ageMinutes(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / MINUTE);
}

export function dateTime(iso: string | null | undefined, timeZone = 'UTC'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

export function count(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(n ?? 0);
}

export function km(meters: number | null | undefined): string {
  if (meters == null) return '—';
  return `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} km`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

/** "territory_capture_enabled" → "Territory capture enabled" */
export function humanize(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
