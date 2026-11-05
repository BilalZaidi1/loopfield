import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { supabase } from '@/lib/supabase';

export type OAuthProvider = 'apple' | 'google';

/** Providers switched on in the project's public auth settings, Apple first on iOS. */
export function enabledProviders(external: Record<string, boolean> | undefined, os: string): OAuthProvider[] {
  const order: OAuthProvider[] = os === 'ios' ? ['apple', 'google'] : ['google', 'apple'];
  return order.filter((p) => external?.[p] === true);
}

/**
 * Social sign-in is offered only for providers switched on in the Supabase project (Authentication >
 * Providers). The public auth settings endpoint reports which are enabled, so no button appears for a
 * provider that would fail. Age and terms consent are still collected in profile setup afterwards.
 */
export function useOAuthProviders() {
  return useQuery({
    queryKey: ['auth_providers'],
    staleTime: 60 * 60_000,
    retry: 1,
    queryFn: async (): Promise<OAuthProvider[]> => {
      if (!env.supabaseUrl || !env.supabaseAnonKey) return [];
      const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey } });
      if (!res.ok) return [];
      const body = (await res.json()) as { external?: Record<string, boolean> };
      return enabledProviders(body.external, Platform.OS);
    }
  });
}

/**
 * PKCE sign-in through the provider's page. On phones the page opens in an in-app browser session and
 * returns to loopfield://auth/callback; in the browser version the page itself goes to the provider and
 * comes back to /auth/callback, where the code is exchanged (app/auth/callback.tsx).
 * Returns false when the person closed the sign-in page.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<boolean> {
  const redirectTo = Linking.createURL('auth/callback');
  if (Platform.OS === 'web') {
    const { error } = await supabase().auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) throw error;
    return true;
  }
  const { data, error } = await supabase().auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;
  const { queryParams } = Linking.parse(result.url);
  const failure = queryParams?.error_description ?? queryParams?.error;
  if (failure) throw new Error(String(failure));
  const code = queryParams?.code;
  if (!code) throw new Error('The sign-in page did not return a code. Try again.');
  const { error: exchangeError } = await supabase().auth.exchangeCodeForSession(String(code));
  if (exchangeError) throw exchangeError;
  return true;
}
