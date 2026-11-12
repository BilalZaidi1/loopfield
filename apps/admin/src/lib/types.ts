/** Shapes returned by the ops_* RPCs (supabase/migrations/*_ops_api.sql and *_backoffice.sql). */

export interface JobStats {
  queued: number;
  running: number;
  dead: number;
  failed_24h: number;
  oldest_ready_at: string | null;
}

export interface Overview {
  generated_at: string;
  settings: Record<string, unknown>;
  jobs: Record<string, JobStats>;
  queues: {
    moderation: { open: number; urgent: number; oldest: string | null };
    integrity: { open: number; held: number; oldest: string | null };
    appeals: { open: number; oldest: string | null };
    routes: { open: number; oldest: string | null };
    reports_24h: number;
    exports: number;
    deletions: number;
  };
  activity_24h: { runs: number; claims: number; sign_ups: number; posts: number };
  totals: { runners: number; suspended: number; clubs: number; staff: number };
  billing: { failed_events_7d: number };
  email: { bounced_7d: number; failed_7d: number };
  seasons: { competition: string; number: number; status: string; starts_at: string; ends_at: string }[];
  cron: { job: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_end: string | null }[];
}

export type ValueType = 'boolean' | 'integer' | 'number' | 'string' | 'string_array' | 'version' | 'object' | 'array' | 'null';
export type ConfigCategory = 'switch' | 'tunable' | 'release' | 'monetization' | 'system' | 'other';

export interface ConfigRow {
  key: string;
  value: unknown;
  is_public: boolean;
  description: string | null;
  updated_at: string;
  label: string;
  category: ConfigCategory;
  value_type: ValueType;
  min_value: number | null;
  max_value: number | null;
  allowed: string[] | null;
  min_role: 'admin' | 'territory_operator';
  sort: number;
  help: string | null;
  can_edit: boolean;
  last_changed_by: string | null;
  last_reason: string | null;
  last_changed_at: string | null;
}

export interface ConfigHistoryRow {
  id: number;
  key: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  actor_handle: string | null;
  created_at: string;
}

export interface ModerationQueueRow {
  id: string;
  object_type: string;
  object_id: string;
  priority: 'urgent' | 'normal';
  status: string;
  report_count: number;
  created_at: string;
  categories: string[] | null;
}

export interface ModerationCase {
  case: {
    id: string;
    object_type: string;
    object_id: string;
    subject_user_id: string | null;
    priority: string;
    status: string;
    report_count: number;
    outcome: string | null;
    outcome_reason: string | null;
    created_at: string;
    resolved_at: string | null;
  };
  object: Record<string, unknown> | null;
  reports: { category: string; details: string | null; created_at: string }[] | null;
  evidence: unknown[] | null;
  actions: { action: string; reason: string | null; at: string }[] | null;
}

export interface IntegrityQueueRow {
  id: string;
  kind: string;
  object_id: string;
  opened_by: string;
  status: string;
  hold: boolean;
  created_at: string;
  reasons: string[] | null;
  object_status: string | null;
}

export interface IntegrityDetail {
  case: {
    id: string;
    kind: string;
    object_id: string;
    subject_user_id: string | null;
    opened_by: string;
    status: string;
    resolution: string | null;
    hold_from_competition: boolean;
    notes: string | null;
    created_at: string;
    resolved_at: string | null;
  };
  claim: Record<string, unknown> | null;
  attempt: Record<string, unknown> | null;
  activity: { sample_count: number; usable_sample_count: number; gaps: unknown; device: unknown; distance_m: number; elapsed_ms: number } | null;
  appeal: { id: string; reason: string; status: string; created_at: string; response: string | null } | null;
}

export interface AppealRow {
  id: string;
  track: 'content' | 'competitive';
  object_type: string;
  object_id: string;
  reason: string;
  status: string;
  response: string | null;
  created_at: string;
  decided_at: string | null;
  user_id: string;
  user_handle: string | null;
  integrity_case_id: string | null;
}

export interface RouteProposalRow {
  id: string;
  name: string;
  creator_handle: string;
  length_m: number;
  closed: boolean;
  created_at: string;
  path_geojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  course_geometry: {
    start_gate?: { type: string; coordinates: [number, number][] };
    finish_gate?: { type: string; coordinates: [number, number][] };
    checkpoints?: unknown;
    corridor_m?: number;
  } | null;
  score_founding_run: boolean;
}

export interface StaffRow {
  user_id: string;
  handle: string;
  display_name: string;
  status: string;
  roles: string[];
  granted_at: string;
  mfa_enabled: boolean;
  last_sign_in_at: string | null;
}

export interface UserSearchRow {
  user_id: string;
  handle: string;
  display_name: string;
  status: string;
  city_label: string | null;
  created_at: string;
  roles: string[];
  matched_by: 'id' | 'email' | 'handle' | 'name';
}

export interface AuditRow {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_handle: string | null;
  actor_kind: string;
  action: string;
  object_type: string;
  object_id: string | null;
  details: Record<string, unknown>;
}

export interface DeadJobRow {
  id: number;
  queue: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}
