import type { PublicLiveLink } from './api';

/** Words for the live link page (R1), kept apart from the page so they can be tested. */
export const STALE_MS = 2 * 60_000;

export function liveHeadline(d: Pick<PublicLiveLink, 'status' | 'name'>): { title: string; body: string | null } {
  switch (d.status) {
    case 'waiting':
      return { title: `${d.name} hasn't started yet`, body: 'The run shows here as soon as it starts. Keep this page open; it updates by itself.' };
    case 'running':
      return { title: `${d.name} is running`, body: null };
    case 'paused':
      return { title: `${d.name} has paused`, body: null };
    case 'finished':
      return { title: `${d.name} has finished`, body: 'The trail stays here for a short while, then this page stops showing it.' };
    case 'not_running':
      return { title: `${d.name} isn't running right now`, body: 'When they start a run, it shows here. This page updates by itself.' };
    default:
      return { title: 'This live link has ended', body: 'It no longer shows a location.' };
  }
}

/** "Updated 40 s ago" while fresh; a plain warning once nothing has arrived for a couple of minutes. */
export function freshness(lastUpdate: string | null | undefined, now: number): { text: string; stale: boolean } | null {
  if (!lastUpdate) return null;
  const age = Math.max(0, now - new Date(lastUpdate).getTime());
  if (age >= STALE_MS) return { text: `No update for ${Math.floor(age / 60_000)} min. Their phone may have lost signal.`, stale: true };
  return { text: age < 15_000 ? 'Updated just now' : `Updated ${Math.round(age / 1000)} s ago`, stale: false };
}

export const mapsLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** "38 min", "1 h 05 min": how long someone has been out, to the minute (the page refreshes every half minute). */
export function fmtElapsed(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
