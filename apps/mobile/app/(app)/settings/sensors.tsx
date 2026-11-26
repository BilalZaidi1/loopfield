import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack } from 'expo-router';
import { track } from '@/lib/analytics';
import { fmtRelative } from '@/lib/format';
import { useFeature } from '@/lib/appConfig';
import { Banner, Button, Card, EmptyState, ListGroup, Row, Screen, Section, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PausedNote } from '@/components/Notices';
import { bluetoothInBuild, connectStrap, disconnectStrap, ensureBluetoothAccess, readStrapBattery, scanForStraps, type FoundStrap } from '@/features/sensors/ble';
import { pairStrap, savePairedStrap, usePairedStrap } from '@/features/sensors/strap';
import { batteryWords, signalWords, strapName } from '@/features/sensors/text';
import { spacing, usePalette } from '@/theme/tokens';

const SCAN_SECONDS = 10;
type Problem = 'denied' | 'off' | 'failed' | 'none_found';

/**
 * Settings → Sensors (R3): pair a Bluetooth heart-rate strap once and its heart rate shows during every run. Only
 * straps using the standard heart-rate service are listed. The pairing is kept on this phone; readings stay in
 * the phone's health data and are never uploaded.
 */
export default function Sensors() {
  const p = usePalette();
  const on = useFeature('ble_sensors_enabled');
  const { strap, loaded } = usePairedStrap();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundStrap[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const stopScan = useRef<(() => void) | null>(null);
  useEffect(() => () => stopScan.current?.(), []);

  if (!bluetoothInBuild()) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Sensors' }} />
        <EmptyState icon="heart" title="Needs the newer app" body="Heart-rate straps work in app builds that include Bluetooth. Update the app to pair one." />
      </Screen>
    );
  }

  const scan = async () => {
    setProblem(null);
    setFound([]);
    const access = await ensureBluetoothAccess();
    if (access !== 'granted') {
      setProblem(access === 'off' ? 'off' : 'denied');
      return;
    }
    setScanning(true);
    let any = false;
    try {
      stopScan.current = await scanForStraps(SCAN_SECONDS, (s) => {
        any = true;
        setFound((list) => [...list, s].sort((a, b) => b.rssi - a.rssi));
      }, () => {
        setScanning(false);
        stopScan.current = null;
        if (!any) setProblem('none_found');
      });
    } catch {
      setScanning(false);
      setProblem('failed');
    }
  };

  const pair = async (s: FoundStrap) => {
    stopScan.current?.();
    setBusyId(s.id);
    setProblem(null);
    try {
      await connectStrap(s.id);
      const battery = await readStrapBattery(s.id);
      await disconnectStrap(s.id);
      await pairStrap(s, battery);
      track('sensor', { action: 'paired' });
      setFound([]);
    } catch {
      await disconnectStrap(s.id);
      track('sensor', { action: 'connection_failed' });
      setProblem('failed');
    } finally {
      setBusyId(null);
    }
  };

  const forget = async () => {
    await savePairedStrap(null);
    track('sensor', { action: 'forgotten' });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Sensors' }} />
      {!on ? <PausedNote feature="ble_sensors_enabled" /> : null}
      <Section title="Heart-rate strap" icon="heart">
        <Txt variant="caption">Pair a chest strap once and your heart rate shows during every run. Any strap that uses the standard Bluetooth heart-rate service works. Readings stay on this phone, in its health data, and feed your effort score. They are never uploaded.</Txt>
        {loaded && strap ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="heart" color={p.danger} size={22} />
              <View style={{ flex: 1 }}>
                <Txt variant="heading">{strapName(strap.name)}</Txt>
                <Txt variant="caption">{batteryWords(strap.battery, strap.batteryAt ? fmtRelative(new Date(strap.batteryAt).toISOString()) : null)}</Txt>
              </View>
            </View>
            <Txt variant="caption">{on ? 'The phone connects to it by itself when a run starts.' : 'It is not connected while heart-rate straps are paused.'}</Txt>
            <Button variant="ghost" icon="trash" label="Forget this strap" onPress={() => void forget()} />
          </Card>
        ) : null}
        {on && loaded && !strap ? (
          <Button icon="plus" label={scanning ? 'Looking for straps…' : 'Add a heart-rate strap'} loading={scanning} disabled={scanning} onPress={() => void scan()} />
        ) : null}
        {found.length ? (
          <ListGroup>
            {found.map((s) => (
              <Row key={s.id} icon="heart" title={strapName(s.name)} subtitle={signalWords(s.rssi)} onPress={() => void pair(s)}
                right={busyId === s.id ? <Txt variant="caption">Pairing…</Txt> : undefined}
                accessibilityLabel={`${strapName(s.name)}, ${signalWords(s.rssi)}. Pair this strap`} />
            ))}
          </ListGroup>
        ) : null}
        {scanning ? <Txt variant="caption">Put the strap on (most only wake up when they touch the skin) and keep it near the phone.</Txt> : null}
        {problem === 'denied' ? <Banner tone="warning" text="Loopfield needs the Nearby devices permission to find your strap." action={{ label: 'Open settings', onPress: () => void Linking.openSettings() }} /> : null}
        {problem === 'off' ? <Banner tone="warning" text="Bluetooth is off. Turn it on and try again." /> : null}
        {problem === 'none_found' ? <Banner tone="info" text="No strap found. Wet the strap's contacts, put it on, and try again." /> : null}
        {problem === 'failed' ? <Banner tone="danger" text="Couldn't connect to the strap. Make sure no other app is using it, then try again." /> : null}
      </Section>
    </Screen>
  );
}
