import { fmtDistance } from '@/lib/format';
import { wear, type Gear } from './api';

type Units = 'metric' | 'imperial';
const MILE = 1609.344;

/** A pair's distance in whole kilometres or miles. */
export const gearDistance = (m: number, units: Units) => fmtDistance(m, units, 0);

export function gearSubtitle(g: Gear, units: Units): string {
  const runs = g.runs === 1 ? '1 run' : `${g.runs} runs`;
  return `${gearDistance(g.distance_m, units)} · ${runs}${g.is_default ? ' · new runs count here' : ''}`;
}

export function reminderText(g: Gear, units: Units): string {
  const at = gearDistance(g.reminder_m, units);
  const due = wear(g).due;
  return due === 'now' ? `Past its reminder distance of ${at}. Time to think about a new pair?` : due === 'soon' ? `Nearly at its reminder distance of ${at}.` : `Reminder at ${at}.`;
}

/** A distance typed in the runner's units ("512", "512.5" or "512,5"), in metres; null when it is not a number. */
export function typedMetres(text: string, units: Units): number | null {
  const n = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * (units === 'imperial' ? MILE : 1000));
}

export function metresText(m: number, units: Units): string {
  return String(Math.round(m / (units === 'imperial' ? MILE : 1000)));
}

export const unitWord = (units: Units) => (units === 'imperial' ? 'miles' : 'km');
