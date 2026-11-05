import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Banner, PressableScale, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { signInWithProvider, useOAuthProviders, type OAuthProvider } from './oauth';

const LABEL: Record<OAuthProvider, string> = { apple: 'Continue with Apple', google: 'Continue with Google' };

/** Apple and Google buttons for the providers enabled on the backend, with an "or" divider below. Renders nothing otherwise. */
export function SocialButtons({ intent }: { intent: 'sign-in' | 'sign-up' }) {
  const t = useTheme();
  const p = t.palette;
  const providers = useOAuthProviders();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!providers.data?.length) return null;

  const go = async (provider: OAuthProvider) => {
    setBusy(provider);
    setError(null);
    try {
      const ok = await signInWithProvider(provider);
      if (ok && intent === 'sign-up') track('signup_completed', { method: provider });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {providers.data.map((provider) => {
        const apple = provider === 'apple';
        const bg = apple ? p.ink : p.surface;
        const fg = apple ? p.onInk : p.text;
        return (
          <PressableScale
            key={provider}
            onPress={() => void go(provider)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={LABEL[provider]}
            accessibilityState={{ busy: busy === provider, disabled: busy !== null }}
            style={{ minHeight: 56, borderRadius: radius.pill, backgroundColor: bg, borderWidth: apple ? 0 : 1, borderColor: p.borderStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, opacity: busy && busy !== provider ? 0.5 : 1 }}>
            {busy === provider ? <ActivityIndicator color={fg} /> : <Icon name={provider} color={fg} size={22} />}
            <Txt variant="bodyStrong" style={{ color: fg, fontWeight: '700' }}>{LABEL[provider]}</Txt>
          </PressableScale>
        );
      })}
      {error ? <Banner tone="danger" text={error} /> : null}
      {intent === 'sign-up' ? <Txt variant="caption" align="center">You will confirm your age and accept the terms on the next step.</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xs }} accessible={false}>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
        <Txt variant="label" color="textMuted">or use email</Txt>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
      </View>
    </View>
  );
}
