export const ROLES = ['admin', 'territory_operator', 'moderator', 'integrity_reviewer', 'route_reviewer', 'support'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  territory_operator: 'Territory operator',
  moderator: 'Moderator',
  integrity_reviewer: 'Integrity reviewer',
  route_reviewer: 'Route reviewer',
  support: 'Support'
};

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including settings, staff and the audit log.',
  territory_operator: 'Kill switches, regions, exclusions, seasons, events and replays.',
  moderator: 'Reports, content and account decisions, content appeals, clubs.',
  integrity_reviewer: 'Holds, invalidations, competitive appeals and raw evidence.',
  route_reviewer: 'Route proposals and course status.',
  support: 'Runner lookup and account requests.'
};

/** Admin implies every role, matching authz.has_role in the database. */
export function hasRole(roles: readonly string[], role: Role): boolean {
  return roles.includes('admin') || roles.includes(role);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
