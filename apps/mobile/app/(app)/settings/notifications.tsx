import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Banner, Button, ErrorState, LoadingState, Screen, Section, Segmented, Toggle, Txt } from '@/components/ui';
import { notificationPermission, registerPushToken, requestNotificationPermission } from '@/notifications/push';
import { useSession } from '@/state/session';

interface Prefs {
  social: boolean;
  messages: boolean;
  clubs: boolean;
  competitive_digest: boolean;
  territory_loss: boolean;
  marketing: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  timezone: string;
}

const HOURS = ['none', '21:00', '22:00', '23:00'] as const;
const ENDS = ['06:00', '07:00', '08:00'] as const;

/** S45 Notification preferences — separate social, message, club and contest settings; quiet hours, mutes and digests. */
export default function NotificationSettings() {
  const { userId } = useSession();
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const prefs = useQuery({
    queryKey: ['notification_prefs', userId],
    queryFn: async () => {
      const { data, error } = await supabase().from('notification_prefs').select('*').eq('user_id', userId!).single();
      if (error) throw error;
      return data as Prefs;
    }
  });
  useEffect(() => {
    void notificationPermission().then(setPerm);
  }, []);
  const update = async (patch: Partial<Prefs>) => {
    const { error } = await supabase().from('notification_prefs').update({ ...patch, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).eq('user_id', userId!);
    if (error) Alert.alert('Not saved', friendlyError(error));
    void prefs.refetch();
  };
  if (prefs.isLoading) return <LoadingState />;
  if (prefs.error || !prefs.data) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />;
  const p = prefs.data;
  const quietStart = p.quiet_start ? p.quiet_start.slice(0, 5) : 'none';
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {perm !== 'granted' ? (
        <Banner
          tone="info"
          text="Push notifications are off on this phone. Updates still appear in the in-app list."
          action={perm === 'denied' ? { label: 'Open settings', onPress: () => void Linking.openSettings() } : { label: 'Turn on', onPress: () => void requestNotificationPermission().then(async (ok) => { if (ok && userId) await registerPushToken(userId); setPerm(await notificationPermission()); }) }}
        />
      ) : null}
      <Section title="Push categories">
        <Toggle label="Social" description="Follow requests, new followers, comments, cheers and mentions." value={p.social} onChange={(v) => void update({ social: v })} />
        <Toggle label="Messages" description="New direct messages. Previews never include message text." value={p.messages} onChange={(v) => void update({ messages: v })} />
        <Toggle label="Clubs" description="Invitations and membership decisions." value={p.clubs} onChange={(v) => void update({ clubs: v })} />
        <Toggle label="Daily competition digest" description="At most one aggregated territory and route-title update per day." value={p.competitive_digest} onChange={(v) => void update({ competitive_digest: v })} />
        <Toggle label="Include land losses in the digest" value={p.territory_loss} disabled={!p.competitive_digest} onChange={(v) => void update({ territory_loss: v })} />
        <Toggle label="Product news" description="Off by default." value={p.marketing} onChange={(v) => void update({ marketing: v })} />
      </Section>
      <Section title="Quiet hours">
        <Segmented label="Quiet from" value={quietStart} onChange={(v) => void update(v === 'none' ? { quiet_start: null, quiet_end: null } : { quiet_start: `${v}:00`, quiet_end: p.quiet_end ?? '07:00:00' })} options={HOURS.map((h) => ({ value: h, label: h === 'none' ? 'Off' : h }))} />
        {quietStart !== 'none' ? <Segmented label="Quiet until" value={(p.quiet_end ?? '07:00').slice(0, 5)} onChange={(v) => void update({ quiet_end: `${v}:00` })} options={ENDS.map((h) => ({ value: h, label: h }))} /> : null}
        <Txt variant="caption">During quiet hours, pushes are held; everything still appears in the notification list. Time zone: {p.timezone}.</Txt>
      </Section>
      <Txt variant="caption">Mute individual runners from their profile, and individual conversations from the conversation menu.</Txt>
      {perm === 'granted' ? <Button variant="ghost" label="Re-register this phone for notifications" onPress={() => userId && void registerPushToken(userId)} /> : null}
    </Screen>
  );
}
