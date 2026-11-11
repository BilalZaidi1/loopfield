/**
 * Explicit product-analytics schema (PRD §13). Only events and properties listed here can be sent.
 * Raw GPS, precise timestamps of physical runs, health readings, message/post text, photos,
 * authentication details and free text are structurally impossible to include: unknown keys are
 * dropped and every value must pass its validator.
 */

type Validator = (v: unknown) => boolean;

const oneOf = (...values: string[]): Validator => (v) => typeof v === 'string' && values.includes(v);
const bool: Validator = (v) => typeof v === 'boolean';
const smallInt: Validator = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000;
const idLike: Validator = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v);
const version: Validator = (v) => typeof v === 'string' && /^[a-z0-9.\-]{1,48}$/i.test(v);

export const DURATION_BUCKETS = ['<10m', '10-30m', '30-60m', '60-120m', '>120m'] as const;
export const AREA_BUCKETS = ['0', '<0.05km2', '0.05-0.25km2', '0.25-1km2', '1-5km2', '>5km2'] as const;
export const DISTANCE_BUCKETS = ['<1km', '1-5km', '5-10km', '10-21km', '>21km'] as const;
export const BYTES_BUCKETS = ['<100KB', '100KB-1MB', '1-5MB', '>5MB'] as const;

export function durationBucket(ms: number): (typeof DURATION_BUCKETS)[number] {
  const m = ms / 60_000;
  return m < 10 ? '<10m' : m < 30 ? '10-30m' : m < 60 ? '30-60m' : m < 120 ? '60-120m' : '>120m';
}
export function areaBucket(m2: number): (typeof AREA_BUCKETS)[number] {
  const km2 = m2 / 1e6;
  return km2 <= 0 ? '0' : km2 < 0.05 ? '<0.05km2' : km2 < 0.25 ? '0.05-0.25km2' : km2 < 1 ? '0.25-1km2' : km2 < 5 ? '1-5km2' : '>5km2';
}
export function distanceBucket(m: number): (typeof DISTANCE_BUCKETS)[number] {
  const km = m / 1000;
  return km < 1 ? '<1km' : km < 5 ? '1-5km' : km < 10 ? '5-10km' : km < 21.1 ? '10-21km' : '>21km';
}
export function bytesBucket(b: number): (typeof BYTES_BUCKETS)[number] {
  return b < 100_000 ? '<100KB' : b < 1_000_000 ? '100KB-1MB' : b < 5_000_000 ? '1-5MB' : '>5MB';
}

const decision = oneOf('eligible', 'pending_review', 'unranked', 'invalid');
const mode = oneOf('private', 'territory', 'speed', 'territory_speed');
const competitionKind = oneOf('public', 'club');
const platform = oneOf('ios', 'android');

export const EVENT_SCHEMA = {
  onboarding_completed: { mode: oneOf('explore', 'compete', 'social'), app_version: version },
  signup_completed: { method: oneOf('email', 'apple', 'google') },
  permission_outcome: {
    category: oneOf('location_foreground', 'location_background', 'notifications', 'health_read', 'health_write', 'motion'),
    outcome: oneOf('granted', 'denied', 'limited', 'unknown', 'not_requested'),
    os_family: platform
  },
  run_started: { activity_id: idLike, mode, competition_kind: competitionKind, device_class: oneOf('ios', 'android_high', 'android_mid', 'android_low', 'unknown') },
  run_saved: { activity_id: idLike, mode, duration_bucket: oneOf(...DURATION_BUCKETS), distance_bucket: oneOf(...DISTANCE_BUCKETS), had_gap: bool },
  run_recovered: { activity_id: idLike, outcome: oneOf('resumed', 'finished', 'discarded') },
  upload_completed: { activity_id: idLike, size_bucket: oneOf(...BYTES_BUCKETS), retry_count: smallInt, elapsed_bucket: oneOf('<5s', '5-30s', '30-300s', '>300s') },
  loop_evaluated: { claim_id: idLike, rule_version: version, area_bucket: oneOf(...AREA_BUCKETS), decision, reason: version },
  speed_evaluated: { route_id: idLike, rule_version: version, decision, reason: version, quality_bucket: oneOf('good', 'marginal', 'poor') },
  territory_changed: { competition_id: idLike, area_bucket: oneOf(...AREA_BUCKETS), change: oneOf('gained', 'lost', 'corrected'), provisional: bool },
  route_title_changed: { route_id: idLike, competition_kind: competitionKind, result: oneOf('won', 'lost', 'improved', 'corrected'), provisional: bool },
  claim_explained: { result_type: oneOf('land', 'title', 'both', 'none'), viewed: bool },
  next_run_completed: { cohort_week: version, elapsed_days: smallInt },
  route_proposed: { outcome: oneOf('submitted', 'duplicate_linked', 'withdrawn') },
  appeal_submitted: { object_type: oneOf('loop_claim', 'speed_attempt', 'post', 'comment', 'account_action', 'route_proposal', 'activity') },
  appeal_resolved: { reason_category: version, resolution: oneOf('upheld', 'overturned', 'withdrawn'), handling_bucket: oneOf('<1d', '1-2d', '2-7d', '>7d') },
  social_action: {
    action: oneOf('post_created', 'post_deleted', 'comment_created', 'reaction_added', 'reaction_removed', 'follow_requested', 'follow_approved', 'unfollowed', 'muted', 'blocked', 'reported', 'mention_sent'),
    audience_class: oneOf('only_me', 'followers', 'public', 'club', 'none'),
    outcome: oneOf('ok', 'failed', 'blocked_by_policy')
  },
  message_action: { action: oneOf('conversation_started', 'message_sent', 'message_deleted', 'conversation_muted', 'reported'), outcome: oneOf('ok', 'failed', 'not_allowed') },
  event_action: {
    action: oneOf('joined', 'left', 'created', 'cancelled', 'standings_viewed', 'shown_on_map'),
    event_type: oneOf('territory', 'distance'),
    team_mode: oneOf('individual', 'club'),
    host: oneOf('operator', 'club')
  },
  club_action: { action: oneOf('joined', 'left', 'requested', 'invite_accepted', 'invite_declined', 'created', 'member_removed', 'announcement_pinned'), club_kind: oneOf('club', 'community'), visibility: oneOf('public', 'private') },
  feed_viewed: { feed: oneOf('following', 'discover', 'club'), page: smallInt },
  health_viewed: { screen: oneOf('dashboard', 'metric_detail', 'zones', 'connections', 'goals'), session_count: smallInt },
  health_sync_status: { connector: oneOf('healthkit', 'health_connect'), result: oneOf('ok', 'partial', 'no_data', 'unavailable', 'error'), failure_category: oneOf('none', 'permission', 'platform_unavailable', 'timeout', 'unknown') },
  notification_opened: { category: oneOf('social', 'message', 'club', 'competitive', 'system') },
  moderation_resolved: { case_category: version, outcome: oneOf('removed', 'restored', 'no_action', 'suspended'), handling_bucket: oneOf('<1h', '1-24h', '1-3d', '>3d') },
  paywall_viewed: { source: oneOf('settings', 'progress', 'other'), paywall_enabled: bool },
  purchase_started: { package_type: oneOf('monthly', 'annual', 'other') },
  subscription_changed: { plan: oneOf('monthly', 'annual', 'other', 'none'), store: oneOf('app_store', 'play_store', 'other'), entitlement_state: oneOf('active', 'grace', 'billing_issue', 'cancelled_active', 'expired', 'refunded') },
  restore_completed: { outcome: oneOf('restored', 'nothing_to_restore', 'failed') },
  data_export_requested: {},
  account_deletion_requested: {}
} as const satisfies Record<string, Record<string, Validator>>;

export type AnalyticsEventName = keyof typeof EVENT_SCHEMA;
export type AnalyticsProps<E extends AnalyticsEventName> = { [K in keyof (typeof EVENT_SCHEMA)[E]]?: string | number | boolean };

/** Key tokens that must never be sent even if a schema were edited carelessly. */
const FORBIDDEN_TOKENS = new Set([
  'lat', 'lng', 'lon', 'latitude', 'longitude', 'coord', 'coords', 'coordinates', 'geo', 'gps', 'location', 'position',
  'trace', 'polygon', 'sample', 'samples', 'heart', 'hr', 'hrv', 'sleep', 'vo2', 'calories', 'energy', 'steps', 'weight',
  'email', 'phone', 'password', 'token', 'secret', 'message', 'body', 'text', 'content', 'comment', 'caption', 'name',
  'address', 'ip', 'timestamp'
]);

export function isForbiddenKey(key: string): boolean {
  return key
    .toLowerCase()
    .split(/[_\-.]/)
    .some((t) => FORBIDDEN_TOKENS.has(t));
}

export interface SanitizedEvent {
  event: AnalyticsEventName;
  properties: Record<string, string | number | boolean>;
  dropped: string[];
}

export function sanitizeEvent<E extends AnalyticsEventName>(event: E, props: AnalyticsProps<E> | Record<string, unknown> = {}): SanitizedEvent {
  const schema = EVENT_SCHEMA[event] as Record<string, Validator> | undefined;
  if (!schema) throw new Error(`Unknown analytics event: ${String(event)}`);
  const properties: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const validator = schema[key];
    if (!validator || isForbiddenKey(key) || !validator(value)) {
      dropped.push(key);
      continue;
    }
    properties[key] = value as string | number | boolean;
  }
  return { event, properties, dropped };
}

/** Person properties allowed on the analytics identity. Nothing identifying beyond the internal id. */
export const ALLOWED_PERSON_PROPERTIES = ['app_version', 'platform', 'units', 'competition_enabled', 'health_connected', 'cohort_week'] as const;
