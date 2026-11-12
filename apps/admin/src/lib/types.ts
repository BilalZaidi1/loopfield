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
export type ConfigCategory = 'switch' | 'tunable' | 'sharing' | 'season' | 'limits' | 'release' | 'monetization' | 'system' | 'other';

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

// ---------------------------------------------------------------------------------------------
// RBAC (ops_rbac)
// ---------------------------------------------------------------------------------------------
export interface PermissionDef {
  key: string;
  area: string;
  label: string;
  help: string;
}
export interface RoleDef {
  key: string;
  label: string;
  description: string;
  is_system: boolean;
  updated_at: string;
  permissions: string[];
  members: number;
}
export interface Rbac {
  permissions: PermissionDef[];
  roles: RoleDef[];
  can_edit: boolean;
  can_grant: boolean;
  my_permissions: string[];
}

// ---------------------------------------------------------------------------------------------
// Game rules (ops_rules)
// ---------------------------------------------------------------------------------------------
export type RuleFamily = 'territory' | 'speed';
export interface RuleDef {
  family: RuleFamily;
  key: string;
  label: string;
  help: string;
  unit: 'm' | 'm2' | 's' | 'm/s' | 'share' | 'ratio' | 'count';
  default: number;
  min: number;
  max: number;
  step: number;
  group: string;
}
export interface RuleVersion {
  version: string;
  family: RuleFamily;
  overrides: Record<string, number>;
  values: Record<string, number>;
  note: string;
  is_builtin: boolean;
  created_at: string;
  created_by: string | null;
  seasons: number;
}
export interface RunningSeason {
  season_id: string;
  number: number;
  status: string;
  starts_at: string;
  ends_at: string;
  competition: string;
  kind: string;
  territory_rules_version: string;
  speed_rules_version: string;
}
export interface RulesPayload {
  catalog: RuleDef[];
  versions: RuleVersion[];
  next: Record<RuleFamily, string>;
  next_explicit: Partial<Record<RuleFamily, string>>;
  running: RunningSeason[];
  rate_limits: { action: string; label: string; default: number; window_seconds: number }[];
  can_edit: boolean;
  can_apply: boolean;
}

// ---------------------------------------------------------------------------------------------
// Runners (ops_users_list, ops_user_overview)
// ---------------------------------------------------------------------------------------------
export interface RunnerRow {
  id: string;
  handle: string;
  display_name: string;
  status: 'active' | 'suspended' | 'deleted';
  created_at: string;
  onboarding_completed_at: string | null;
  avatar_kind: string | null;
  city_label: string | null;
  runs: number;
  distance_m: number;
  last_run_at: string | null;
  loops: number;
  roles: string[];
}
export interface RunnerList {
  total: number;
  counts: { active: number; suspended: number; all: number };
  items: RunnerRow[];
}
export interface RunnerOverview {
  profile: {
    id: string; handle: string; display_name: string; bio: string | null; status: RunnerRow['status']; visibility: string; discoverable: boolean;
    city_label: string | null; avatar_kind: string | null; district: string | null; created_at: string; updated_at: string; onboarding_completed_at: string | null;
  };
  account: { email_confirmed?: boolean; last_sign_in_at?: string | null; banned_until?: string | null; is_anonymous?: boolean };
  stats: {
    runs: number; runs_30d: number; distance_m: number; distance_30d_m: number; moving_ms: number; first_run_at: string | null; last_run_at: string | null;
    flagged_runs: number; loops_eligible: number; loops_rejected: number; land_cells: number; movement_points: number; followers: number; following: number;
    clubs: number; posts: number; reports_against: number; reports_filed: number;
  };
  recent_activities: { id: string; started_at: string; distance_m: number | null; moving_ms: number | null; status: string; integrity_flags: string[] | null; title: string | null; claim_status: string | null; claim_cells: number | null }[];
  moderation_cases: { id: string; object_type: string; status: string; priority: string; outcome: string | null; report_count: number; created_at: string; resolved_at: string | null }[];
  integrity_cases: { id: string; kind: string; status: string; resolution: string | null; hold_from_competition: boolean; created_at: string; resolved_at: string | null }[];
  support_tickets: { id: string; subject: string; category: string; status: string; priority: string; created_at: string; last_message_at: string }[];
  entitlements: { entitlement: string; status: string; is_active: boolean; store: string | null; expires_at: string | null; source: string | null }[];
  devices: { platform: string; last_seen_at: string | null; disabled: boolean }[];
  consents: { kind: string; granted: boolean; version: string; created_at: string }[];
  lifecycle: { exports: { status: string; created_at: string; completed_at: string | null }[]; deletion: { status: string; requested_at: string; completed_at: string | null } | null };
  roles: { role: string; label: string; granted_at: string }[];
  staff_actions: { id: number | string; action: string; object_type: string; created_at: string; reason: string | null; actor: string | null }[];
  can_manage: boolean;
  is_self: boolean;
}

// ---------------------------------------------------------------------------------------------
// Support (ops_support_queue, ops_support_ticket)
// ---------------------------------------------------------------------------------------------
export type SupportStatus = 'open' | 'pending' | 'solved' | 'closed';
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface SupportItem {
  id: string;
  subject: string;
  category: string;
  status: SupportStatus;
  priority: SupportPriority;
  staff_unread: boolean;
  created_at: string;
  last_message_at: string;
  last_runner_message_at: string;
  first_response_at: string | null;
  platform: string | null;
  app_version: string | null;
  runner: { id: string; handle: string; display_name: string; status: string };
  assignee: { id: string; handle: string; display_name: string } | null;
  last_message: { body: string; from: 'runner' | 'staff' | 'system'; internal: boolean; at: string } | null;
  messages: number;
}
export interface SupportQueue {
  counts: { open: number; mine: number; unassigned: number; pending: number; solved: number; all: number; urgent: number; oldest_open: string | null };
  items: SupportItem[];
}
export interface SupportTicketDetail {
  ticket: {
    id: string; user_id: string; category: string; subject: string; status: SupportStatus; priority: SupportPriority; assigned_to: string | null;
    app_version: string | null; platform: string | null; device: string | null; context: Record<string, unknown>; created_at: string; last_message_at: string;
    first_response_at: string | null; solved_at: string | null;
  };
  runner: { id: string; handle: string; display_name: string; status: string; joined_at: string; avatar_kind: string | null; runs: number; last_run_at: string | null; tickets: number } | null;
  assignee: { id: string; handle: string; display_name: string } | null;
  messages: { id: string; from: 'runner' | 'staff' | 'system'; body: string; internal: boolean; at: string; author: string | null }[];
  other_tickets: { id: string; subject: string; status: SupportStatus; created_at: string }[];
  agents: { id: string; handle: string; display_name: string }[];
  me: string;
}

// ---------------------------------------------------------------------------------------------
// Analytics (ops_metrics, ops_analytics_*)
// ---------------------------------------------------------------------------------------------
export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  agg: 'sum' | 'distinct' | 'median';
  group: string;
}
export interface Metrics {
  time_zone: string;
  from: string;
  to: string;
  previous_from: string;
  previous_to: string;
  refreshed_at: string;
  catalog: MetricDef[];
  days: string[];
  series: Record<string, number[]>;
  totals: Record<string, number | null>;
  previous: Record<string, number | null>;
}
export interface KeyValueCount {
  key: string;
  value: number;
}
export interface Breakdowns {
  loop_outcomes: KeyValueCount[];
  rejection_reasons: KeyValueCount[];
  distance_buckets: KeyValueCount[];
  hour_of_day: number[];
  weekday: number[];
  top_districts: KeyValueCount[];
  platforms: KeyValueCount[];
  support_categories: KeyValueCount[];
  report_categories: KeyValueCount[];
}
export interface RetentionCohort {
  week: string;
  size: number;
  weeks: (number | null)[];
}

// ---------------------------------------------------------------------------------------------
// SQL editor (ops_sql_*)
// ---------------------------------------------------------------------------------------------
export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  error?: string | null;
  sqlstate?: string | null;
  hint?: string | null;
  ms: number;
  limit: number;
}
export interface SqlView {
  name: string;
  comment: string | null;
  columns: { name: string; type: string }[];
}
export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  shared: boolean;
  mine: boolean;
  owner: string | null;
  updated_at: string;
}
export interface SqlSaved {
  queries: SavedQuery[];
  history: { sql: string; rows: number | null; ms: number | null; error: string | null; at: string }[];
}
