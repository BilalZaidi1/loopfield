import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
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
import { NO_STAFF, parseWhoAmI, type StaffAccess, type WhoAmI } from './staff';

export interface Profile {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
  /** What avatar_path shows: a photo or a cartoon (saved as an image); null before either was chosen. */
  avatar_kind?: 'photo' | 'cartoon' | null;
  /** The cartoon's parts, to edit it later. */
  avatar_style?: unknown;
  /** The last photo uploaded, to switch back from a cartoon. */
  avatar_photo_path?: string | null;
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

export { NO_STAFF, parseWhoAmI, type StaffAccess } from './staff';

interface SessionState {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  settings: Settings | null;
  staff: StaffAccess;
  /** Holds this operator permission (admins hold all of them). */
  can: (permission: string) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

/** Permissions and account status are read again when the app returns to the foreground, at most this often. */
const ACCESS_REFRESH_MS = 60_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [staff, setStaff] = useState<StaffAccess>(NO_STAFF);
  const [loading, setLoading] = useState(true);
  const accessReadAt = useRef(0);

  /** Operator permissions and the account's status (suspension) in one call. */
  const loadAccess = useCallback(async () => {
    const { data, error } = await supabase().rpc('ops_whoami');
    if (error) return log.warn(`access load failed: ${error.message}`);
    const who = data as WhoAmI | null;
    accessReadAt.current = Date.now();
    setStaff(parseWhoAmI(who));
    if (typeof who?.status === 'string') setProfile((cur) => (cur && cur.status !== who.status ? { ...cur, status: who.status! } : cur));
  }, []);

  const loadUser = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setSettings(null);
      setStaff(NO_STAFF);
      return;
    }
    const sb = supabase();
    const [p, st, w] = await Promise.all([
      sb.from('profiles').select('*').eq('id', s.user.id).single(),
      sb.from('user_settings').select('*').eq('user_id', s.user.id).single(),
      sb.rpc('ops_whoami')
    ]);
    if (p.error) log.error('profile load failed', p.error);
    setProfile((p.data as Profile) ?? null);
    setSettings((st.data as Settings) ?? null);
    setStaff(parseWhoAmI(w.data as WhoAmI | null));
    accessReadAt.current = Date.now();
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
      // Token refreshes and an authenticator code (the session moves to aal2) keep the same user; only
      // identity changes reload the profile. Reloading would also reset the screen the person is on.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'MFA_CHALLENGE_VERIFIED') return;
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

  // Back office changes (a new role, a suspension) reach an open app when it returns to the foreground.
  const signedIn = Boolean(session);
  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - accessReadAt.current > ACCESS_REFRESH_MS) void loadAccess();
    });
    return () => sub.remove();
  }, [signedIn, loadAccess]);

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

  const can = useCallback((permission: string) => staff.permissions.includes(permission), [staff]);
  const value = useMemo<SessionState>(
    () => ({ session, userId: session?.user.id ?? null, profile, settings, staff, can, loading, refresh, signOut }),
    [session, profile, settings, staff, can, loading, refresh, signOut]
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
