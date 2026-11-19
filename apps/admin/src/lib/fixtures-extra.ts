import 'server-only';

/** Sample data for the newer screens (rules, runners, support, analytics, SQL, roles). Dev fixture mode only. */

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const wave = (n: number, base: number, amp: number, seed: number) =>
  Array.from({ length: n }, (_, i) => Math.max(0, Math.round(base + amp * Math.sin((i + seed) / 2.3) + ((i * 37 + seed * 11) % 7) - 3 + i * (base / 60))));

const PERMS: [string, string, string, string][] = [
  ['moderation', 'Trust & safety', 'Moderation', 'Moderation queue and decisions, content and account appeals, clubs.'],
  ['integrity', 'Trust & safety', 'Integrity cases', 'Holds, upholds, overturns and competitive appeals.'],
  ['routes', 'Trust & safety', 'Route proposals', 'Approve or reject proposed speed routes.'],
  ['territory', 'Game', 'Kill switches and seasons', 'Flip kill switches; seasons, regions, exclusions and events.'],
  ['rules.edit', 'Game', 'Edit game rules', 'Save new rule versions. They start with the next season.'],
  ['rules.apply', 'Game', 'Apply rules to running seasons', 'Move running seasons to a rule version straight away.'],
  ['users.view', 'Runners & support', 'View runners', 'Runner directory and profiles. Email lookups are audited.'],
  ['users.manage', 'Runners & support', 'Suspend and sign out runners', 'Suspend, reinstate, sign out everywhere and reset profile fields.'],
  ['support', 'Runners & support', 'Support inbox', 'Read, assign and answer messages from runners.'],
  ['analytics', 'Insights', 'Analytics', 'Analytics screen and metric widgets on the Overview.'],
  ['sql', 'Insights', 'SQL editor', 'Read-only queries over the curated data views. Every query is audited.'],
  ['config', 'Platform', 'App settings', 'Game tunables, sharing, limits, releases and maintenance.'],
  ['monetization', 'Platform', 'Monetization', 'Paywall and premium features.'],
  ['jobs', 'Platform', 'Jobs', 'Retry failed background jobs.'],
  ['audit', 'Platform', 'Audit log', 'Read the audit log.'],
  ['staff', 'Platform', 'Staff', 'Grant and revoke roles, never beyond your own permissions.']
];
const ALL = PERMS.map((p) => p[0]);

const RULES: [string, string, string, string, string, number, number, number, number, string][] = [
  ['territory', 'minLoopLengthMeters', 'Minimum loop length', 'Shortest run that can claim land.', 'm', 1000, 200, 10000, 50, 'Loop'],
  ['territory', 'maxLoopLengthMeters', 'Maximum loop length', 'Longer loops are not counted.', 'm', 30000, 2000, 60000, 500, 'Loop'],
  ['territory', 'closureMaxGapMeters', 'Closing distance', 'How close the finish must be to the start.', 'm', 20, 5, 100, 1, 'Loop'],
  ['territory', 'closureEndpointMaxAccuracyMeters', 'GPS accuracy where the loop closes', 'Worst GPS accuracy allowed at the start and the finish.', 'm', 15, 5, 50, 1, 'Loop'],
  ['territory', 'maxCandidateAreaSquareMeters', 'Largest area per loop', 'Most land one loop can enclose. 25 km² is the processing limit.', 'm2', 25000000, 100000, 25000000, 100000, 'Loop'],
  ['territory', 'minCompactness', 'Shape check', 'Rejects out-and-back "loops" with almost nothing inside. 0 turns the check off.', 'ratio', 0.03, 0, 0.5, 0.01, 'Loop'],
  ['territory', 'minEligibleCells', 'Minimum land cells', 'Fewest cells a loop must capture after exclusion zones.', 'count', 1, 1, 100, 1, 'Loop'],
  ['territory', 'maxSampleGapSeconds', 'Longest GPS gap', 'Longest gap between GPS points before the run is broken.', 's', 10, 3, 60, 1, 'GPS quality'],
  ['territory', 'maxUsableAccuracyMeters', 'Worst usable accuracy', 'GPS points less accurate than this are ignored.', 'm', 25, 5, 100, 1, 'GPS quality'],
  ['territory', 'minUsableFixShare', 'Usable points needed', 'Share of GPS points that must be usable.', 'share', 0.9, 0.5, 1, 0.01, 'GPS quality'],
  ['territory', 'minSamples', 'Minimum GPS points', 'Fewest usable GPS points in a run.', 'count', 30, 10, 1000, 1, 'GPS quality'],
  ['territory', 'suspiciousSustainedSpeedMetersPerSecond', 'Vehicle speed', 'Sustained speed treated as a vehicle.', 'm/s', 6.5, 3, 15, 0.1, 'Vehicle checks'],
  ['territory', 'suspiciousSustainedSeconds', 'Vehicle duration', 'How long that speed has to last.', 's', 60, 10, 600, 5, 'Vehicle checks'],
  ['territory', 'maxJumpSpeedMetersPerSecond', 'Jump limit', 'Faster jumps between GPS points count as GPS errors.', 'm/s', 12, 5, 50, 0.5, 'Vehicle checks'],
  ['speed', 'minCourseLengthMeters', 'Shortest route', 'Shortest speed route that can be proposed.', 'm', 1000, 200, 10000, 50, 'Routes'],
  ['speed', 'maxCourseLengthMeters', 'Longest route', 'Longest speed route that can be proposed.', 'm', 5000, 1000, 42195, 100, 'Routes'],
  ['speed', 'corridorMeters', 'Corridor width', 'How far an attempt may stray from the route.', 'm', 20, 5, 50, 1, 'Routes'],
  ['speed', 'minCoverage', 'Route coverage', 'Share of the route an attempt must cover.', 'share', 0.95, 0.5, 1, 0.01, 'Routes'],
  ['speed', 'duplicateRouteMaxHausdorffMeters', 'Duplicate threshold', 'Proposals closer than this to an existing route are duplicates.', 'm', 30, 5, 200, 1, 'Routes'],
  ['speed', 'maxAttemptUncertaintySeconds', 'Timing uncertainty', 'Attempts with less certain timing are not ranked.', 's', 3, 0.5, 30, 0.5, 'Timing'],
  ['speed', 'marginMinSeconds', 'Winning margin', 'A new champion must be faster by at least this many seconds…', 's', 5, 0, 60, 1, 'Timing'],
  ['speed', 'marginFraction', 'Winning margin (share)', '…or by this share of the champion’s time, whichever is larger.', 'share', 0.01, 0, 0.1, 0.005, 'Timing']
];
const catalog = RULES.map(([family, key, label, help, unit, def, min, max, step, group]) => ({ family, key, label, help, unit, default: def, min, max, step, group }));
const values = (family: string, o: Record<string, number> = {}) => Object.fromEntries(catalog.filter((c) => c.family === family).map((c) => [c.key, o[c.key] ?? c.default]));

const runners = [
  ['c1', 'saba_runs', 'Saba Qureshi', 'active', 142, 618_400, 20, 'Karachi'],
  ['c2', 'trailhawk', 'Hamza Ali', 'active', 88, 402_100, 2, 'Karachi'],
  ['c3', 'ayesha.k', 'Ayesha Khan', 'active', 61, 259_900, 30, 'Lahore'],
  ['c4', 'zain_z', 'Zain Zaidi', 'suspended', 17, 71_200, 60 * 24 * 9, 'Karachi'],
  ['c5', 'mahnoor', 'Mahnoor Iqbal', 'active', 203, 1_204_000, 5, 'Islamabad'],
  ['c6', 'run_with_raza', 'Raza Shah', 'active', 9, 31_800, 60 * 24 * 2, 'Karachi'],
  ['c7', 'fatima.runs', 'Fatima Noor', 'active', 0, 0, null, null]
] as const;

export function extraFixture(fn: string): unknown {
  switch (fn) {
    case 'ops_rbac':
      return {
        permissions: PERMS.map(([key, area, label, help]) => ({ key, area, label, help })),
        roles: [
          { key: 'admin', label: 'Admin', description: 'Everything. Only admins change roles or grant admin.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ALL, members: 1 },
          { key: 'territory_operator', label: 'Territory operator', description: 'Kill switches, seasons, regions, exclusions and events.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['territory'], members: 0 },
          { key: 'moderator', label: 'Moderator', description: 'Reports, content and account decisions, content appeals and clubs.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['moderation', 'users.view'], members: 1 },
          { key: 'integrity_reviewer', label: 'Integrity reviewer', description: 'Holds, invalidations and competitive appeals.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['integrity', 'users.view'], members: 0 },
          { key: 'route_reviewer', label: 'Route reviewer', description: 'Route proposals and course status.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['routes'], members: 0 },
          { key: 'support', label: 'Support', description: 'Runner lookup and the support inbox.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['users.view', 'support'], members: 1 },
          { key: 'analyst', label: 'Analyst', description: 'Analytics and the read-only SQL editor.', is_system: true, updated_at: ago(60 * 24 * 8), permissions: ['analytics', 'sql'], members: 0 },
          { key: 'night_shift', label: 'Night shift', description: 'Moderation and support overnight.', is_system: false, updated_at: ago(60 * 5), permissions: ['moderation', 'support', 'users.view'], members: 2 }
        ],
        can_edit: true,
        can_grant: true,
        my_permissions: ALL
      };
    case 'ops_rules':
      return {
        catalog,
        versions: [
          { version: 'territory-2026.11.0-proposed+ops.1', family: 'territory', overrides: { minLoopLengthMeters: 800 }, values: values('territory', { minLoopLengthMeters: 800 }), note: 'Shorter loops for the Clifton pilot', is_builtin: false, created_at: ago(60 * 26), created_by: 'bilal', seasons: 1 },
          { version: 'territory-2026.11.0-proposed', family: 'territory', overrides: {}, values: values('territory'), note: 'Built-in defaults', is_builtin: true, created_at: ago(60 * 24 * 9), created_by: null, seasons: 2 },
          { version: 'speed-2026.11.0-proposed', family: 'speed', overrides: {}, values: values('speed'), note: 'Built-in defaults', is_builtin: true, created_at: ago(60 * 24 * 9), created_by: null, seasons: 2 }
        ],
        next: { territory: 'territory-2026.11.0-proposed+ops.1', speed: 'speed-2026.11.0-proposed' },
        next_explicit: { territory: 'territory-2026.11.0-proposed+ops.1' },
        running: [
          { season_id: 's3', number: 3, status: 'active', starts_at: ago(60 * 24 * 12), ends_at: ahead(60 * 24 * 16), competition: 'Karachi season race', kind: 'public', territory_rules_version: 'territory-2026.11.0-proposed', speed_rules_version: 'speed-2026.11.0-proposed' },
          { season_id: 'p1', number: 1, status: 'active', starts_at: '2020-01-01T00:00:00Z', ends_at: '9999-12-31T00:00:00Z', competition: 'All-time map', kind: 'permanent', territory_rules_version: 'territory-2026.11.0-proposed', speed_rules_version: 'speed-2026.11.0-proposed' }
        ],
        rate_limits: [
          ['post', 'Posts', 10, 3600], ['comment', 'Comments', 60, 3600], ['follow', 'Follow requests', 60, 3600], ['report', 'Reports', 20, 86400],
          ['route_proposal', 'Route proposals', 5, 86400], ['support_ticket', 'Support conversations', 12, 3600], ['support_message', 'Support replies', 60, 3600],
          ['club_create', 'New clubs', 3, 86400], ['create_event', 'New events', 10, 86400], ['join_event', 'Event joins', 30, 3600], ['club_invite', 'Club invites', 100, 86400],
          ['club_email_invite', 'Club email invites', 50, 86400], ['activity_link', 'Share links', 20, 86400], ['reclaim', 'Reclaims', 30, 3600], ['export', 'Data exports', 3, 86400]
        ].map(([action, label, d, w]) => ({ action, label, default: d, window_seconds: w })),
        can_edit: true,
        can_apply: true
      };
    case 'ops_users_list':
      return {
        total: runners.length,
        counts: { active: 6, suspended: 1, all: 7 },
        items: runners.map(([id, handle, display_name, status, runs, distance_m, last, city], i) => ({
          id, handle, display_name, status, created_at: ago(60 * 24 * (40 - i * 5)), onboarding_completed_at: runs ? ago(60 * 24 * (40 - i * 5)) : null, avatar_kind: 'style',
          city_label: city, runs, distance_m, last_run_at: last == null ? null : ago(last), loops: Math.round(runs / 3), roles: handle === 'ayesha.k' ? ['moderator', 'support'] : []
        }))
      };
    case 'ops_user_overview':
      return {
        profile: { id: 'c2', handle: 'trailhawk', display_name: 'Hamza Ali', bio: 'Clifton mornings. Chasing the Sea View loop.', status: 'active', visibility: 'public', discoverable: true, city_label: 'Karachi', avatar_kind: 'style', district: 'Clifton', created_at: ago(60 * 24 * 35), updated_at: ago(60 * 24 * 2), onboarding_completed_at: ago(60 * 24 * 35) },
        account: { email_confirmed: true, last_sign_in_at: ago(60 * 3), banned_until: null, is_anonymous: false },
        stats: { runs: 88, runs_30d: 21, distance_m: 402_100, distance_30d_m: 96_300, moving_ms: 141_000_000, first_run_at: ago(60 * 24 * 34), last_run_at: ago(2), flagged_runs: 1, loops_eligible: 29, loops_rejected: 6, land_cells: 1840, movement_points: 3120, followers: 48, following: 51, clubs: 2, posts: 14, reports_against: 1, reports_filed: 0 },
        recent_activities: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, started_at: ago(60 * 20 * i + 2), distance_m: [5210, 8030, 3120, 10450, 4980, 6120][i], moving_ms: [1_620_000, 2_700_000, 1_080_000, 3_420_000, 1_560_000, 2_040_000][i], status: 'processed', integrity_flags: i === 3 ? ['suspicious_speed'] : [], title: i === 0 ? 'Sea View sunrise' : null, claim_status: ['eligible', 'eligible', 'unranked', 'pending_review', 'eligible', null][i], claim_cells: [64, 112, 0, null, 58, null][i] })),
        moderation_cases: [{ id: 'm1', object_type: 'post', status: 'resolved', priority: 'normal', outcome: 'dismissed', report_count: 1, created_at: ago(60 * 24 * 6), resolved_at: ago(60 * 24 * 5) }],
        integrity_cases: [{ id: 'i1', kind: 'loop_claim', status: 'open', resolution: null, hold_from_competition: true, created_at: ago(60 * 20), resolved_at: null }],
        support_tickets: [{ id: 't2', subject: 'Loop not counted near the flyover', category: 'competition', status: 'open', priority: 'normal', created_at: ago(60 * 5), last_message_at: ago(42) }],
        entitlements: [],
        devices: [{ platform: 'ios', last_seen_at: ago(60 * 3), disabled: false }],
        consents: [{ kind: 'territory_competition', granted: true, version: '2026-11', created_at: ago(60 * 24 * 35) }, { kind: 'marketing', granted: false, version: '2026-11', created_at: ago(60 * 24 * 35) }],
        lifecycle: { exports: [], deletion: null },
        roles: [],
        staff_actions: [{ id: 301, action: 'user_signed_out', object_type: 'profile', created_at: ago(60 * 24), reason: 'Reported a lost phone', actor: 'ayesha.k' }],
        can_manage: true,
        is_self: false
      };
    case 'ops_support_queue':
      return {
        counts: { open: 4, mine: 2, unassigned: 2, pending: 3, solved: 18, all: 25, urgent: 1, oldest_open: ago(60 * 7) },
        items: [
          ['t1', 'App closes when I open the map', 'bug', 'open', 'high', true, 'saba_runs', 'Saba Qureshi', null, 'It closes as soon as the map loads, since the last update.', 'runner', 60 * 7, 'ios', '1.4.0'],
          ['t2', 'Loop not counted near the flyover', 'competition', 'open', 'normal', true, 'trailhawk', 'Hamza Ali', null, 'The tunnel under the flyover has no GPS, is that why?', 'runner', 42, 'ios', '1.4.0'],
          ['t3', 'Please add a dark map style', 'feedback', 'open', 'low', false, 'mahnoor', 'Mahnoor Iqbal', 'bilal', 'Thanks! Adding it to the list. Which screens matter most?', 'staff', 95, 'android', '1.3.2'],
          ['t4', 'Change my handle', 'account', 'pending', 'normal', false, 'run_with_raza', 'Raza Shah', 'ayesha.k', 'You can change it once a month from Edit profile.', 'staff', 60 * 26, 'android', '1.4.0'],
          ['t5', 'Someone keeps following me', 'safety', 'open', 'urgent', true, 'fatima.runs', 'Fatima Noor', 'bilal', 'They comment on every run and know where I start.', 'runner', 18, 'ios', '1.4.0']
        ].map(([id, subject, category, status, priority, unread, handle, name, assignee, body, from, min, platform, app]) => ({
          id, subject, category, status, priority, staff_unread: unread, created_at: ago(Number(min) + 30), last_message_at: ago(Number(min)), last_runner_message_at: ago(Number(min)),
          first_response_at: from === 'staff' ? ago(Number(min)) : null, platform, app_version: app, runner: { id: `r-${handle}`, handle, display_name: name, status: 'active' },
          assignee: assignee ? { id: `s-${assignee}`, handle: assignee, display_name: assignee } : null, last_message: { body, from, internal: false, at: ago(Number(min)) }, messages: from === 'staff' ? 2 : 1
        }))
      };
    case 'ops_support_ticket':
      return {
        ticket: { id: 't2', user_id: 'c2', category: 'competition', subject: 'Loop not counted near the flyover', status: 'open', priority: 'normal', assigned_to: null, app_version: '1.4.0', platform: 'ios', device: 'Apple iPhone 15 OS 19.1', context: {}, created_at: ago(60 * 5), last_message_at: ago(42), first_response_at: ago(60 * 4), solved_at: null },
        runner: { id: 'c2', handle: 'trailhawk', display_name: 'Hamza Ali', status: 'active', joined_at: ago(60 * 24 * 35), avatar_kind: 'style', runs: 88, last_run_at: ago(2), tickets: 2 },
        assignee: null,
        messages: [
          { id: 'm1', from: 'runner', body: 'I ran the Sea View loop this morning but it says "not counted". The tunnel under the flyover has no GPS, is that why?', internal: false, at: ago(60 * 5), author: null },
          { id: 'm2', from: 'staff', body: 'Thanks Hamza. A gap longer than 10 seconds breaks a loop, and the tunnel is about 40 seconds. Could you send the time of the run so we can check?', internal: false, at: ago(60 * 4), author: 'ayesha.k' },
          { id: 'm3', from: 'staff', body: 'Several reports about this tunnel. Worth an exclusion or a longer gap allowance next season.', internal: true, at: ago(60 * 4 - 2), author: 'ayesha.k' },
          { id: 'm4', from: 'runner', body: 'Around 6:10 am. Same thing happened last week.', internal: false, at: ago(42), author: null }
        ],
        other_tickets: [{ id: 't9', subject: 'Movement points missing', status: 'solved', created_at: ago(60 * 24 * 12) }],
        agents: [{ id: 's-bilal', handle: 'bilal', display_name: 'Bilal Zaidi' }, { id: 's-ayesha', handle: 'ayesha.k', display_name: 'Ayesha Khan' }],
        me: 's-bilal'
      };
    case 'ops_metrics': {
      const n = 30;
      const days = Array.from({ length: n }, (_, i) => day(n - 1 - i));
      const runs = wave(n, 260, 60, 1);
      const series: Record<string, number[]> = {
        active_runners: runs.map((r) => Math.round(r * 0.62)), runs, distance_km: runs.map((r) => Math.round(r * 6.1)), moving_hours: runs.map((r) => Math.round(r * 0.6)),
        loops_claimed: runs.map((r) => Math.round(r * 0.28)), loops_rejected: runs.map((r) => Math.round(r * 0.07)), land_cells: runs.map((r) => Math.round(r * 15)),
        land_km2: runs.map((r) => Math.round(r * 0.024 * 10) / 10), signups: wave(n, 22, 9, 4), onboarded: wave(n, 18, 7, 4), posts: wave(n, 40, 12, 2), comments: wave(n, 120, 30, 3),
        follows: wave(n, 55, 14, 5), club_joins: wave(n, 12, 5, 6), reports: wave(n, 6, 3, 7), moderation_resolved: wave(n, 5, 3, 8), integrity_opened: wave(n, 2, 2, 9),
        route_proposals: wave(n, 2, 1, 1), support_opened: wave(n, 4, 2, 2), support_solved: wave(n, 4, 2, 3), support_first_response_min: wave(n, 38, 15, 4),
        pushes_sent: wave(n, 900, 200, 5), emails_sent: wave(n, 140, 40, 6), jobs_dead: wave(n, 1, 1, 7)
      };
      const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
      const totals = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, k === 'support_first_response_min' ? sum(v) / v.length : k === 'active_runners' ? 1840 : sum(v)]));
      const previous = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(Number(v) * 0.88)]));
      const catalogRows = [
        ['active_runners', 'Active runners', 'runners', 'distinct', 'Running'], ['runs', 'Runs', 'runs', 'sum', 'Running'], ['distance_km', 'Distance', 'km', 'sum', 'Running'],
        ['moving_hours', 'Time moving', 'h', 'sum', 'Running'], ['loops_claimed', 'Loops that claimed land', 'loops', 'sum', 'Territory'], ['loops_rejected', 'Loops not counted', 'loops', 'sum', 'Territory'],
        ['land_cells', 'Land cells captured', 'cells', 'sum', 'Territory'], ['land_km2', 'Land captured', 'km²', 'sum', 'Territory'], ['signups', 'Sign-ups', 'runners', 'sum', 'Growth'],
        ['onboarded', 'Finished onboarding', 'runners', 'sum', 'Growth'], ['posts', 'Posts', 'posts', 'sum', 'Community'], ['comments', 'Comments', 'comments', 'sum', 'Community'],
        ['follows', 'New follows', 'follows', 'sum', 'Community'], ['club_joins', 'Club joins', 'joins', 'sum', 'Community'], ['reports', 'Reports', 'reports', 'sum', 'Trust & safety'],
        ['moderation_resolved', 'Moderation cases resolved', 'cases', 'sum', 'Trust & safety'], ['integrity_opened', 'Integrity cases opened', 'cases', 'sum', 'Trust & safety'],
        ['route_proposals', 'Route proposals', 'proposals', 'sum', 'Trust & safety'], ['support_opened', 'Support conversations', 'conversations', 'sum', 'Support'],
        ['support_solved', 'Support solved', 'conversations', 'sum', 'Support'], ['support_first_response_min', 'First response (median)', 'min', 'median', 'Support'],
        ['pushes_sent', 'Push notifications sent', 'pushes', 'sum', 'Platform'], ['emails_sent', 'Emails sent', 'emails', 'sum', 'Platform'], ['jobs_dead', 'Jobs that failed', 'jobs', 'sum', 'Platform']
      ].map(([key, label, unit, agg, group]) => ({ key, label, unit, agg, group }));
      return { time_zone: 'Asia/Karachi', from: days[0], to: days[n - 1], previous_from: day(2 * n - 1), previous_to: day(n), refreshed_at: ago(3), catalog: catalogRows, days, series, totals, previous };
    }
    case 'ops_analytics_breakdowns':
      return {
        loop_outcomes: [{ key: 'eligible', value: 2210 }, { key: 'unranked', value: 412 }, { key: 'pending_review', value: 38 }, { key: 'invalid', value: 21 }, { key: 'withheld_privacy', value: 9 }],
        rejection_reasons: [{ key: 'open_loop', value: 188 }, { key: 'too_short', value: 121 }, { key: 'gps_gap', value: 64 }, { key: 'low_accuracy', value: 31 }, { key: 'degenerate_shape', value: 18 }, { key: 'suspicious_speed', value: 11 }],
        distance_buckets: [{ key: 'Under 1 km', value: 140 }, { key: '1–3 km', value: 1290 }, { key: '3–5 km', value: 2410 }, { key: '5–10 km', value: 2860 }, { key: '10–21 km', value: 820 }, { key: '21 km+', value: 96 }],
        hour_of_day: [3, 1, 0, 0, 12, 160, 610, 720, 380, 120, 60, 40, 30, 28, 30, 60, 180, 420, 520, 360, 160, 70, 30, 9],
        weekday: [980, 1010, 1040, 990, 870, 1420, 1310],
        top_districts: [{ key: 'Clifton', value: 1620 }, { key: 'DHA', value: 1410 }, { key: 'Gulshan', value: 760 }, { key: 'Saddar', value: 420 }, { key: 'Not set', value: 180 }],
        platforms: [{ key: 'ios', value: 840 }, { key: 'android', value: 1120 }],
        support_categories: [{ key: 'bug', value: 9 }, { key: 'competition', value: 7 }, { key: 'account', value: 4 }, { key: 'feedback', value: 4 }, { key: 'safety', value: 1 }],
        report_categories: [{ key: 'spam', value: 21 }, { key: 'harassment', value: 9 }, { key: 'cheating', value: 7 }, { key: 'privacy', value: 3 }]
      };
    case 'ops_analytics_funnel':
      return [{ key: 'Signed up', value: 660 }, { key: 'Finished onboarding', value: 541 }, { key: 'Recorded a run', value: 402 }, { key: 'Claimed land', value: 288 }, { key: 'Ran again in week 2', value: 191 }];
    case 'ops_analytics_retention':
      return Array.from({ length: 8 }, (_, i) => ({ week: day(7 * (7 - i) + 3), size: 60 + ((i * 17) % 40), weeks: Array.from({ length: 8 }, (_, k) => (k > 7 - i ? null : Math.max(8, Math.round(100 * Math.pow(0.78, k) - (i % 3) * 2 - k)))) }));
    case 'ops_preferences':
      return {};
    case 'ops_sql_catalog':
      return [
        { name: 'runners', comment: 'Runner profiles. No email, photos or bio.', columns: [['id', 'uuid'], ['handle', 'citext'], ['display_name', 'text'], ['status', 'text'], ['city_label', 'text'], ['created_at', 'timestamp with time zone'], ['onboarding_completed_at', 'timestamp with time zone']].map(([name, type]) => ({ name, type })) },
        { name: 'runs', comment: 'Runs (activities). No route, notes, splits or device details.', columns: [['id', 'uuid'], ['user_id', 'uuid'], ['started_at', 'timestamp with time zone'], ['status', 'text'], ['distance_m', 'double precision'], ['moving_ms', 'bigint'], ['integrity_flags', 'text[]']].map(([name, type]) => ({ name, type })) },
        { name: 'loop_claims', comment: 'Loop claims and their outcome. No polygon.', columns: [['id', 'uuid'], ['user_id', 'uuid'], ['status', 'text'], ['reasons', 'text[]'], ['rule_version', 'text'], ['eligible_cell_count', 'integer'], ['created_at', 'timestamp with time zone']].map(([name, type]) => ({ name, type })) },
        { name: 'support_tickets', comment: 'Support conversations without subjects or messages.', columns: [['id', 'uuid'], ['category', 'text'], ['status', 'text'], ['created_at', 'timestamp with time zone']].map(([name, type]) => ({ name, type })) },
        { name: 'metrics_daily', comment: 'Daily metrics used by Analytics.', columns: [['day', 'date'], ['metric', 'text'], ['value', 'double precision']].map(([name, type]) => ({ name, type })) }
      ];
    case 'ops_sql_saved':
      return {
        queries: [
          { id: 'q1', name: 'Runs per city this week', sql: "select r.city_label, count(*) as runs\n  from runs x join runners r on r.id = x.user_id\n where x.started_at > now() - interval '7 days'\n group by 1 order by 2 desc", shared: true, mine: true, owner: 'bilal', updated_at: ago(60 * 24) },
          { id: 'q2', name: 'Why loops are not counted', sql: 'select unnest(reasons) as reason, count(*)\n  from loop_claims where status in (\'unranked\', \'invalid\')\n group by 1 order by 2 desc', shared: false, mine: true, owner: 'bilal', updated_at: ago(60 * 3) }
        ],
        history: [{ sql: 'select count(*) from runners', rows: 1, ms: 12, error: null, at: ago(14) }, { sql: 'select * from profiles', rows: 0, ms: 3, error: 'relation "profiles" does not exist', at: ago(16) }]
      };
    case 'ops_sql_run':
      return {
        columns: ['city_label', 'runs', 'km'],
        rows: [['Karachi', 1840, 11240.5], ['Lahore', 610, 3712.2], ['Islamabad', 402, 2510.9], [null, 61, 280.3]],
        row_count: 4, truncated: false, error: null, ms: 38, limit: 200
      };
    default:
      return null;
  }
}
