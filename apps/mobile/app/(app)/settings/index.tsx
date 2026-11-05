import { useState } from 'react';
import { Linking } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { env } from '@/config/env';
import { cuePreferences, saveCuePreferences } from '@/lib/cues';
import { supabase } from '@/lib/supabase';
import { Button, Row, Screen, Section, Segmented, Toggle, Txt , confirm } from '@/components/ui';
import { useBillingConfig } from '@/billing/purchases';
import { useSession } from '@/state/session';

/** S43 Settings — units, accessibility, profile, notification, privacy, support and sign-out controls. */
export default function Settings() {
  const { userId, settings, refresh, signOut, roles } = useSession();
  const billing = useBillingConfig();
  const [cues, setCues] = useState(cuePreferences());
  const setUnits = async (units: 'metric' | 'imperial') => {
    await supabase().from('user_settings').update({ units }).eq('user_id', userId!);
    await refresh();
  };
  const updateCues = (p: Partial<typeof cues>) => {
    const next = { ...cues, ...p };
    setCues(next);
    void saveCuePreferences(next);
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Section title="Units">
        <Segmented label="Units" value={settings?.units ?? 'metric'} onChange={(v) => void setUnits(v)} options={[{ value: 'metric', label: 'Kilometres' }, { value: 'imperial', label: 'Miles' }]} />
      </Section>
      <Section title="Accessibility during runs">
        <Txt variant="caption">Every spoken cue is also shown as text on the recording screen.</Txt>
        <Toggle label="Spoken cues" description="Splits, loop closure, GPS changes and gaps are read aloud." value={cues.audio} onChange={(v) => updateCues({ audio: v })} />
        <Toggle label="Haptic cues" description="A vibration accompanies each cue." value={cues.haptics} onChange={(v) => updateCues({ haptics: v })} />
      </Section>
      <Section title="Account">
        <Row title="Edit profile" onPress={() => router.push('/settings/profile')} />
        <Row title="Privacy and protected areas" onPress={() => router.push('/settings/privacy')} />
        <Row title="Notifications" onPress={() => router.push('/settings/notifications')} />
        <Row title="Health connections" onPress={() => router.push('/health/connections')} />
        <Row title="Account and data" subtitle="Export, deletion, health cache" onPress={() => router.push('/settings/account')} />
        {billing.data?.paywallEnabled ? <Row title="Subscription" onPress={() => router.push('/settings/subscription')} /> : null}
      </Section>
      <Section title="Support">
        <Row title="Help and game rules" onPress={() => router.push('/help')} />
        <Row title="Reviews and appeals" onPress={() => router.push('/appeals')} />
        <Row title="My route proposals" onPress={() => router.push('/proposals')} />
        {env.supportEmail ? <Row title="Contact support" subtitle={env.supportEmail} onPress={() => void Linking.openURL(`mailto:${env.supportEmail}`)} /> : null}
        {roles.length ? <Row title="Operator tools" onPress={() => router.push('/ops')} /> : null}
      </Section>
      <Button variant="secondary" label="Sign out" onPress={() => confirm('Sign out?', 'Imported health data on this phone is cleared when you sign out. Runs waiting to upload stay on this phone for your account.', 'Sign out', () => void signOut(), false)} />
      <Txt variant="caption">Version {Constants.expoConfig?.version ?? '—'} · {env.appEnv}</Txt>
    </Screen>
  );
}
