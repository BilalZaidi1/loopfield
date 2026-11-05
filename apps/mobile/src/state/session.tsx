import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { identify, resetAnalytics, setAnalyticsConsent } from '@/lib/analytics';
import { setMonitoringUser } from '@/lib/sentry';
import { queryClient } from '@/lib/query';
import { log } from '@/lib/log';
import { disconnectChat } from '@/chat/client';
import { purchasesLogIn, purchasesLogOut } from '@/billing/purchases';
import { clearHealthCache } from '@/health/cache';
import { unregisterPushToken } from '@/notifications/push';

export interface Profile {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
  district_id: string | null;
  city_label: string | null;
  visibility: 'public' | 'private';
  discoverable: boolean;
  status: string;
  onboarding_completed_at: string | null;
}

export interface Settings {
  messages_from: 'mutual' | 'followers' | 'nobody';
  default_post_audience: 'only_me' | 'followers' | 'public';
  full_private_mode: boolean;
  units: 'metric' | 'imperial';
  analytics_enabled: boolean;
  territory_competition_enabled: boolean;
  speed_competition_enabled: boolean;
  selected_competition_id: string | null;
}

interface SessionState {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  settings: Settings | null;
  roles: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setSettings(null);
      setRoles([]);
      return;
    }
    const sb = supabase();
    const [p, st, r] = await Promise.all([
      sb.from('profiles').select('*').eq('id', s.user.id).single(),
      sb.from('user_settings').select('*').eq('user_id', s.user.id).single(),
      sb.rpc('my_staff_roles')
    ]);
    if (p.error) log.error('profile load failed', p.error);
    setProfile((p.data as Profile) ?? null);
    setSettings((st.data as Settings) ?? null);
    setRoles((r.data as string[]) ?? []);
    const consent = Boolean((st.data as Settings | null)?.analytics_enabled);
    await setAnalyticsConsent(consent);
    if (consent) identify(s.user.id, { platform: 'mobile' });
    setMonitoringUser(s.user.id);
    void purchasesLogIn(s.user.id);
  }, []);

  useEffect(() => {
    let mounted = true;
    const sb = supabase();
    sb.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadUser(data.session).catch((e) => log.error('session load', e));
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Token refreshes keep the same user; only identity changes reload the profile.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
      setLoading(true);
      void loadUser(s)
        .catch((e) => log.error('session change', e))
        .finally(() => setLoading(false));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadUser]);

  const refresh = useCallback(async () => {
    await loadUser(session);
  }, [loadUser, session]);

  /** Sign-out clears every identity-bound client and the on-device health cache (FR51). */
  const signOut = useCallback(async () => {
    await unregisterPushToken().catch(() => {});
    await disconnectChat().catch(() => {});
    await purchasesLogOut().catch(() => {});
    await clearHealthCache().catch((e) => log.error('health cache clear failed', e));
    resetAnalytics();
    setMonitoringUser(null);
    queryClient.clear();
    await supabase().auth.signOut();
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, userId: session?.user.id ?? null, profile, settings, roles, loading, refresh, signOut }),
    [session, profile, settings, roles, loading, refresh, signOut]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export function useUnits(): 'metric' | 'imperial' {
  return useSession().settings?.units ?? 'metric';
}
