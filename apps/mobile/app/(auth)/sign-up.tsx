import { useState } from 'react';
import { Linking as RNLinking, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { env, LEGAL_VERSION } from '@/config/env';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Screen, TextField, Toggle, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/** S02 Create account — registration, adult eligibility (18+ pilot), terms, required consent and verification. */
export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwOk = password.length >= 10;
  const legalAvailable = Boolean(env.termsUrl && env.privacyUrl);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase().auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: Linking.createURL('auth/callback'), data: { adult_confirmed: true, legal_version: LEGAL_VERSION } }
      });
      if (e) throw e;
      track('signup_completed', { method: 'email' });
      // Projects with email confirmation turned off return a session at once; the session guard then opens
      // onboarding, so there is no email to wait for.
      if (data.session) return;
      setSent(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen>
        <View style={{ gap: spacing.md, marginTop: spacing.xxl }}>
          <Txt variant="title">Check your email</Txt>
          <Txt>We sent a verification link to {email.trim()}. Open it on this phone to finish creating your account.</Txt>
          <Txt variant="caption">The link expires. If it does not arrive, check spam or request a new one from Log in.</Txt>
          <Button label="Go to log in" variant="secondary" onPress={() => router.replace('/sign-in')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Txt variant="title">Create account</Txt>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={email && !emailOk ? 'Enter a valid email address.' : undefined} />
        <TextField label="Password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="new-password" hint="At least 10 characters." error={password && !pwOk ? 'Use at least 10 characters.' : undefined} />
        <Toggle label="I am 18 or older" description="The pilot is for adults only." value={adult} onChange={setAdult} />
        <Toggle label="I accept the Terms and Privacy Notice" description={`Version ${LEGAL_VERSION}. Competition, analytics and health choices are asked separately later.`} value={terms} onChange={setTerms} />
        {legalAvailable ? (
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button variant="ghost" label="Read Terms" onPress={() => void RNLinking.openURL(env.termsUrl!)} />
            <Button variant="ghost" label="Read Privacy Notice" onPress={() => void RNLinking.openURL(env.privacyUrl!)} />
          </View>
        ) : (
          <Banner tone="warning" text="The reviewed Terms and Privacy Notice are not published for this build yet (pilot draft). Do not invite real participants until they are." />
        )}
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button label="Create account" onPress={submit} loading={busy} disabled={!emailOk || !pwOk || !adult || !terms || busy} hint={!adult ? 'Confirm you are 18 or older to continue.' : undefined} />
        <Button label="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} />
      </View>
    </Screen>
  );
}
