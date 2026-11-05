import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Button, ErrorState, Screen, Txt } from '@/components/ui';
import { LoopMark } from '@/components/Brand';
import { spacing, usePalette } from '@/theme/tokens';

/**
 * Deep-link landing for email verification, password recovery and social sign-in (PKCE). The code is
 * exchanged for a session on this device; recovery links continue to the new-password screen.
 */
export default function AuthCallback() {
  const p = usePalette();
  const params = useLocalSearchParams<{ code?: string; next?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(params.error_description ?? null);
  useEffect(() => {
    if (!params.code || error) return;
    void (async () => {
      const { error: e } = await supabase().auth.exchangeCodeForSession(params.code!);
      if (e) return setError(friendlyError(e));
      router.replace(params.next === 'reset' ? '/auth/reset-password' : '/');
    })();
  }, [params.code, params.next, error]);
  if (error || !params.code) {
    return (
      <Screen maxWidth={520} footer={<Button label="Back to log in" size="lg" arrow onPress={() => router.replace('/sign-in')} />}>
        <View style={{ marginTop: spacing.huge }}>
          <ErrorState title="This link could not be used" error={new Error(error ?? 'The link is missing its code or has expired. Request a new one.')} />
        </View>
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: p.bg }} accessibilityRole="progressbar" accessibilityLabel="Signing you in">
      <LoopMark size={72} ring={p.primaryFill} dot={p.orange} />
      <Txt variant="heading">Signing you in…</Txt>
    </View>
  );
}
