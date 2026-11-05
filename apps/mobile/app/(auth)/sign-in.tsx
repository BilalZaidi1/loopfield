import { useState } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Screen, TextField, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/** S03 Log in and recovery — sign-in method, recovery and account creation link. */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'recover'>('password');

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
      if (e) throw e;
    } catch (e) {
      const msg = friendlyError(e);
      setError(/confirm/i.test(msg) ? 'Verify your email first: open the link we sent you.' : /invalid/i.test(msg) ? 'Email or password is incorrect.' : msg);
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
      setNotice('If an account exists for that email, a reset link is on its way. Open it on this phone.');
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
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Txt variant="title">{mode === 'password' ? 'Log in' : 'Reset password'}</Txt>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        {mode === 'password' ? <TextField label="Password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" /> : null}
        {error ? <Banner tone="danger" text={error} /> : null}
        {notice ? <Banner tone="success" text={notice} /> : null}
        {mode === 'password' ? (
          <>
            <Button label="Log in" onPress={signIn} loading={busy} disabled={!email.trim() || !password || busy} />
            <Button label="Forgot password?" variant="ghost" onPress={() => { setMode('recover'); setError(null); setNotice(null); }} />
            <Button label="Resend verification email" variant="ghost" onPress={resend} disabled={!email.trim() || busy} />
          </>
        ) : (
          <>
            <Button label="Send reset link" onPress={recover} loading={busy} disabled={!email.trim() || busy} />
            <Button label="Back to log in" variant="ghost" onPress={() => setMode('password')} />
          </>
        )}
        <Button label="Create an account" variant="secondary" onPress={() => router.replace('/sign-up')} />
      </View>
    </Screen>
  );
}
