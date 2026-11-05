import Constants from 'expo-constants';

/**
 * Client configuration. Every value here is public by design (publishable keys, public tokens, DSNs).
 * Missing optional integrations degrade to clearly labelled "not configured" states — never to mocks.
 */
const v = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);

export const env = {
  supabaseUrl: v(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: v(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  mapboxToken: v(process.env.EXPO_PUBLIC_MAPBOX_TOKEN),
  mapboxStyleUrl: v(process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL) ?? 'mapbox://styles/mapbox/outdoors-v12',
  posthogKey: v(process.env.EXPO_PUBLIC_POSTHOG_KEY),
  posthogHost: v(process.env.EXPO_PUBLIC_POSTHOG_HOST) ?? 'https://us.i.posthog.com',
  sentryDsn: v(process.env.EXPO_PUBLIC_SENTRY_DSN),
  revenueCatIosKey: v(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY),
  revenueCatAndroidKey: v(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY),
  defaultCompetitionId: v(process.env.EXPO_PUBLIC_DEFAULT_COMPETITION_ID),
  termsUrl: v(process.env.EXPO_PUBLIC_TERMS_URL),
  privacyUrl: v(process.env.EXPO_PUBLIC_PRIVACY_URL),
  supportEmail: v(process.env.EXPO_PUBLIC_SUPPORT_EMAIL),
  defaultMapCenter: v(process.env.EXPO_PUBLIC_DEFAULT_MAP_CENTER),
  appEnv: ((Constants.expoConfig?.extra as { appEnv?: string } | undefined)?.appEnv ?? 'development') as 'development' | 'preview' | 'production'
} as const;

export function missingRequiredConfig(): string[] {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

/** Guard against accidentally bundling server secrets (defence in depth; CI also scans). */
export function assertNoSecrets(values: Record<string, string | undefined> = env as never): void {
  for (const [k, val] of Object.entries(values)) {
    if (typeof val === 'string' && /^(sk_|sb_secret_|whsec_|rk_live|re_[A-Za-z0-9]{10,})|service_role/.test(val)) {
      throw new Error(`Refusing to start: ${k} looks like a server secret`);
    }
  }
}

/** Versions of the legal texts a runner accepts at registration; bump when the documents change. */
export const LEGAL_VERSION = '2026-11-pilot-draft';
export const COMPETITION_CONSENT_VERSION = '2026-11-proposed-rules';
export const ROUTE_PUBLICATION_CONSENT_VERSION = '2026-11';

export function defaultMapCenter(): [number, number] | null {
  if (!env.defaultMapCenter) return null;
  const [lng, lat] = env.defaultMapCenter.split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng!, lat!] : null;
}
