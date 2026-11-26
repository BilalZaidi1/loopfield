import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SOCIAL_RULES } from '@loopfield/core';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';

/**
 * App settings set in the back office (App control). They live in `public.app_config`; row-level
 * security returns only the rows the app may read (`is_public`), so one query loads all of them. The
 * server still enforces every switch and limit: these values only shape what the app offers, so a
 * missing or unreadable value falls back to the built-in default and never switches a check off.
 */
export type AppConfigRaw = Record<string, unknown>;

export const APP_CONFIG_QUERY_KEY = ['app_config'] as const;
/** Settings are read again at most this often while the app is open, and every time it comes back to the foreground. */
export const APP_CONFIG_REFRESH_MS = 5 * 60_000;

/** The kill switches the app reads (`true` while the feature is on). */
export const SWITCH_KEYS = [
  'territory_capture_enabled',
  'speed_titles_enabled',
  'public_publication_enabled',
  'photo_uploads_enabled',
  'messaging_enabled',
  'reclaim_enabled',
  'comments_enabled',
  'avatar_uploads_enabled',
  'club_creation_enabled',
  'route_proposals_enabled',
  'route_builder_enabled',
  'route_snapping_enabled',
  'live_links_enabled',
  'avatar_marker_enabled',
  'run_summaries_enabled',
  'running_now_enabled',
  'friends_live_enabled',
  'ble_sensors_enabled',
  'gear_enabled',
  'replay_enabled'
] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

export interface Maintenance {
  enabled: boolean;
  message: string | null;
  /** When the app is expected back (ISO time), if the back office set one. */
  until: string | null;
}

export interface AppSettings {
  maintenance: Maintenance;
  /** Builds below this are blocked until updated. */
  minSupportedVersion: string | null;
  /** The newest version in each store; older builds are offered the update once per version. */
  latestVersion: { ios: string | null; android: string | null };
  enabled: Record<SwitchKey, boolean>;
  paywallEnabled: boolean;
  premiumFeatures: string[];
  postMaxChars: number;
  commentMaxChars: number;
  postMaxPhotos: number;
  /** Runs shorter than the larger of this and 3 × `shareRouteTrimM` are shared without a route. */
  shareMapMinDistanceM: number;
  shareRouteTrimM: number;
  shareStreetMap: boolean;
  disabledHealthCards: string[];
  groupMaxMembers: number | null;
  achievementTierPoints: Record<string, number> | null;
  achievementCategoryBonus: number | null;
  movementPointsPerKm: number | null;
  movementPointsDailyCap: number | null;
  integrityOverrides: unknown;
  /** 'proposed' while thresholds await field validation. */
  rulesStatus: string | null;
  /** Running tools (R1): planned routes, following them, and live links. */
  plannedRoutesMax: number;
  offRouteDistanceM: number;
  offRouteSeconds: number;
  liveLinkPushSeconds: number;
  liveLinkGraceMinutes: number;
  liveLinkMaxHours: number;
  /** Running tools (R2): runners out right now and live runs with friends. */
  runningNowMinCount: number;
  friendsLiveMaxPeople: number;
  /** Running tools (R4): start-to-finish speed routes (off until decided) and shoes. */
  routeProposalsAToB: boolean;
  gearMaxItems: number;
  gearReminderDefaultKm: number;
}

const VERSION = /^\d+(\.\d+){0,2}$/;

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** A positive whole number, or the default. */
function count(v: unknown, fallback: number): number {
  const n = num(v);
  return n != null && n >= 1 ? Math.floor(n) : fallback;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function version(v: unknown): string | null {
  const s = text(v);
  return s && VERSION.test(s) ? s : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function numbers(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const n = num(x);
    if (n != null) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** Typed settings with the built-in defaults filled in. Pure, so it is tested directly. */
export function parseAppConfig(raw: AppConfigRaw | null | undefined): AppSettings {
  const r = raw ?? {};
  const m = r.maintenance_mode && typeof r.maintenance_mode === 'object' ? (r.maintenance_mode as Record<string, unknown>) : {};
  const latest = r.latest_app_version && typeof r.latest_app_version === 'object' ? (r.latest_app_version as Record<string, unknown>) : {};
  const until = text(m.until);
  const enabled = Object.fromEntries(SWITCH_KEYS.map((k) => [k, bool(r[k], true)])) as Record<SwitchKey, boolean>;
  const group = num(r.group_max_members);
  return {
    maintenance: { enabled: bool(m.enabled, false), message: text(m.message), until: until && Number.isFinite(Date.parse(until)) ? until : null },
    minSupportedVersion: version(r.min_supported_app_version),
    latestVersion: { ios: version(latest.ios), android: version(latest.android) },
    enabled,
    paywallEnabled: bool(r.paywall_enabled, false),
    premiumFeatures: strings(r.premium_features),
    postMaxChars: count(r.post_max_chars, SOCIAL_RULES.maxPostBodyChars.value),
    commentMaxChars: count(r.comment_max_chars, SOCIAL_RULES.maxCommentChars.value),
    postMaxPhotos: Math.min(count(r.post_max_photos, SOCIAL_RULES.maxPhotosPerPost.value), 20),
    shareMapMinDistanceM: count(r.share_map_min_distance_m, 600),
    shareRouteTrimM: count(r.share_route_trim_m, 200),
    shareStreetMap: bool(r.share_street_map_enabled, true),
    disabledHealthCards: strings(r.disabled_health_cards),
    groupMaxMembers: group != null && group > 0 ? Math.floor(group) : null,
    achievementTierPoints: numbers(r.achievement_tier_points),
    achievementCategoryBonus: num(r.achievement_category_bonus),
    movementPointsPerKm: num(r.movement_points_per_km),
    movementPointsDailyCap: num(r.movement_points_daily_cap),
    integrityOverrides: r.integrity_overrides ?? null,
    rulesStatus: text(r.rules_status),
    plannedRoutesMax: count(r.planned_routes_max, 100),
    offRouteDistanceM: Math.min(Math.max(count(r.off_route_distance_m, 40), 20), 150),
    offRouteSeconds: Math.min(Math.max(count(r.off_route_seconds, 15), 5), 60),
    liveLinkPushSeconds: Math.min(Math.max(count(r.live_link_push_seconds, 30), 15), 120),
    liveLinkGraceMinutes: Math.min(Math.max(num(r.live_link_grace_minutes) ?? 15, 0), 60),
    liveLinkMaxHours: Math.min(count(r.live_link_max_hours, 6), 12),
    // Counts under five are never shown, whatever the setting says.
    runningNowMinCount: Math.max(count(r.running_now_min_count, 5), 5),
    friendsLiveMaxPeople: Math.min(Math.max(count(r.friends_live_max_people, 50), 1), 200),
    routeProposalsAToB: bool(r.route_proposals_a_to_b, false),
    gearMaxItems: Math.min(count(r.gear_max_items, 20), 100),
    gearReminderDefaultKm: Math.min(Math.max(count(r.gear_reminder_default_km, 700), 300), 1500)
  };
}

/** The shortest run that shares its route on cards and posts: the larger of the setting and both hidden ends plus as much again. */
export function shareRouteMinMeters(s: Pick<AppSettings, 'shareMapMinDistanceM' | 'shareRouteTrimM'>): number {
  return Math.max(s.shareMapMinDistanceM, 3 * s.shareRouteTrimM);
}

async function loadAppConfig(): Promise<AppConfigRaw> {
  const { data, error } = await supabase().from('app_config').select('key, value');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
}

const DEFAULTS = parseAppConfig(null);

/**
 * The settings, for any screen. Every screen shares one cached copy; it is read again when it is older
 * than five minutes. `useAppConfigSync` (mounted once at the root) keeps it fresh.
 */
export function useAppConfig(): { settings: AppSettings; loaded: boolean; error: unknown } {
  const q = useQuery({ queryKey: APP_CONFIG_QUERY_KEY, queryFn: loadAppConfig, staleTime: APP_CONFIG_REFRESH_MS, gcTime: Infinity, refetchOnWindowFocus: false });
  const data = q.data;
  const settings = useMemo(() => (data ? parseAppConfig(data) : DEFAULTS), [data]);
  return { settings, loaded: data !== undefined, error: q.error };
}

/**
 * Mounted once at the root: reads the settings on launch, every time the app comes back to the
 * foreground (so a maintenance window or a switched-off feature shows on reopening) and otherwise every
 * five minutes while the app is open.
 */
export function useAppConfigSync(): ReturnType<typeof useAppConfig> & { refetch: () => void } {
  const q = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: loadAppConfig,
    staleTime: APP_CONFIG_REFRESH_MS,
    gcTime: Infinity,
    refetchInterval: APP_CONFIG_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always'
  });
  const data = q.data;
  const settings = useMemo(() => (data ? parseAppConfig(data) : DEFAULTS), [data]);
  return { settings, loaded: data !== undefined, error: q.error, refetch: () => void q.refetch() };
}

/**
 * For code outside React (the recorder): the cached settings when fresh, otherwise read now. Kept like the hooks'
 * copy (never dropped), which also means no clean-up timer is left running when the recorder reads them first.
 */
export async function fetchAppConfig(): Promise<AppSettings> {
  const raw = await queryClient.fetchQuery({ queryKey: APP_CONFIG_QUERY_KEY, queryFn: loadAppConfig, staleTime: APP_CONFIG_REFRESH_MS, gcTime: Infinity });
  return parseAppConfig(raw);
}

/** Whether a kill-switched feature is on. */
export function useFeature(key: SwitchKey): boolean {
  return useAppConfig().settings.enabled[key];
}

/** The short note shown in place of a paused feature's entry point. */
export const PAUSED_TEXT: Record<SwitchKey, string> = {
  territory_capture_enabled: 'Land capture is paused for now. You can still record privately.',
  speed_titles_enabled: 'Route titles are paused for now. You can still record privately.',
  public_publication_enabled: 'New results are held back from maps and rankings for now. Your runs still count and appear once this is back on.',
  photo_uploads_enabled: 'Adding photos is paused for now.',
  messaging_enabled: 'Messaging is paused for now.',
  reclaim_enabled: 'Reclaiming land with points is paused for now.',
  comments_enabled: 'Comments are paused for now.',
  avatar_uploads_enabled: 'New profile photos are paused for now. You can still make a drawn avatar, and your current picture stays.',
  club_creation_enabled: 'Creating clubs is paused for now.',
  route_proposals_enabled: 'Proposing routes is paused for now.',
  route_builder_enabled: 'Planning new routes is paused for now. You can still follow the routes you saved.',
  route_snapping_enabled: 'Following paths is paused for now, so new legs are drawn as straight lines.',
  live_links_enabled: 'Live location links are paused for now.',
  avatar_marker_enabled: 'Your picture as the position dot is paused for now.',
  run_summaries_enabled: 'Run highlights are paused for now.',
  running_now_enabled: 'Runners out right now is paused for now.',
  friends_live_enabled: 'Live runs with friends are paused for now. Nothing is shared while it is off.',
  ble_sensors_enabled: 'Heart-rate straps are paused for now. Your strap is not connected during runs; heart rate from your health app still counts.',
  gear_enabled: 'Shoes are paused for now. New runs count towards no pair until this is back; your shoes and their distances are kept.',
  replay_enabled: 'Replay is paused for now.'
};
