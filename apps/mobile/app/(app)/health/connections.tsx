import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { track } from '@/lib/analytics';
import { fmtRelative } from '@/lib/format';
import { Badge, Banner, Button, Card, ListGroup, LoadingState, Screen, Section, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing } from '@/theme/tokens';
import type { HealthCardId } from '@/health/cache';
import { openHealthConnectSettings } from '@/health/healthconnect';
import { clearHealthData, connectHealth, disconnectHealth, platformAvailability, PLATFORM_LABEL, setEnabledCards, syncHealth, UNAVAILABLE_BADGE, UNAVAILABLE_TEXT, type Availability } from '@/health/sync';
import { useHealthConnection } from '@/health/useHealth';

const CARDS: { id: HealthCardId; label: string }[] = [
  { id: 'workouts', label: 'Workouts (always needed to avoid duplicate runs)' },
  { id: 'heart_rate', label: 'Heart rate' },
  { id: 'zones', label: 'Heart rate zones' },
  { id: 'steps', label: 'Steps' },
  { id: 'calories', label: 'Active calories' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'resting_hr', label: 'Resting heart rate' },
  { id: 'hrv', label: 'Heart rate variability' },
  { id: 'vo2_max', label: 'VO₂ max estimate' },
  ...(Platform.OS === 'android' ? [{ id: 'cadence' as const, label: 'Cadence' }] : []),
  { id: 'elevation', label: Platform.OS === 'ios' ? 'Flights climbed (as elevation)' : 'Elevation gained' }
];

/** S40 Health connections — platform, enabled types, sync, history limits, disconnect and clear data. */
export default function HealthConnections() {
  const conn = useHealthConnection();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [cards, setCards] = useState<HealthCardId[]>(conn.enabledCards.length ? conn.enabledCards : ['workouts', 'heart_rate', 'steps', 'sleep']);
  const [exportOn, setExportOn] = useState(conn.exportEnabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void platformAvailability().then(setAvailability);
    track('health_viewed', { screen: 'connections', session_count: 0 });
  }, []);
  const toggle = (id: HealthCardId) => (v: boolean) => setCards((c) => (v ? [...new Set([...c, id])] : c.filter((x) => x !== id || id === 'workouts')));

  const connect = async () => {
    setBusy(true);
    try {
      await connectHealth(cards.includes('workouts') ? cards : ['workouts', ...cards], exportOn);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = () =>
    Alert.alert(`Disconnect ${PLATFORM_LABEL}?`, 'Syncing stops and every imported reading and summary is deleted from this phone. Your data in the health app itself is not changed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          const r = await disconnectHealth();
          if (!r.revokedInApp && Platform.OS === 'ios') Alert.alert('One more step', 'To fully remove access, open Settings → Health → Data Access & Devices and turn off this app.');
        }
      }
    ]);

  const available = availability === 'available';
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Health connections' }} />
      <Card tone="green" accessibilityLabel="Connection status">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="heart" color="#121318" size={22} />
          <Txt variant="heading" style={{ flex: 1 }}>{PLATFORM_LABEL}</Txt>
          <Badge label={availability === 'unavailable' ? UNAVAILABLE_BADGE : availability === 'needs_update' ? 'Needs an update' : conn.connected ? 'Connected' : 'Not connected'} />
        </View>
        <Txt color="textMuted">Imported health data stays on this phone in protected storage, is excluded from backups and is never uploaded, shared or used for competition.</Txt>
        {conn.lastSyncAt ? <Txt variant="caption">Last synced {fmtRelative(new Date(conn.lastSyncAt).toISOString())}{conn.lastResult && conn.lastResult !== 'ok' ? ` · ${conn.lastResult.replace('_', ' ')}` : ''}</Txt> : null}
        {conn.historyLimitedTo ? <Txt variant="caption">History limit: the most recent {conn.historyLimitedTo} days{Platform.OS === 'android' ? ' (Health Connect allows 30 days unless extra history access is granted; this release does not ask for it)' : ''}.</Txt> : null}
      </Card>
      {availability === 'needs_update' ? <Banner tone="warning" text="Install or update Health Connect from Google Play, then come back." action={{ label: 'Open Play Store', onPress: () => void Linking.openURL('market://details?id=com.google.android.apps.healthdata') }} /> : null}
      {availability === 'unavailable' ? <Banner tone="info" text={UNAVAILABLE_TEXT} /> : null}
      {availability === null ? <LoadingState rows={2} /> : null}
      {available ? (
        <Section title="Data types" icon="pulse" subtitle={`Only the types you choose are requested. You can change permissions later in ${Platform.OS === 'ios' ? 'Settings → Health' : 'Health Connect'}.`}>
          <ListGroup>
            {CARDS.map((c) => <Toggle key={c.id} label={c.label} value={cards.includes(c.id)} onChange={toggle(c.id)} disabled={c.id === 'workouts'} />)}
          </ListGroup>
          <ListGroup>
            <Toggle label="Save runs recorded here to the health app" description="Optional and separate. Saves only start, end and distance — never your route or competition results." value={exportOn} onChange={setExportOn} />
          </ListGroup>
        </Section>
      ) : null}
      {available ? (
        conn.connected ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Update data types" icon="check" onPress={() => { setEnabledCards(cards); void connect(); }} loading={busy} />
            <Button variant="secondary" icon="refresh" label="Sync now" onPress={() => void syncHealth()} />
            {Platform.OS === 'android' ? <Button variant="ghost" label="Open Health Connect permissions" onPress={openHealthConnectSettings} /> : null}
            <Button variant="ghost" icon="trash" label="Clear imported data from this phone" onPress={() => Alert.alert('Clear imported data?', 'Deletes cached readings and summaries. The next sync imports them again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => void clearHealthData() }])} />
            <Button variant="danger" label={`Disconnect ${PLATFORM_LABEL}`} onPress={disconnect} />
          </View>
        ) : (
          <Button label={`Connect ${PLATFORM_LABEL}`} size="lg" arrow onPress={() => void connect()} loading={busy} />
        )
      ) : null}
    </Screen>
  );
}
