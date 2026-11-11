import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, Button, Card, EmptyState, Txt } from '@/components/ui';
import { LoopMark, Wordmark } from '@/components/Brand';
import { env } from '@/config/env';
import { useSession } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

const LABEL: Record<string, string> = { runs: 'run summary', territory: 'daily land', clubs: 'community and group', events: 'event' };

/**
 * Opened from "Stop these emails" in an optional email (signed in or not). Opening the page changes
 * nothing; the button does, using the private link token. Account and security email cannot be stopped.
 */
export default function Unsubscribe() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { t, c } = useLocalSearchParams<{ t?: string; c?: string }>();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const label = c ? LABEL[c] : undefined;

  const stop = async () => {
    setState('busy');
    try {
      const res = await fetch(`${env.supabaseUrl}/functions/v1/email/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey ?? '' },
        body: JSON.stringify({ token: t, category: c })
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ title: 'Email settings' }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.huge, paddingHorizontal: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <LoopMark size={30} />
          <Wordmark size={22} />
        </View>
        {!t || !label ? (
          <EmptyState icon="mail" title="This link is not complete" body="Open the link from the email again, or change which emails you get in Settings → Notifications." />
        ) : state === 'done' ? (
          <Card>
            <Txt variant="title">{`No more ${label} emails`}</Txt>
            <Txt color="textMuted">You can switch them back on at any time in Settings → Notifications. Account and security email is still sent.</Txt>
          </Card>
        ) : (
          <Card>
            <Txt variant="title">{`Stop ${label} emails?`}</Txt>
            <Txt color="textMuted">Other emails you get stay as they are. Account and security email (sign-in links, password and email changes) is always sent.</Txt>
            {state === 'error' ? <Banner tone="danger" text="That did not work. The link may be out of date; change your emails in Settings → Notifications instead." /> : null}
            <Button label="Stop these emails" onPress={() => void stop()} loading={state === 'busy'} />
          </Card>
        )}
        {session ? <Button variant="ghost" label="Open notification settings" onPress={() => router.replace('/settings/notifications')} /> : null}
      </ScrollView>
    </View>
  );
}
