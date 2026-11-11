import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { assertNoSecrets, missingRequiredConfig } from '@/config/env';
import { initAnalytics } from '@/lib/analytics';
import { initSentry, Sentry } from '@/lib/sentry';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { Banner, Button, ErrorState, setCustomFontsActive, Txt } from '@/components/ui';
import { BrandSplash } from '@/components/Brand';
import { installWebShims, WebAlertHost } from '@/components/WebAlertHost';
import { SessionProvider, useSession } from '@/state/session';
import { CompetitionProvider } from '@/state/competition';
import { useBackgroundServices } from '@/state/services';
import { spacing, usePalette, useTheme } from '@/theme/tokens';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useAppFonts } from '@/theme/fonts';

assertNoSecrets();
installWebShims();
initSentry();
initAnalytics();
void SplashScreen.preventAutoHideAsync().catch(() => {});

onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected))));
AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));

function versionBelow(current: string, min: string): boolean {
  const a = current.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

function UpdateGate() {
  const q = useQuery({
    queryKey: ['app_config', 'min_version'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase().from('app_config').select('value').eq('key', 'min_supported_app_version').maybeSingle();
      return (data?.value as string | undefined) ?? null;
    }
  });
  const current = Constants.expoConfig?.version ?? '0.0.0';
  if (q.data && versionBelow(current, q.data)) return <Banner tone="warning" text={`This version (${current}) is no longer supported. Please update the app to keep uploading runs.`} />;
  return null;
}

function Gate({ fontsReady }: { fontsReady: boolean }) {
  const t = useTheme();
  const p = t.palette;
  const { session, profile, loading, userId, refresh, signOut } = useSession();
  const [splashDone, setSplashDone] = useState(false);
  const onSplashDone = useCallback(() => setSplashDone(true), []);
  useBackgroundServices(profile?.onboarding_completed_at ? userId : null);
  const onboarded = Boolean(profile?.onboarding_completed_at);
  let content: ReactNode = null;
  if (!loading && fontsReady) {
    content =
      session && !profile ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: p.bg, gap: spacing.md }}>
          <ErrorState title="Your profile could not be loaded" error={new Error('Check your connection and try again.')} onRetry={() => void refresh()} />
          <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
        </View>
      ) : (
        <>
          {session ? <UpdateGate /> : null}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={Boolean(session) && !onboarded}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={Boolean(session) && onboarded}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Screen name="auth/callback" />
            {/* Public activity pages open from share links and QR codes, signed in or not. */}
            <Stack.Screen name="a/[token]" />
            {/* Email "stop these emails" links, signed in or not. */}
            <Stack.Screen name="unsubscribe" />
            <Stack.Screen name="auth/reset-password" />
          </Stack>
        </>
      );
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <StatusBar style={!splashDone || t.scheme === 'dark' ? 'light' : 'dark'} />
      {content}
      {splashDone ? null : <BrandSplash ready={!loading && fontsReady} fontsReady={fontsReady} onDone={onSplashDone} />}
    </View>
  );
}

function ConfigMissing({ missing }: { missing: string[] }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: p.bg }}>
      <StatusBar style="auto" />
      <Txt variant="title">Configuration needed</Txt>
      <Txt>This build cannot connect to its backend because these client settings are missing:</Txt>
      {missing.map((m) => (
        <Txt key={m} variant="label">{m}</Txt>
      ))}
      <Txt variant="caption">Set them in apps/mobile/.env (see .env.example) or the EAS environment, then rebuild. No demo data is shown instead.</Txt>
    </View>
  );
}

/** Navigation chrome (screen backgrounds during transitions, native pieces) in the app theme. */
function NavigationTheme({ children }: { children: ReactNode }) {
  const t = useTheme();
  const p = t.palette;
  const value = useMemo(() => {
    const base = t.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, dark: t.scheme === 'dark', colors: { ...base.colors, primary: p.primary, background: p.bg, card: p.surface, text: p.text, border: p.border, notification: p.orange } };
  }, [t.scheme, p]);
  return <NavigationThemeProvider value={value}>{children}</NavigationThemeProvider>;
}

function RootLayout() {
  const missing = missingRequiredConfig();
  const fonts = useAppFonts();
  setCustomFontsActive(fonts.active);
  useEffect(() => {
    if (missing.length) void SplashScreen.hideAsync().catch(() => {});
  }, [missing.length]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <NavigationTheme>
            <WebAlertHost />
            {missing.length ? (
              <ConfigMissing missing={missing} />
            ) : (
              <QueryClientProvider client={queryClient}>
                <SessionProvider>
                  <CompetitionProvider>
                    <Gate fontsReady={fonts.ready} />
                  </CompetitionProvider>
                </SessionProvider>
              </QueryClientProvider>
            )}
          </NavigationTheme>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
