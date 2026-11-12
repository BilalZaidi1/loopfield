import 'server-only';

/**
 * Sample data for working on the console's UI without a database: `npm run dev:fixtures`.
 * Only active in `next dev` (never in a production build) and only with CONSOLE_FIXTURES=1.
 */
export const fixturesEnabled = process.env.CONSOLE_FIXTURES === '1' && process.env.NODE_ENV !== 'production';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const me = '0b8c6f1e-3d2a-4e5b-9c7d-1a2b3c4d5e6f';

const loop: [number, number][] = Array.from({ length: 41 }, (_, i) => {
  const t = (i / 40) * Math.PI * 2;
  return [67.0606 + 0.0062 * Math.cos(t) + 0.0015 * Math.cos(3 * t), 24.8138 + 0.0041 * Math.sin(t)];
});

const configRow = (key: string, value: unknown, label: string, category: string, value_type: string, extra: Record<string, unknown> = {}) => ({
  key, value, is_public: true, description: null, updated_at: ago(60 * 26), label, category, value_type,
  min_value: null, max_value: null, allowed: null, min_role: category === 'switch' ? 'territory_operator' : 'admin', sort: 0, help: null,
  can_edit: true, last_changed_by: null, last_reason: null, last_changed_at: null, ...extra
});

export function fixture(fn: string): unknown {
  switch (fn) {
    case 'ops_whoami':
      return { user_id: me, handle: 'bilal', display_name: 'Bilal Zaidi', status: 'active', roles: ['admin'], require_mfa: false };
    case 'ops_overview':
      return {
        generated_at: new Date().toISOString(),
        settings: { territory_capture_enabled: true, speed_titles_enabled: true, public_publication_enabled: true, photo_uploads_enabled: true, messaging_enabled: true, reclaim_enabled: false, disabled_health_cards: [], paywall_enabled: false, maintenance_mode: { enabled: false, message: null, until: null }, ops_require_mfa: false, min_supported_app_version: '0.1.0' },
        jobs: {
          territory: { queued: 2, running: 1, dead: 0, failed_24h: 0, oldest_ready_at: ago(1) },
          notifications: { queued: 14, running: 2, dead: 3, failed_24h: 5, oldest_ready_at: ago(12) },
          media: { queued: 0, running: 0, dead: 0, failed_24h: 0, oldest_ready_at: null },
          email: { queued: 1, running: 0, dead: 0, failed_24h: 0, oldest_ready_at: ago(0.5) }
        },
        queues: { moderation: { open: 4, urgent: 1, oldest: ago(95) }, integrity: { open: 2, held: 1, oldest: ago(60 * 7) }, appeals: { open: 2, oldest: ago(60 * 20) }, routes: { open: 1, oldest: ago(60 * 3) }, reports_24h: 6, exports: 1, deletions: 0 },
        activity_24h: { runs: 312, claims: 87, sign_ups: 19, posts: 41 },
        totals: { runners: 1284, suspended: 3, clubs: 22, staff: 3 },
        billing: { failed_events_7d: 0 },
        email: { bounced_7d: 2, failed_7d: 0 },
        seasons: [{ competition: 'Karachi', number: 3, status: 'active', starts_at: ago(60 * 24 * 12), ends_at: ahead(60 * 24 * 16) }],
        cron: [
          { job: 'loopfield-jobs', schedule: '* * * * *', active: true, last_status: 'succeeded', last_start: ago(0.4), last_end: ago(0.4) },
          { job: 'loopfield-maintenance', schedule: '* * * * *', active: true, last_status: 'succeeded', last_start: ago(0.6), last_end: ago(0.6) },
          { job: 'loopfield-purge', schedule: '17 3 * * *', active: true, last_status: 'succeeded', last_start: ago(60 * 9), last_end: ago(60 * 9) }
        ]
      };
    case 'ops_config':
      return [
        configRow('territory_capture_enabled', true, 'Land capture', 'switch', 'boolean', { help: 'Off stops new land claims. Private recording keeps working.' }),
        configRow('speed_titles_enabled', true, 'Speed titles', 'switch', 'boolean', { help: 'Off stops new speed titles from being awarded.' }),
        configRow('reclaim_enabled', false, 'Reclaim', 'switch', 'boolean', { help: 'Off stops spending movement points to reclaim land.', last_changed_by: 'bilal', last_reason: 'Pausing reclaim while we fix cell refunds', last_changed_at: ago(42) }),
        configRow('disabled_health_cards', [], 'Suspended health cards', 'switch', 'string_array', { help: 'Health dashboard cards hidden because of a known data-quality fault.' }),
        configRow('movement_points_per_km', 10, 'Movement points per km', 'tunable', 'integer', { min_value: 0, max_value: 100, help: 'Points earned for each verified kilometre.' }),
        configRow('achievement_tier_points', { bronze: 10, silver: 25, gold: 60, platinum: 150 }, 'Achievement points per tier', 'tunable', 'object', { allowed: ['bronze', 'silver', 'gold', 'platinum'] }),
        configRow('min_supported_app_version', '0.1.0', 'Minimum supported version', 'release', 'version', { help: 'Older builds are told to update before uploading runs.' }),
        configRow('maintenance_mode', { enabled: false, message: null, until: null }, 'Maintenance mode', 'release', 'object', { allowed: ['enabled', 'message', 'until'], help: 'Blocks the app behind a maintenance screen with your message (needs app support).' }),
        configRow('paywall_enabled', false, 'Paywall', 'monetization', 'boolean', { help: 'On gates the features listed below behind the premium entitlement.' }),
        configRow('premium_features', [], 'Premium features', 'monetization', 'string_array'),
        configRow('rules_status', 'proposed', 'Rules status', 'system', 'string', { allowed: ['proposed', 'validated'] })
      ];
    case 'ops_config_history':
      return [{ id: 3, key: 'reclaim_enabled', old_value: true, new_value: false, reason: 'Pausing reclaim while we fix cell refunds', actor_handle: 'bilal', created_at: ago(42) }];
    case 'ops_moderation_queue':
      return [
        { id: '9f1c2d3e-0000-4000-8000-000000000001', object_type: 'post', object_id: '5a1b2c3d-0000-4000-8000-000000000001', priority: 'urgent', status: 'open', report_count: 3, created_at: ago(95), categories: ['harassment'] },
        { id: '9f1c2d3e-0000-4000-8000-000000000002', object_type: 'profile', object_id: '5a1b2c3d-0000-4000-8000-000000000002', priority: 'normal', status: 'open', report_count: 1, created_at: ago(40), categories: ['impersonation'] }
      ];
    case 'ops_moderation_case':
      return {
        case: { id: '9f1c2d3e-0000-4000-8000-000000000001', object_type: 'post', object_id: '5a1b2c3d-0000-4000-8000-000000000001', subject_user_id: '7c7c7c7c-0000-4000-8000-000000000001', priority: 'urgent', status: 'open', report_count: 3, outcome: null, outcome_reason: null, created_at: ago(95), resolved_at: null },
        object: { body: 'Whoever keeps taking Clifton loops at 5am, we know where you start. Watch out.', audience: 'public', status: 'published', author: '7c7c7c7c-0000-4000-8000-000000000001', media: [] },
        reports: [{ category: 'harassment', details: 'Threatening a runner by location', created_at: ago(95) }, { category: 'violence', details: null, created_at: ago(80) }],
        evidence: null,
        actions: null
      };
    case 'ops_integrity_queue':
      return [{ id: '1e1e1e1e-0000-4000-8000-000000000001', kind: 'loop_claim', object_id: '2f2f2f2f-0000-4000-8000-000000000001', opened_by: 'system', status: 'open', hold: true, created_at: ago(60 * 7), reasons: ['speed_implausible', 'gps_gap'], object_status: 'pending_review' }];
    case 'ops_integrity_detail':
      return {
        case: { id: '1e1e1e1e-0000-4000-8000-000000000001', kind: 'loop_claim', object_id: '2f2f2f2f-0000-4000-8000-000000000001', subject_user_id: '7c7c7c7c-0000-4000-8000-000000000002', opened_by: 'system', status: 'in_review', resolution: null, hold_from_competition: true, notes: null, created_at: ago(60 * 7), resolved_at: null },
        claim: { status: 'pending_review', reasons: ['speed_implausible', 'gps_gap'], rule_version: 'territory-0.3', user_id: '7c7c7c7c-0000-4000-8000-000000000002', area_m2: 182400 },
        attempt: null,
        activity: { sample_count: 1840, usable_sample_count: 1702, gaps: [{ from_s: 812, to_s: 871 }], device: { platform: 'ios', model: 'iPhone15,3' }, distance_m: 6420, elapsed_ms: 1_860_000 },
        appeal: { id: 'a', reason: 'I ran this loop with friends, the gap is a tunnel under the flyover.', status: 'submitted', created_at: ago(60 * 5), response: null }
      };
    case 'ops_appeals_queue':
      return [
        { id: 'ab000000-0000-4000-8000-000000000001', track: 'content', object_type: 'post', object_id: 'x', reason: 'My post was about a route closure, not about any person.', status: 'submitted', response: null, created_at: ago(60 * 20), decided_at: null, user_id: 'u', user_handle: 'saba_runs', integrity_case_id: null },
        { id: 'ab000000-0000-4000-8000-000000000002', track: 'competitive', object_type: 'loop_claim', object_id: 'y', reason: 'I ran this loop with friends, the gap is a tunnel under the flyover.', status: 'submitted', response: null, created_at: ago(60 * 5), decided_at: null, user_id: 'u2', user_handle: 'hamza.k', integrity_case_id: '1e1e1e1e-0000-4000-8000-000000000001' }
      ];
    case 'ops_route_queue':
      return [{ id: 'cd000000-0000-4000-8000-000000000001', name: 'Sea View sunrise loop', creator_handle: 'saba_runs', length_m: 4120, closed: true, created_at: ago(60 * 3), path_geojson: { type: 'LineString', coordinates: loop }, course_geometry: { corridor_m: 25 }, score_founding_run: true }];
    case 'ops_staff_list':
      return [
        { user_id: me, handle: 'bilal', display_name: 'Bilal Zaidi', status: 'active', roles: ['admin'], granted_at: ago(60 * 24 * 3), mfa_enabled: true, last_sign_in_at: ago(5) },
        { user_id: 'b1', handle: 'ayesha', display_name: 'Ayesha Khan', status: 'active', roles: ['moderator', 'support'], granted_at: ago(60 * 24), mfa_enabled: false, last_sign_in_at: ago(60 * 30) }
      ];
    case 'ops_users_search':
      return [{ user_id: 'c1', handle: 'saba_runs', display_name: 'Saba', status: 'active', city_label: 'Karachi', created_at: ago(60 * 24 * 40), roles: [], matched_by: 'handle' }];
    case 'ops_audit_log':
      return [
        { id: 120, created_at: ago(42), actor_id: me, actor_handle: 'bilal', actor_kind: 'staff', action: 'config_changed', object_type: 'app_config', object_id: 'reclaim_enabled', details: { old: true, new: false, reason: 'Pausing reclaim while we fix cell refunds' } },
        { id: 119, created_at: ago(180), actor_id: me, actor_handle: 'bilal', actor_kind: 'staff', action: 'role_granted', object_type: 'profile', object_id: 'b1', details: { role: 'moderator' } },
        { id: 118, created_at: ago(300), actor_id: null, actor_handle: null, actor_kind: 'system', action: 'season_started', object_type: 'season', object_id: 's3', details: {} }
      ];
    case 'ops_dead_jobs':
      return [{ id: 5531, queue: 'notifications', kind: 'push_pending', attempts: 8, last_error: 'expo push http 503', updated_at: ago(25) }];
    default:
      return null;
  }
}
