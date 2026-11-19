import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SvgXml } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { Banner, Button, Card, EmptyState, LoadingState, Screen, TextField, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { radius, spacing, usePalette } from '@/theme/tokens';

/** Operator permissions (granted through back-office roles; admins hold all of them). */
export type Permission =
  | 'moderation' | 'integrity' | 'routes' | 'territory' | 'rules.edit' | 'rules.apply' | 'users.view' | 'users.manage'
  | 'support' | 'analytics' | 'sql' | 'config' | 'monetization' | 'jobs' | 'audit' | 'staff';

/** Whether these permissions open a tool that needs any one of `need` ('any' = any operator permission). */
export function allowed(permissions: readonly string[], need: Permission | readonly Permission[] | 'any'): boolean {
  if (need === 'any') return permissions.length > 0;
  const list: readonly string[] = typeof need === 'string' ? [need] : need;
  return list.some((p) => permissions.includes(p));
}

/** The session's assurance level: aal2 once an authenticator code was entered in this session. */
export function useAssuranceLevel(userId: string | null) {
  return useQuery({
    queryKey: ['mfa_aal', userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data.currentLevel ?? 'aal1';
    }
  });
}

/**
 * Every operator screen opens through this gate. It shows the tool only to staff holding one of the
 * permissions it needs, and only in a session verified with a code from the staff member's authenticator
 * app (aal2), enrolling one first if they have none. The back office can then require aal2 for every
 * operator function (`ops_require_mfa`); the server checks roles and the code either way.
 */
export function StaffGate({ need, title, children }: { need: Permission | readonly Permission[] | 'any'; title: string; children: ReactNode }) {
  const { staff, userId } = useSession();
  const qc = useQueryClient();
  const aal = useAssuranceLevel(userId);
  if (!allowed(staff.permissions, need)) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState icon="shield" title={staff.permissions.length ? 'Not part of your role' : 'Staff only'} body={staff.permissions.length ? 'Your role does not include this tool. An admin can change that in the back office.' : 'Operator tools are for Loopfield staff.'} />
      </Screen>
    );
  }
  if (aal.isLoading) return <Screen><Stack.Screen options={{ title }} /><LoadingState /></Screen>;
  if (aal.data !== 'aal2') return <AuthenticatorCode title={title} onVerified={() => void qc.invalidateQueries({ queryKey: ['mfa_aal'] })} />;
  return <>{children}</>;
}

type Totp = { id: string; qr: string; secret: string; uri: string };

/** Supabase returns the QR code as SVG markup (older versions as a data URL). */
export function qrSvg(qr: string): string {
  const prefix = /^data:image\/svg\+xml;(utf-8|utf8|charset=utf-8),/i;
  if (!prefix.test(qr)) return qr;
  const body = qr.replace(prefix, '');
  try {
    return body.trimStart().startsWith('<') ? body : decodeURIComponent(body);
  } catch {
    return body;
  }
}

const CODE_HELP = 'Codes change every 30 seconds, so enter the newest one. If codes keep failing, make sure the time on this phone is set automatically.';

/** Asks for the 6-digit code, enrolling an authenticator first when the account has none. */
export function AuthenticatorCode({ title, onVerified }: { title: string; onVerified: () => void }) {
  const p = usePalette();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'intro' | 'enrol' | 'code'>('loading');
  const [enrol, setEnrol] = useState<Totp | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void supabase()
      .auth.mfa.listFactors()
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) {
          setError(e.message);
          setPhase('intro');
          return;
        }
        const verified = [...(data?.totp ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        setFactorId(verified?.id ?? null);
        setPhase(verified ? 'code' : 'intro');
      });
    return () => {
      live = false;
    };
  }, []);

  const startEnrol = async () => {
    setBusy(true);
    setError(null);
    try {
      const mfa = supabase().auth.mfa;
      // A setup that was started and never finished leaves an unverified factor behind; clear it first.
      const listed = await mfa.listFactors();
      for (const f of listed.data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await mfa.unenroll({ factorId: f.id });
      }
      let res = await mfa.enroll({ factorType: 'totp', friendlyName: 'Loopfield app', issuer: 'Loopfield' });
      if (res.error && /friendly name/i.test(res.error.message)) {
        res = await mfa.enroll({ factorType: 'totp', friendlyName: `Loopfield app ${new Date().toISOString().slice(0, 16)}`, issuer: 'Loopfield' });
      }
      if (res.error) throw res.error;
      setEnrol({ id: res.data.id, qr: res.data.totp.qr_code, secret: res.data.totp.secret, uri: res.data.totp.uri });
      setFactorId(res.data.id);
      setPhase('enrol');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The authenticator could not be set up. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (e) {
      setCode('');
      setError(/invalid|expired|code/i.test(e.message) ? 'That code did not work. Enter the newest code your authenticator app shows.' : e.message);
      return;
    }
    onVerified();
  };

  const codeField = (
    <>
      <TextField label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" autoFocus={phase === 'code'} returnKeyType="done" onSubmitEditing={() => code.length === 6 && void verify()} />
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button label="Verify" icon="shield" onPress={() => void verify()} loading={busy} disabled={code.length !== 6 || busy} />
    </>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.pill, backgroundColor: p.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" color={p.primary} size={24} />
        </View>
        <Txt variant="headline" style={{ flex: 1 }} accessibilityRole="header">{phase === 'enrol' || phase === 'intro' ? 'Set up your authenticator' : 'Enter your authenticator code'}</Txt>
      </View>
      {phase === 'loading' ? <LoadingState /> : null}
      {phase === 'code' ? (
        <Card>
          <Txt>Operator tools need a code from the authenticator app you use for the Loopfield back office. You enter it once per session.</Txt>
          {codeField}
          <Txt variant="caption">{CODE_HELP}</Txt>
        </Card>
      ) : null}
      {phase === 'intro' ? (
        <Card>
          <Txt>Operator tools need a code from an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password. Set it up once; after that you enter a code from it when you open these tools.</Txt>
          {error ? <Banner tone="danger" text={error} /> : null}
          <Button label="Set up authenticator" icon="shield" onPress={() => void startEnrol()} loading={busy} />
        </Card>
      ) : null}
      {phase === 'enrol' && enrol ? (
        <Card>
          <Txt variant="label">1. Add Loopfield to your authenticator app</Txt>
          <Button variant="secondary" icon="external" label="Open authenticator app" onPress={() => void Linking.openURL(enrol.uri).catch(() => setShowKey(true))} />
          <Txt variant="caption">Or scan this code with the app on another device:</Txt>
          <View style={{ alignSelf: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: '#FFFFFF' }} accessible accessibilityRole="image" accessibilityLabel="QR code for your authenticator app">
            <SvgXml xml={qrSvg(enrol.qr)} width={180} height={180} />
          </View>
          <Pressable onPress={() => setShowKey(!showKey)} accessibilityRole="button" accessibilityLabel={showKey ? 'Hide the setup key' : 'Show the setup key to type in'} hitSlop={6} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Txt variant="label" color="primary">{showKey ? 'Hide the setup key' : 'Type a key instead'}</Txt>
          </Pressable>
          {showKey ? <Txt selectable tabular accessibilityLabel={`Setup key ${enrol.secret.split('').join(' ')}`}>{enrol.secret.replace(/(.{4})/g, '$1 ').trim()}</Txt> : null}
          <Txt variant="label">2. Enter the 6-digit code it shows</Txt>
          {codeField}
        </Card>
      ) : null}
    </Screen>
  );
}
