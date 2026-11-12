import type { Permission } from '@/lib/roles';

/** Overview widgets. Each staff member picks and orders them; the choice is saved per person (ops_set_preference). */
export type WidgetBand = 'tile' | 'chart' | 'panel';
export interface WidgetDef {
  id: string;
  label: string;
  band: WidgetBand;
  needs?: Permission;
  metric?: string;
}

export const WIDGETS: WidgetDef[] = [
  { id: 'kpi_active', label: 'Active runners today', band: 'tile', needs: 'analytics', metric: 'active_runners' },
  { id: 'kpi_runs', label: 'Runs today', band: 'tile', needs: 'analytics', metric: 'runs' },
  { id: 'kpi_distance', label: 'Distance today', band: 'tile', needs: 'analytics', metric: 'distance_km' },
  { id: 'kpi_loops', label: 'Loops that claimed land today', band: 'tile', needs: 'analytics', metric: 'loops_claimed' },
  { id: 'kpi_signups', label: 'Sign-ups today', band: 'tile', needs: 'analytics', metric: 'signups' },
  { id: 'kpi_land', label: 'Land captured today', band: 'tile', needs: 'analytics', metric: 'land_km2' },
  { id: 'kpi_support', label: 'Open support conversations', band: 'tile', needs: 'support' },
  { id: 'kpi_runners', label: 'Runners in total', band: 'tile' },
  { id: 'chart_runs', label: 'Runs, last 14 days', band: 'chart', needs: 'analytics', metric: 'runs' },
  { id: 'chart_active', label: 'Active runners, last 14 days', band: 'chart', needs: 'analytics', metric: 'active_runners' },
  { id: 'chart_signups', label: 'Sign-ups, last 14 days', band: 'chart', needs: 'analytics', metric: 'signups' },
  { id: 'chart_loops', label: 'Loops that claimed land, last 14 days', band: 'chart', needs: 'analytics', metric: 'loops_claimed' },
  { id: 'chart_distance', label: 'Distance, last 14 days', band: 'chart', needs: 'analytics', metric: 'distance_km' },
  { id: 'chart_support', label: 'Support conversations, last 14 days', band: 'chart', needs: 'analytics', metric: 'support_opened' },
  { id: 'queues', label: 'Review queues', band: 'panel' },
  { id: 'switches', label: 'Kill switches and app state', band: 'panel' },
  { id: 'jobs', label: 'Background jobs', band: 'panel' },
  { id: 'seasons', label: 'Running seasons', band: 'panel' },
  { id: 'schedules', label: 'Scheduled tasks', band: 'panel' },
  { id: 'delivery', label: 'Email and billing problems', band: 'panel' },
  { id: 'support_queue', label: 'Support inbox', band: 'panel', needs: 'support' }
];

export const DEFAULT_WIDGETS = ['kpi_active', 'kpi_runs', 'kpi_distance', 'kpi_signups', 'chart_runs', 'chart_active', 'queues', 'switches', 'jobs', 'seasons', 'schedules', 'support_queue'];

export function availableWidgets(permissions: readonly string[]): WidgetDef[] {
  return WIDGETS.filter((w) => !w.needs || permissions.includes(w.needs));
}

/** The saved choice, keeping only widgets that still exist and that this person may see. */
export function chosenWidgets(saved: unknown, permissions: readonly string[]): WidgetDef[] {
  const avail = availableWidgets(permissions);
  const ids = Array.isArray(saved) && saved.every((x) => typeof x === 'string') ? (saved as string[]) : DEFAULT_WIDGETS;
  return ids.map((id) => avail.find((w) => w.id === id)).filter((w): w is WidgetDef => Boolean(w));
}

const XL: Record<number, string> = { 3: 'xl:col-span-3', 4: 'xl:col-span-4', 6: 'xl:col-span-6', 12: 'xl:col-span-12' };
const MD: Record<number, string> = { 6: 'md:col-span-6', 12: 'md:col-span-12' };
const BASE: Record<number, string> = { 6: 'col-span-6', 12: 'col-span-12' };

/**
 * Column spans on a 12-column grid that leave no holes: full rows at the band's width, and the last,
 * incomplete row shared out evenly by the items in it (at every breakpoint).
 */
export function bandSpans(n: number, xlPerRow: number, mdPerRow: number, basePerRow = 1): string[] {
  const span = (i: number, per: number) => 12 / (n % per && i >= n - (n % per) ? n % per : per);
  return Array.from({ length: n }, (_, i) => `${BASE[span(i, basePerRow)] ?? 'col-span-12'} ${MD[span(i, mdPerRow)] ?? 'md:col-span-12'} ${XL[span(i, xlPerRow)] ?? 'xl:col-span-12'}`);
}

export const BAND_LAYOUT: Record<WidgetBand, { xl: number; md: number; base: number }> = { tile: { xl: 4, md: 2, base: 2 }, chart: { xl: 2, md: 1, base: 1 }, panel: { xl: 3, md: 2, base: 1 } };
