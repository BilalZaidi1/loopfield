import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Button, ErrorState, LoadingState, Screen } from '@/components/ui';

/**
 * Deep-link landing for email verification and password recovery (PKCE). The code is exchanged for a
 * session on this device; recovery links continue to the new-password screen.
 */
export default function AuthCallback() {
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
      <Screen>
        <ErrorState title="This link could not be used" error={new Error(error ?? 'The link is missing its code or has expired. Request a new one.')} />
        <Button label="Back to log in" variant="secondary" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }
  return <LoadingState label="Signing you in…" />;
}
