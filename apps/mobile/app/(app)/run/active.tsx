import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { onCue, type Cue } from '@/lib/cues';
import { log } from '@/lib/log';
import { Badge, Banner, Button, Card, EmptyState, Screen, StatTile, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { eventsFor } from '@/recording/db';
import { discardRun, endCapture, finishRun, pauseRun, resumeAfterInterruption, resumeRun, startCapture } from '@/recording/recorder';
import { processUploads } from '@/recording/uploader';
import { useRecording } from '@/recording/useRecording';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S21 Active recording — route, elapsed time, distance, pace, status and controls; loop closure or speed progress. */
export default function ActiveRun() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const { userId } = useSession();
  const live = useRecording();
  const [cue, setCue] = useState<Cue | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => onCue(setCue), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = live.session;
  const events = useMemo(() => (s ? eventsFor(s.id) : []), [s, live.summary]);
  const interrupted = s?.state === 'paused' && events.length > 0 && events[events.length - 1]!.kind === 'interrupted';
  const elapsed = s?.started_at ? (s.state === 'recording' ? now - s.started_at - (live.summary?.pausedMs ?? 0) : live.summary?.elapsedMs ?? 0) : 0;

  if (!s) {
    return (
      <Screen>
        <EmptyState title="No run in progress" action={{ label: 'Go to Record', onPress: () => router.replace('/record') }} />
      </Screen>
    );
  }

  const finish = () =>
    Alert.alert('Finish this run?', 'It is saved on this phone first, then uploaded for checking.', [
      { text: 'Keep running', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          setBusy(true);
          try {
            await finishRun(s.id);
            if (userId) void processUploads(userId).catch((e) => log.warn(String(e)));
            router.replace({ pathname: '/run/summary/[id]', params: { id: s.id } });
          } finally {
            setBusy(false);
          }
        }
      }
    ]);

  const discard = () =>
    Alert.alert('Discard this run?', 'The recording is deleted from this phone and nothing is uploaded.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => { await discardRun(s.id); router.replace('/record'); } }
    ]);

  const competitive = s.mode !== 'private';
  const territory = s.mode === 'territory' || s.mode === 'territory_speed';
  const speed = s.mode === 'speed' || s.mode === 'territory_speed';

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ gap: spacing.sm, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt variant="title">{s.state === 'paused' ? 'Paused' : 'Recording'}</Txt>
          <Badge label={s.mode === 'private' ? 'Private' : s.mode === 'territory' ? 'Territory' : s.mode === 'speed' ? 'Speed' : 'Territory + speed'} tone={competitive ? 'success' : 'muted'} />
        </View>
        {interrupted ? (
          <Banner tone="warning" text="Recording was interrupted (the phone or system stopped the app). The missing time is kept as a gap and is never filled in. Competitive intervals with long gaps do not count." />
        ) : null}
        {live.gpsQuality !== 'good' && s.state === 'recording' ? (
          <Banner tone="warning" text={live.gpsQuality === 'weak' ? 'GPS signal is weak. Loop and route results may not count.' : `No GPS fix${live.gpsStaleSeconds ? ` for ${Math.round(live.gpsStaleSeconds)} s` : ''}. This gap will be shown, not filled in.`} />
        ) : null}
        {cue ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Txt variant="label" color="info">{cue.text}</Txt>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <StatTile label="Time" value={fmtDuration(elapsed)} />
          <StatTile label="Distance" value={fmtDistance(live.summary?.distanceM ?? 0, units)} />
          <StatTile label="Pace" value={fmtPace(live.summary?.avgPaceSecPerKm ?? null, units)} />
        </View>
        <MapCanvas height={260} accessibilityLabel="Your route so far. Only you can see this map." layers={{ path: live.path }} showUser followUser />
        {territory ? (
          <Card accessibilityLabel="Loop capture">
            <Txt variant="heading">Loop capture</Txt>
            {s.capture_state === 'none' ? (
              <>
                <Txt color="textMuted">Not started. Travel so far stays private.</Txt>
                <Button label="Start loop capture here" onPress={() => startCapture(s.id)} disabled={s.state !== 'recording'} />
              </>
            ) : s.capture_state === 'open' ? (
              <>
                <Txt>{fmtDistance(live.captureDistanceM, units)} in this loop.</Txt>
                <Txt color={live.closure === 'possible_closure' ? 'success' : 'textMuted'}>
                  {live.closure === 'possible_closure' ? 'You are near the capture start. Finish or end the capture here to close the loop.' : 'Return near where the capture started to close the loop.'}
                </Txt>
                <Txt variant="caption">This hint is a preview. The server decides whether the loop counts.</Txt>
                <Button variant="secondary" label="End capture here" onPress={() => endCapture(s.id)} />
              </>
            ) : (
              <Txt color="textMuted">Capture ended. Only the first capture in a run counts.</Txt>
            )}
          </Card>
        ) : null}
        {speed ? (
          <Card accessibilityLabel="Speed attempt">
            <Txt variant="heading">Speed attempt</Txt>
            <Txt color="textMuted">{s.speed_state === 'open' ? 'Armed. Timing starts when you cross the route start gate in its direction and ends at the finish gate.' : 'Attempt window closed.'}</Txt>
          </Card>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {s.state === 'recording' ? (
            <Button label="Pause" variant="secondary" onPress={() => void pauseRun(s.id)} style={{ flex: 1 }} hint={competitive ? 'Pausing during a capture or attempt makes that interval ineligible.' : undefined} />
          ) : (
            <Button label="Resume" variant="secondary" onPress={() => void (interrupted ? resumeAfterInterruption(s.id) : resumeRun(s.id))} style={{ flex: 1 }} />
          )}
          <Button label="Finish" onPress={finish} loading={busy} style={{ flex: 1 }} />
        </View>
        <Button label="Discard run" variant="ghost" onPress={discard} />
        <Txt variant="caption" style={{ color: p.textMuted }}>Recording continues with the screen locked. Very aggressive battery savers or force-stopping the app can still end it; any missing time is shown as a gap.</Txt>
      </View>
    </Screen>
  );
}
