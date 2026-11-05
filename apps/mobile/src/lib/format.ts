import { formatDuration, metersToDisplay, paceToDisplay } from '@loopfield/core';

export type Units = 'metric' | 'imperial';

export function fmtDistance(m: number | null | undefined, units: Units, digits = 2): string {
  if (m == null) return '—';
  const d = metersToDisplay(m, units);
  return `${d.value.toFixed(digits)} ${d.unit}`;
}

export function fmtPace(secPerKm: number | null | undefined, units: Units): string {
  if (!secPerKm) return '—';
  const p = paceToDisplay(secPerKm, units);
  return `${p.value} ${p.unit}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return formatDuration(ms);
}

export function fmtArea(m2: number | null | undefined, units: Units): string {
  if (m2 == null) return '—';
  if (units === 'imperial') return `${(m2 / 4046.856).toFixed(m2 < 40_000 ? 2 : 1)} acres`;
  return m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : `${(m2 / 10_000).toFixed(2)} ha`;
}

export function fmtDate(iso: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (iso == null) return '—';
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} d ago`;
  return fmtDate(iso);
}

/** "8 Sep" style label for a calendar day given as YYYY-MM-DD (parsed as a local date, never shifted by time zone). */
export function fmtDay(isoDay: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const [y, m, d] = isoDay.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return isoDay;
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(y, m - 1, d));
}

/** Splits a formatted distance ("12.40 km") into its number and unit for large numeral layouts. */
export function splitValue(formatted: string): { value: string; unit: string } {
  const i = formatted.lastIndexOf(' ');
  return i > 0 ? { value: formatted.slice(0, i), unit: formatted.slice(i + 1) } : { value: formatted, unit: '' };
}
