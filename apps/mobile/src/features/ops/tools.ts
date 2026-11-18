import { allowed, type Permission } from './StaffGate';

/** Which permission opens each tool (roles, built-in or custom, are only bundles of these). */
export const OPS_TOOLS: { key: string; need: Permission | Permission[]; icon: 'flag' | 'route' | 'target' | 'settings' | 'calendar'; title: string; subtitle: string; href: '/ops/moderation' | '/ops/routes' | '/ops/integrity' | '/ops/system' | '/ops/seasons'; group: 'queues' | 'system' }[] = [
  { key: 'moderation', need: 'moderation', icon: 'flag', title: 'Moderation queue', subtitle: 'Reports, content and account decisions, content appeals', href: '/ops/moderation', group: 'queues' },
  { key: 'routes', need: 'routes', icon: 'route', title: 'Route proposals', subtitle: 'Approve, decline, suspend routes', href: '/ops/routes', group: 'queues' },
  { key: 'integrity', need: 'integrity', icon: 'target', title: 'Integrity cases', subtitle: 'Holds, invalidations and competitive appeals', href: '/ops/integrity', group: 'queues' },
  { key: 'system', need: ['territory', 'config', 'jobs', 'staff'], icon: 'settings', title: 'Switches, regions and jobs', subtitle: 'Kill switches, exclusions, season replay, failed jobs, staff roles', href: '/ops/system', group: 'system' },
  { key: 'seasons', need: 'territory', icon: 'calendar', title: 'Seasons and events', subtitle: 'Race season dates, automatic length, events', href: '/ops/seasons', group: 'system' }
];

/** The tools these permissions open, in menu order. */
export function toolsFor(permissions: readonly string[]) {
  return OPS_TOOLS.filter((t) => allowed(permissions, t.need));
}

/** One row of `ops_config()`: the value plus its registry metadata and last change. */
export interface ConfigRow {
  key: string;
  value: unknown;
  label: string;
  category: string;
  value_type: string;
  allowed: string[] | null;
  help: string | null;
  can_edit: boolean;
  sort: number;
  last_changed_by: string | null;
  last_reason: string | null;
  last_changed_at: string | null;
}

/** Every kill switch the back office registers (category "switch"), in its order. */
export function switchRows(rows: readonly ConfigRow[]): ConfigRow[] {
  return rows.filter((r) => r.category === 'switch').sort((a, b) => a.sort - b.sort);
}
