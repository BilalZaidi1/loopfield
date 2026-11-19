import type { ConfigRow } from '@/lib/types';

/**
 * Client-side mirror of internal.validate_config_value for instant feedback. The database stays
 * authoritative: anything that passes here is still checked again by ops_set_config.
 */
export const CORE_FEATURES = [
  'territory', 'territory_capture', 'land', 'reclaim', 'speed', 'speed_titles', 'competition', 'seasons', 'events',
  'clubs', 'social', 'posts', 'comments', 'follows', 'messaging', 'chat', 'health', 'privacy', 'protected_areas',
  'consent', 'deletion', 'account_deletion', 'data_export', 'export', 'recording', 'appeals', 'reports'
];

const VERSION = /^\d+\.\d+\.\d+$/;
const KEY = /^[a-z][a-z0-9_]{1,40}$/;

type Meta = Pick<ConfigRow, 'key' | 'label' | 'value_type' | 'min_value' | 'max_value' | 'allowed'>;

/** Returns a message for the operator, or null when the value is acceptable. */
export function validateConfigValue(meta: Meta, value: unknown): string | null {
  const { label } = meta;
  if (value === null || value === undefined) return `${label} needs a value`;
  switch (meta.value_type) {
    case 'boolean':
      if (typeof value !== 'boolean') return `${label} must be on or off`;
      break;
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`;
      if (meta.value_type === 'integer' && !Number.isInteger(value)) return `${label} must be a whole number`;
      if ((meta.min_value != null && value < meta.min_value) || (meta.max_value != null && value > meta.max_value)) {
        return `${label} must be between ${meta.min_value} and ${meta.max_value}`;
      }
      break;
    }
    case 'string':
      if (typeof value !== 'string') return `${label} must be text`;
      if (meta.allowed && !meta.allowed.includes(value)) return `${label} must be one of: ${meta.allowed.join(', ')}`;
      break;
    case 'version':
      if (typeof value !== 'string' || !VERSION.test(value)) return `${label} must look like 1.2.3`;
      break;
    case 'string_array':
      if (!Array.isArray(value)) return `${label} must be a list`;
      for (const v of value) {
        if (typeof v !== 'string' || !KEY.test(v)) return `${label} entries must be lowercase keys (a-z, 0-9, _)`;
        if (meta.key === 'premium_features' && CORE_FEATURES.includes(v)) return `"${v}" is a core feature and can never require premium`;
      }
      break;
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return `${label} must be an object`;
      const keys = Object.keys(value as object);
      if (meta.allowed) {
        const unknown = keys.find((k) => !meta.allowed!.includes(k));
        if (unknown) return `${label} has an unknown field "${unknown}"`;
      }
      return validateShape(meta.key, value as Record<string, unknown>);
    }
    default:
      break;
  }
  return null;
}

function validateShape(key: string, v: Record<string, unknown>): string | null {
  if (key === 'achievement_tier_points') {
    if (Object.keys(v).length !== 4) return 'Set points for bronze, silver, gold and platinum';
    for (const n of Object.values(v)) {
      if (typeof n !== 'number' || n < 0 || n > 1000) return 'Tier points must be between 0 and 1000';
    }
  }
  if (key === 'latest_app_version') {
    for (const n of Object.values(v)) if (typeof n !== 'string' || !VERSION.test(n)) return 'Versions must look like 1.2.3';
  }
  if (key === 'maintenance_mode') {
    if (typeof v.enabled !== 'boolean') return 'Maintenance mode needs enabled set to true or false';
    const message = typeof v.message === 'string' ? v.message.trim() : '';
    if (v.enabled && message.length < 5) return 'Write a message for users (at least 5 characters) while maintenance is on';
    if (message.length > 200) return 'Keep the maintenance message under 200 characters';
    if (v.until != null && (typeof v.until !== 'string' || Number.isNaN(Date.parse(v.until)))) return 'Until must be a time or empty';
  }
  return null;
}

/** Short display form of a setting value. */
export function formatValue(value: unknown): string {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('en-US').format(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return JSON.stringify(value);
}

/** Settings whose change can lock people out or affect every user: they need a typed confirmation. */
export const DANGEROUS_KEYS = new Set(['paywall_enabled', 'premium_features', 'maintenance_mode', 'ops_require_mfa', 'min_supported_app_version']);
