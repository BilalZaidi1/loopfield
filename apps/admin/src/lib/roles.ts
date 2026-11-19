/**
 * Permissions are the unit of access (internal.staff_permissions); roles bundle them and are edited on
 * the Roles screen. Admin holds every permission. The database checks again on every call; these only
 * decide what the console shows.
 */
export const PERMISSIONS = [
  'moderation', 'integrity', 'routes', 'territory', 'rules.edit', 'rules.apply', 'users.view', 'users.manage', 'support',
  'analytics', 'sql', 'config', 'monetization', 'jobs', 'audit', 'staff'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  moderation: 'Moderation',
  integrity: 'Integrity cases',
  routes: 'Route proposals',
  territory: 'Kill switches and seasons',
  'rules.edit': 'Edit game rules',
  'rules.apply': 'Apply rules to running seasons',
  'users.view': 'View runners',
  'users.manage': 'Suspend and sign out runners',
  support: 'Support inbox',
  analytics: 'Analytics',
  sql: 'SQL editor',
  config: 'App settings',
  monetization: 'Monetization',
  jobs: 'Jobs',
  audit: 'Audit log',
  staff: 'Staff'
};

export function hasPermission(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes(permission);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Built-in role labels, for places that only have the role key (custom roles carry their own label). */
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  territory_operator: 'Territory operator',
  moderator: 'Moderator',
  integrity_reviewer: 'Integrity reviewer',
  route_reviewer: 'Route reviewer',
  support: 'Support',
  analyst: 'Analyst'
};

export function roleLabel(key: string): string {
  return ROLE_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
