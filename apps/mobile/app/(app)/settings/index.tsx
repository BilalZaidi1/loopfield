import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { env } from '@/config/env';
import { cuePreferences, saveCuePreferences } from '@/lib/cues';
import { supabase } from '@/lib/supabase';
import { Button, confirm, ListGroup, PressableScale, Row, Screen, Section, Segmented, Toggle, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { radius, spacing, themes, useTheme, useThemeMode, type ThemeMode } from '@/theme/tokens';
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
      <Section title="Appearance" icon="sun" subtitle="Saved on this device">
        <ThemePicker />
      </Section>
      <Section title="Units" icon="route">
        <Segmented label="Units" value={settings?.units ?? 'metric'} onChange={(v) => void setUnits(v)} options={[{ value: 'metric', label: 'Kilometres' }, { value: 'imperial', label: 'Miles' }]} />
      </Section>
      <Section title="During runs" icon="volume" subtitle="Every spoken cue is also shown as text on the recording screen.">
        <ListGroup>
          <Toggle label="Spoken cues" description="Splits, loop closure, GPS changes and gaps are read aloud." value={cues.audio} onChange={(v) => updateCues({ audio: v })} />
          <Toggle label="Haptic cues" description="A vibration accompanies each cue." value={cues.haptics} onChange={(v) => updateCues({ haptics: v })} />
        </ListGroup>
      </Section>
      <Section title="Account" icon="user">
        <ListGroup>
          <Row icon="edit" title="Edit profile" onPress={() => router.push('/settings/profile')} />
          <Row icon="shield" title="Privacy and protected areas" onPress={() => router.push('/settings/privacy')} />
          <Row icon="bell" title="Notifications" onPress={() => router.push('/settings/notifications')} />
          <Row icon="heart" title="Health connections" onPress={() => router.push('/health/connections')} />
          <Row icon="lock" title="Account and data" subtitle="Export, deletion, health cache" onPress={() => router.push('/settings/account')} />
          {billing.data?.paywallEnabled ? <Row icon="star" title="Subscription" onPress={() => router.push('/settings/subscription')} /> : null}
        </ListGroup>
      </Section>
      <Section title="Support" icon="help">
        <ListGroup>
          <Row icon="help" title="Help and game rules" onPress={() => router.push('/help')} />
          <Row icon="sparkle" title="Replay the app tour" onPress={() => router.push('/tour')} />
          <Row icon="flag" title="Reviews and appeals" onPress={() => router.push('/appeals')} />
          <Row icon="route" title="My route proposals" onPress={() => router.push('/proposals')} />
          {env.supportEmail ? <Row icon="mail" title="Contact support" subtitle={env.supportEmail} onPress={() => void Linking.openURL(`mailto:${env.supportEmail}`)} /> : null}
          {roles.length ? <Row icon="shield" title="Operator tools" onPress={() => router.push('/ops')} /> : null}
        </ListGroup>
      </Section>
      <Button variant="danger" icon="logout" label="Sign out" onPress={() => confirm('Sign out?', 'Imported health data on this phone is cleared when you sign out. Runs waiting to upload stay on this phone for your account.', 'Sign out', () => void signOut(), false)} />
      <Txt variant="caption" align="center">Version {Constants.expoConfig?.version ?? '—'} · {env.appEnv}</Txt>
    </Screen>
  );
}

/** System / Light / Dark, each with a small preview of what it looks like. */
function ThemePicker() {
  const { mode, setMode, scheme } = useThemeMode();
  const t = useTheme();
  const options: { value: ThemeMode; label: string; icon: IconName; preview: 'light' | 'dark' | 'split' }[] = [
    { value: 'system', label: 'System', icon: 'device', preview: 'split' },
    { value: 'light', label: 'Light', icon: 'sun', preview: 'light' },
    { value: 'dark', label: 'Dark', icon: 'moon', preview: 'dark' }
  ];
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }} accessibilityRole="radiogroup" accessibilityLabel="Theme">
      {options.map((o) => {
        const selected = mode === o.value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => setMode(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.value === 'system' ? `System, currently ${scheme}` : o.label}
            style={{ flex: 1, borderRadius: radius.lg, borderWidth: 2, borderColor: selected ? t.palette.primary : 'transparent', backgroundColor: t.palette.surface, padding: spacing.sm, gap: spacing.sm }}>
            <ThemePreview kind={o.preview} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingBottom: spacing.xs }}>
              <Icon name={selected ? 'check' : o.icon} color={selected ? t.palette.primary : t.palette.textMuted} size={16} strokeWidth={selected ? 2.6 : 2} />
              <Txt variant="label" style={selected ? { color: t.palette.onPrimarySoft } : undefined}>{o.label}</Txt>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

function ThemePreview({ kind }: { kind: 'light' | 'dark' | 'split' }) {
  const half = (scheme: 'light' | 'dark') => {
    const p = themes[scheme].palette;
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 6, gap: 4 }}>
        <View style={{ height: 16, borderRadius: 5, backgroundColor: p.primaryFill }} />
        <View style={{ height: 10, borderRadius: 4, backgroundColor: p.surface }} />
        <View style={{ height: 10, width: '70%', borderRadius: 4, backgroundColor: p.surface }} />
      </View>
    );
  };
  return (
    <View style={{ height: 64, borderRadius: radius.sm, overflow: 'hidden', flexDirection: 'row' }} accessible={false}>
      {kind === 'split' ? (
        <>
          {half('light')}
          {half('dark')}
        </>
      ) : (
        half(kind)
      )}
    </View>
  );
}
