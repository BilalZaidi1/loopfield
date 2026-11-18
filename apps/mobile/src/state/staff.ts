/**
 * What this person may do in the operator tools, from `ops_whoami()`. Permissions come from the roles the
 * back office grants (built-in or custom), so screens check permissions, never role names. Every
 * operator action is still checked on the server.
 */
export interface StaffAccess {
  permissions: string[];
  /** Role names and labels, for display only. */
  roles: string[];
  roleLabels: string[];
  /** The back office requires an authenticator code for operator actions (`ops_require_mfa`). */
  requireMfa: boolean;
}

export const NO_STAFF: StaffAccess = { permissions: [], roles: [], roleLabels: [], requireMfa: false };

export interface WhoAmI {
  status?: string;
  roles?: unknown;
  role_labels?: unknown;
  permissions?: unknown;
  require_mfa?: unknown;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function parseWhoAmI(w: WhoAmI | null | undefined): StaffAccess {
  if (!w) return NO_STAFF;
  return { permissions: strings(w.permissions), roles: strings(w.roles), roleLabels: strings(w.role_labels), requireMfa: w.require_mfa === true };
}
