import { useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPETITION_CONSENT_VERSION } from '@/config/env';
import { friendlyError, rpc } from '@/lib/api';
import { setAnalyticsConsent } from '@/lib/analytics';
import type { TablesUpdate } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Card, ChipGroup, ListGroup, Row, Screen, Section, Segmented, TextField, Toggle, Txt } from '@/components/ui';
import { useSession } from '@/state/session';

interface ProtectedArea {
  id: string;
  label: string | null;
  radius_m: number;
  created_at: string;
}

/** S44 Privacy and protected areas — post defaults, profile/follow and message rules, masks, full-private mode, health boundaries. */
export default function Privacy() {
  const { userId, profile, settings, refresh } = useSession();
  const qc = useQueryClient();
  const [label, setLabel] = useState('Home');
  const [radius, setRadius] = useState<'200' | '500' | '1000'>('500');
  const areas = useQuery({
    queryKey: ['protected_areas'],
    queryFn: async () => {
      const { data, error } = await supabase().from('protected_areas').select('id, label, radius_m, created_at').order('created_at');
      if (error) throw error;
      return (data ?? []) as ProtectedArea[];
    }
  });
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => {
      await fn();
      await refresh();
    },
    onError: (e) => Alert.alert('Not saved', friendlyError(e))
  });
  const updateSettings = (patch: TablesUpdate<'user_settings'>) => run.mutate(async () => {
    const { error } = await supabase().from('user_settings').update(patch).eq('user_id', userId!);
    if (error) throw error;
  });
  const updateProfile = (patch: TablesUpdate<'profiles'>) => run.mutate(async () => {
    const { error } = await supabase().from('profiles').update(patch).eq('id', userId!);
    if (error) throw error;
  });

  const addArea = async () => {
    if (!userId) return;
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return Alert.alert('Location needed', 'Allow location to place a protected area where you are now.');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { error } = await supabase().from('protected_areas').insert({ user_id: userId, label: label.trim() || null, center: `SRID=4326;POINT(${pos.coords.longitude} ${pos.coords.latitude})`, radius_m: Number(radius) });
    if (error) return Alert.alert('Not added', friendlyError(error));
    void qc.invalidateQueries({ queryKey: ['protected_areas'] });
  };
  const removeArea = async (id: string) => {
    const { error } = await supabase().from('protected_areas').delete().eq('id', id);
    if (error) Alert.alert('Not removed', friendlyError(error));
    void qc.invalidateQueries({ queryKey: ['protected_areas'] });
  };

  if (!settings || !profile) return null;
  const fullPrivate = settings.full_private_mode;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Privacy' }} />
      <Section title="Full private mode" icon="lock">
        <ListGroup>
        <Toggle
          label="Full private mode"
          description="Hides you from Discover and turns off territory and route titles (your land and titles are withdrawn). Recording and your private history keep working."
          value={fullPrivate}
          onChange={(v) =>
            v
              ? Alert.alert('Turn on full private mode?', 'Your current land and route titles will be withdrawn and recalculated for everyone affected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn on', style: 'destructive', onPress: () => run.mutate(() => rpc('set_full_private_mode', { p_enabled: true })) }])
              : run.mutate(() => rpc('set_full_private_mode', { p_enabled: false }))
          }
        />
        </ListGroup>
      </Section>
      <Section title="Competition" icon="trophy">
        <ListGroup>
        <Toggle label="Take part in territory" description="Eligible loops in competitive runs can claim land. Turning this off withdraws your land." value={settings.territory_competition_enabled} disabled={fullPrivate} onChange={(v) => run.mutate(() => rpc('set_consent', { p_kind: 'territory_competition', p_granted: v, p_version: COMPETITION_CONSENT_VERSION }))} />
        <Toggle label="Take part in route titles" description="Timed attempts on approved routes can earn titles. Turning this off withdraws your titles." value={settings.speed_competition_enabled} disabled={fullPrivate} onChange={(v) => run.mutate(() => rpc('set_consent', { p_kind: 'speed_competition', p_granted: v, p_version: COMPETITION_CONSENT_VERSION }))} />
        </ListGroup>
      </Section>
      <Section title="Profile and posts" icon="user">
        <ChipGroup label="Profile visibility" value={profile.visibility} onChange={(v) => updateProfile({ visibility: v, discoverable: v === 'public' ? profile.discoverable : false })} options={[{ value: 'private', label: 'Private', icon: 'lock' }, { value: 'public', label: 'Public', icon: 'globe' }]} />
        {profile.visibility === 'public' ? <ListGroup><Toggle label="Show me in Discover" value={profile.discoverable} disabled={fullPrivate} onChange={(v) => updateProfile({ discoverable: v })} /></ListGroup> : null}
        <ChipGroup label="Default audience for new posts" value={settings.default_post_audience} onChange={(v) => updateSettings({ default_post_audience: v })} options={[{ value: 'only_me', label: 'Only me', icon: 'lock' }, { value: 'followers', label: 'Followers', icon: 'clubs' }, { value: 'public', label: 'Public', icon: 'globe' }]} />
      </Section>
      <Section title="Messages" icon="chat">
        <ChipGroup label="Who can message you" value={settings.messages_from} onChange={(v) => updateSettings({ messages_from: v })} options={[{ value: 'mutual', label: 'Mutual followers' }, { value: 'followers', label: 'My followers' }, { value: 'nobody', label: 'Nobody' }]} />
        <Txt variant="caption">Online status and read receipts are never shown, and notification previews never include message text.</Txt>
      </Section>
      <Section title="Protected areas" icon="shield">
        <Txt variant="caption">Competitive results that touch a protected area (for example around your home) are withheld, so your routine is not revealed on the map. Your private history still records the run.</Txt>
        {areas.data?.length ? (
          <ListGroup>
            {areas.data.map((a) => <Row key={a.id} icon="shield" title={a.label ?? 'Protected area'} subtitle={`${a.radius_m} m radius`} right={<Button variant="ghost" size="sm" label="Remove" onPress={() => void removeArea(a.id)} />} />)}
          </ListGroup>
        ) : null}
        <Card>
          <TextField label="Label" value={label} onChangeText={setLabel} maxLength={40} />
          <Segmented label="Radius" value={radius} onChange={setRadius} options={[{ value: '200', label: '200 m' }, { value: '500', label: '500 m' }, { value: '1000', label: '1 km' }]} />
          <Button variant="secondary" icon="pin" label="Protect the area where I am now" onPress={() => void addArea()} />
        </Card>
      </Section>
      <Section title="Analytics" icon="progress">
        <ListGroup>
        <Toggle label="Share anonymous usage analytics" description="Never includes GPS, health readings, messages or anything you write." value={settings.analytics_enabled} onChange={(v) => run.mutate(async () => { await rpc('set_consent', { p_kind: 'analytics', p_granted: v, p_version: 'v1' }); await setAnalyticsConsent(v); })} />
        </ListGroup>
      </Section>
      <Section title="Health data" icon="heart">
        <Banner text="Imported health data and health summaries stay on this phone. They are never uploaded to our servers, shared with other runners, sent to analytics or crash reporting, or used for competition." />
      </Section>
    </Screen>
  );
}
