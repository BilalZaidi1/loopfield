/** Public configuration. Next inlines NEXT_PUBLIC_* at build time, so these are read directly. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '',
  appEnv: (process.env.NEXT_PUBLIC_APP_ENV ?? 'development') as 'development' | 'preview' | 'production'
};

export function assertSupabaseConfigured(): void {
  if (!env.supabaseUrl || !env.supabaseKey) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
}

export const ENV_LABEL: Record<typeof env.appEnv, string> = {
  development: 'Development',
  preview: 'Preview',
  production: 'Production'
};
