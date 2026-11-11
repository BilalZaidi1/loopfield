/**
 * Server environment. Secrets are read only on the server (edge functions, worker). Nothing here may
 * ever be exposed through EXPO_PUBLIC_* variables.
 */
export interface ServerEnv {
  SUPABASE_URL: string;
  /** Service-role (legacy JWT) or secret (sb_secret_…) key. */
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_ANON_KEY: string | undefined;
  SUPABASE_DB_URL: string;
  TICKET_SIGNING_SECRET: string | undefined;
  STREAM_API_KEY: string | undefined;
  STREAM_API_SECRET: string | undefined;
  REVENUECAT_WEBHOOK_AUTH: string | undefined;
  REVENUECAT_SECRET_API_KEY: string | undefined;
  PREMIUM_ENTITLEMENT_ID: string;
  RESEND_API_KEY: string | undefined;
  RESEND_FROM: string | undefined;
  /** Optional support address replies go to. */
  RESEND_REPLY_TO: string | undefined;
  RESEND_WEBHOOK_SECRET: string | undefined;
  SEND_EMAIL_HOOK_SECRET: string | undefined;
  JOBS_RUNNER_SECRET: string | undefined;
  EXPO_ACCESS_TOKEN: string | undefined;
  SENTRY_DSN: string | undefined;
  SENTRY_ENVIRONMENT: string;
  APP_NAME: string;
  APP_SCHEME: string;
  APP_LINK_BASE: string;
  /** The web version of the app; email buttons open it (custom-scheme links do not work in most mail apps). */
  APP_WEB_URL: string;
  RELEASE: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function readEnv(get: (key: string) => string | undefined): ServerEnv {
  const required = (k: string, ...alts: string[]) => {
    for (const key of [k, ...alts]) {
      const v = get(key);
      if (v && v.trim()) return v.trim();
    }
    throw new ConfigError(`Missing required environment variable ${k}`);
  };
  const optional = (k: string) => {
    const v = get(k);
    return v && v.trim() ? v.trim() : undefined;
  };
  // Hosted Edge Functions receive the new API keys as JSON dictionaries (SUPABASE_SECRET_KEYS /
  // SUPABASE_PUBLISHABLE_KEYS, key "default"); legacy projects also get SUPABASE_SERVICE_ROLE_KEY / _ANON_KEY.
  const fromKeyset = (k: string) => {
    const raw = optional(k);
    if (!raw) return undefined;
    try {
      const keys = JSON.parse(raw) as Record<string, unknown>;
      const value = typeof keys.default === 'string' ? keys.default : Object.values(keys).find((v) => typeof v === 'string');
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    SUPABASE_URL: required('SUPABASE_URL'),
    SUPABASE_SERVICE_KEY: optional('SUPABASE_SECRET_KEY') ?? fromKeyset('SUPABASE_SECRET_KEYS') ?? required('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
    SUPABASE_ANON_KEY: optional('SUPABASE_PUBLISHABLE_KEY') ?? fromKeyset('SUPABASE_PUBLISHABLE_KEYS') ?? optional('SUPABASE_ANON_KEY'),
    SUPABASE_DB_URL: required('SUPABASE_DB_URL'),
    TICKET_SIGNING_SECRET: optional('TICKET_SIGNING_SECRET'),
    STREAM_API_KEY: optional('STREAM_API_KEY'),
    STREAM_API_SECRET: optional('STREAM_API_SECRET'),
    REVENUECAT_WEBHOOK_AUTH: optional('REVENUECAT_WEBHOOK_AUTH'),
    REVENUECAT_SECRET_API_KEY: optional('REVENUECAT_SECRET_API_KEY'),
    PREMIUM_ENTITLEMENT_ID: optional('PREMIUM_ENTITLEMENT_ID') ?? 'premium',
    RESEND_API_KEY: optional('RESEND_API_KEY'),
    RESEND_FROM: optional('RESEND_FROM'),
    RESEND_REPLY_TO: optional('RESEND_REPLY_TO'),
    RESEND_WEBHOOK_SECRET: optional('RESEND_WEBHOOK_SECRET'),
    SEND_EMAIL_HOOK_SECRET: optional('SEND_EMAIL_HOOK_SECRET'),
    JOBS_RUNNER_SECRET: optional('JOBS_RUNNER_SECRET'),
    EXPO_ACCESS_TOKEN: optional('EXPO_ACCESS_TOKEN'),
    SENTRY_DSN: optional('SENTRY_DSN_BACKEND') ?? optional('SENTRY_DSN'),
    SENTRY_ENVIRONMENT: optional('SENTRY_ENVIRONMENT') ?? 'development',
    APP_NAME: optional('APP_NAME') ?? 'Loopfield',
    APP_SCHEME: optional('APP_SCHEME') ?? 'loopfield',
    APP_LINK_BASE: optional('APP_LINK_BASE') ?? 'loopfield://',
    APP_WEB_URL: (optional('APP_WEB_URL') ?? 'https://loopfield.expo.app').replace(/\/+$/, ''),
    RELEASE: optional('RELEASE') ?? 'dev'
  };
}

/** Assert that integration-specific secrets exist; throws a ConfigError naming exactly what is missing. */
export function requireKeys<K extends keyof ServerEnv>(env: ServerEnv, keys: K[]): { [P in K]: NonNullable<ServerEnv[P]> } {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new ConfigError(`Integration not configured: missing ${missing.join(', ')}`);
  return env as never;
}
