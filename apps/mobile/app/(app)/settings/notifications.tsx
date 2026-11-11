import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Banner, Button, ChipGroup, ErrorState, ListGroup, LoadingState, Screen, Section, Toggle, Txt } from '@/components/ui';
import { notificationPermission, registerPushToken, requestNotificationPermission } from '@/notifications/push';
import { useSession } from '@/state/session';

interface Prefs {
  social: boolean;
  messages: boolean;
  clubs: boolean;
  competitive_digest: boolean;
  territory_loss: boolean;
  marketing: boolean;
  run_results: boolean;
  friend_runs: boolean;
  events: boolean;
  email_runs: boolean;
  email_territory: boolean;
  email_clubs: boolean;
  email_events: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  timezone: string;
}

const HOURS = ['none', '21:00', '22:00', '23:00'] as const;
const ENDS = ['06:00', '07:00', '08:00'] as const;

/**
 * S45 Notification preferences: what is pushed (social, messages, communities, your results, events, the
 * daily land update), what is emailed (account and security email always), quiet hours and mutes.
 * Everything still appears in the in-app list.
 */
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
      <Section title="Push notifications" icon="bell">
        <ListGroup>
        <Toggle label="Social" description="Follow requests, new followers, comments, cheers and mentions." value={p.social} onChange={(v) => void update({ social: v })} />
        <Toggle label="Runs your friends share" description="When someone you follow, who follows you back, shares a run. Off by default." value={p.friend_runs} disabled={!p.social} onChange={(v) => void update({ friend_runs: v })} />
        <Toggle label="Messages" description="New direct messages. Previews never include message text." value={p.messages} onChange={(v) => void update({ messages: v })} />
        <Toggle label="Communities and groups" description="Invitations, new members, announcements and decisions." value={p.clubs} onChange={(v) => void update({ clubs: v })} />
        <Toggle label="Your runs and badges" description="When your run's land is on the map, new badges and points refunds." value={p.run_results} onChange={(v) => void update({ run_results: v })} />
        <Toggle label="Events and challenges" description="Reminders the day before, cancellations and results." value={p.events} onChange={(v) => void update({ events: v })} />
        <Toggle label="Daily land update" description="At most one land and route-title summary a day. Land other runners take is never pushed one by one." value={p.competitive_digest} onChange={(v) => void update({ competitive_digest: v })} />
        <Toggle label="Product news" description="Off by default." value={p.marketing} onChange={(v) => void update({ marketing: v })} />
        </ListGroup>
      </Section>
      <Section title="Land changes" icon="hexagon">
        <ListGroup>
          <Toggle label="Tell me when I lose land" description="Show land other runners take from you in the list and the daily update. Turn off to only hear about land you capture." value={p.territory_loss} onChange={(v) => void update({ territory_loss: v })} />
        </ListGroup>
        <Txt variant="caption">Land changes appear after a delay and never name the other runner or say where anyone is right now.</Txt>
      </Section>
      <Section title="Email" icon="mail">
        <ListGroup>
          <Toggle label="Run summaries" description="Distance, time, pace and land after each run, once its land is published. Off by default." value={p.email_runs} onChange={(v) => void update({ email_runs: v })} />
          <Toggle label="Daily land email" description="Land you captured and lost, at most once a day. Off by default." value={p.email_territory} onChange={(v) => void update({ email_territory: v })} />
          <Toggle label="Communities and groups" description="Invitations, approved requests, ownership offers and closures." value={p.email_clubs} onChange={(v) => void update({ email_clubs: v })} />
          <Toggle label="Events and results" description="Confirmation when you join, a reminder the day before and the final results." value={p.email_events} onChange={(v) => void update({ email_events: v })} />
        </ListGroup>
        <Txt variant="caption">Account and security email (sign-in links, password, email and sign-in method changes, account deletion) is always sent. Emails never include heart rate, routes or exact places.</Txt>
      </Section>
      <Section title="Quiet hours" icon="moon">
        <ChipGroup label="Quiet from" value={quietStart} onChange={(v) => void update(v === 'none' ? { quiet_start: null, quiet_end: null } : { quiet_start: `${v}:00`, quiet_end: p.quiet_end ?? '07:00:00' })} options={HOURS.map((h) => ({ value: h, label: h === 'none' ? 'Off' : h }))} />
        {quietStart !== 'none' ? <ChipGroup label="Quiet until" value={(p.quiet_end ?? '07:00').slice(0, 5)} onChange={(v) => void update({ quiet_end: `${v}:00` })} options={ENDS.map((h) => ({ value: h, label: h }))} /> : null}
        <Txt variant="caption">During quiet hours, pushes are held; everything still appears in the notification list. Time zone: {p.timezone}.</Txt>
      </Section>
      <Txt variant="caption">Mute individual runners from their profile, and individual conversations from the conversation menu.</Txt>
      {perm === 'granted' ? <Button variant="ghost" icon="refresh" label="Re-register this phone for notifications" onPress={() => userId && void registerPushToken(userId)} /> : null}
    </Screen>
  );
}
