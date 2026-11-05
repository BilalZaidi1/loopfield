import { useState } from 'react';
import { Linking as RNLinking, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { env, LEGAL_VERSION } from '@/config/env';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { ArrowLink, Banner, Button, IconButton, ListGroup, Screen, TextField, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SocialButtons } from '@/features/auth/SocialButtons';
import { spacing, usePalette } from '@/theme/tokens';

/** S02 Create account — registration, adult eligibility (18+ pilot), terms, required consent and verification. */
export default function SignUp() {
  const p = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const resend = async () => {
    setBusy(true);
    try {
      const { error: e } = await supabase().auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: Linking.createURL('auth/callback') } });
      if (e) throw e;
      setNotice('Sent again. It can take a minute to arrive.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen
        maxWidth={520}
        footer={
          <>
            <Button label="Go to log in" size="lg" arrow onPress={() => router.replace('/sign-in')} />
            <Button label="Send the email again" variant="ghost" onPress={() => void resend()} loading={busy} />
          </>
        }>
        <View style={{ alignItems: 'flex-start', gap: spacing.lg, marginTop: spacing.xxxl }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mail" color={p.primary} size={40} />
          </View>
          <Txt variant="title">Check your email</Txt>
          <Txt>We sent a verification link to {email.trim()}. Open it on this device to finish creating your account.</Txt>
          <Txt variant="caption">The link expires. If it does not arrive, check spam or send it again.</Txt>
          {notice ? <Banner tone="success" text={notice} /> : null}
          {error ? <Banner tone="danger" text={error} /> : null}
        </View>
      </Screen>
    );
  }

  const blocker = !adult ? 'Confirm you are 18 or older to continue.' : !terms ? 'Accept the Terms and Privacy Notice to continue.' : undefined;
  return (
    <Screen
      maxWidth={520}
      footer={
        <>
          <Button label="Create account" size="lg" arrow onPress={submit} loading={busy} disabled={!emailOk || !pwOk || !adult || !terms || busy} hint={blocker} />
          <Button label="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} />
        </>
      }>
      <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
      <View style={{ gap: spacing.xs }}>
        <Txt variant="title">Create your account</Txt>
        <Txt color="textMuted">A couple of minutes and you can start claiming ground.</Txt>
      </View>
      <SocialButtons intent="sign-up" />
      <View style={{ gap: spacing.lg }}>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType="next" error={email && !emailOk ? 'Enter a valid email address.' : undefined} />
        <TextField label="Password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="new-password" hint="At least 10 characters." error={password && !pwOk ? 'Use at least 10 characters.' : undefined} />
      </View>
      <ListGroup>
        <Toggle label="I am 18 or older" description="The pilot is for adults only." value={adult} onChange={setAdult} />
        <Toggle label="I accept the Terms and Privacy Notice" description={`Version ${LEGAL_VERSION}. Competition, analytics and health choices are asked separately later.`} value={terms} onChange={setTerms} />
      </ListGroup>
      {legalAvailable ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.xl }}>
          <ArrowLink label="Read the Terms" onPress={() => void RNLinking.openURL(env.termsUrl!)} />
          <ArrowLink label="Read the Privacy Notice" onPress={() => void RNLinking.openURL(env.privacyUrl!)} />
        </View>
      ) : (
        <Banner tone="warning" text="The reviewed Terms and Privacy Notice are not published for this build yet (pilot draft). Do not invite real participants until they are." />
      )}
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
