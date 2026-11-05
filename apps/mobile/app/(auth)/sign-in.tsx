import { useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { ArrowLink, Banner, Button, IconButton, Screen, TextField, Txt } from '@/components/ui';
import { SocialButtons } from '@/features/auth/SocialButtons';
import { spacing } from '@/theme/tokens';

/** S03 Log in and recovery — sign-in method, recovery and account creation link. */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [mode, setMode] = useState<'password' | 'recover'>('password');

  const signIn = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
      if (e) throw e;
    } catch (e) {
      const msg = friendlyError(e);
      const needsVerification = /confirm/i.test(msg);
      setUnverified(needsVerification);
      setError(needsVerification ? 'Verify your email first: open the link we sent you.' : /invalid/i.test(msg) ? 'Email or password is incorrect.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL('auth/callback', { queryParams: { next: 'reset' } }) });
      if (e) throw e;
      setNotice('If an account exists for that email, a reset link is on its way. Open it on this device.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const { error: e } = await supabase().auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: Linking.createURL('auth/callback') } });
      if (e) throw e;
      setNotice('Verification email sent again.');
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: 'password' | 'recover') => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  return (
    <Screen
      maxWidth={520}
      footer={
        mode === 'password' ? (
          <>
            <Button label="Log in" size="lg" arrow onPress={signIn} loading={busy} disabled={!email.trim() || !password || busy} />
            <Button label="New here? Create an account" variant="ghost" onPress={() => router.replace('/sign-up')} />
          </>
        ) : (
          <>
            <Button label="Send reset link" size="lg" arrow onPress={recover} loading={busy} disabled={!email.trim() || busy} />
            <Button label="Back to log in" variant="ghost" onPress={() => switchMode('password')} />
          </>
        )
      }>
      <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
      <View style={{ gap: spacing.xs }}>
        <Txt variant="title">{mode === 'password' ? 'Welcome back' : 'Reset your password'}</Txt>
        <Txt color="textMuted">{mode === 'password' ? 'Log in to see your ground and pick up where you left off.' : 'Enter your account email and we will send you a link to choose a new password.'}</Txt>
      </View>
      {mode === 'password' ? <SocialButtons intent="sign-in" /> : null}
      <View style={{ gap: spacing.lg }}>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType={mode === 'password' ? 'next' : 'send'} />
        {mode === 'password' ? (
          <View style={{ gap: spacing.xs }}>
            <TextField label="Password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" returnKeyType="go" onSubmitEditing={() => email.trim() && password && void signIn()} />
            <View style={{ alignSelf: 'flex-end' }}>
              <ArrowLink label="Forgot password?" onPress={() => switchMode('recover')} />
            </View>
          </View>
        ) : null}
      </View>
      {error ? <Banner tone="danger" text={error} action={unverified ? { label: 'Resend email', onPress: () => void resend() } : undefined} /> : null}
      {notice ? <Banner tone="success" text={notice} /> : null}
    </Screen>
  );
}
