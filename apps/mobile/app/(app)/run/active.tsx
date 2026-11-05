import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { onCue, type Cue } from '@/lib/cues';
import { log } from '@/lib/log';
import { Badge, Banner, BigNumber, Button, Card, EmptyState, PressableScale, Screen, StatTile, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { tick } from '@/theme/motion';
import { MapCanvas } from '@/features/map/MapCanvas';
import { eventsFor } from '@/recording/db';
import { discardRun, endCapture, finishRun, pauseRun, recordingInForegroundOnly, resumeAfterInterruption, resumeRun, startCapture } from '@/recording/recorder';
import { isExpoGo } from '@/lib/runtime';
import { processUploads } from '@/recording/uploader';
import { useRecording } from '@/recording/useRecording';
import { useSession, useUnits } from '@/state/session';
import { radius, spacing, usePalette, useTheme } from '@/theme/tokens';

/** S21 Active recording — route, elapsed time, distance, pace, status and controls; loop closure or speed progress. */
export default function ActiveRun() {
  const p = usePalette();
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
        <EmptyState icon="record" title="No run in progress" action={{ label: 'Go to Record', onPress: () => router.replace('/record') }} />
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
  const paused = s.state === 'paused';
  const dist = splitValue(fmtDistance(live.summary?.distanceM ?? 0, units));
  const closing = live.closure === 'possible_closure';

  return (
    <Screen
      edges={['top']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <View style={styles.controls}>
            {paused ? (
              <RoundControl icon="play" label="Resume" tone="primary" onPress={() => void (interrupted ? resumeAfterInterruption(s.id) : resumeRun(s.id))} />
            ) : (
              <RoundControl icon="pause" label="Pause" tone="soft" onPress={() => void pauseRun(s.id)} hint={competitive ? 'Pausing during a capture or attempt makes that interval ineligible.' : undefined} />
            )}
            <RoundControl icon="stop" label="Finish" tone="ink" onPress={finish} busy={busy} />
          </View>
          <Button label="Discard run" variant="ghost" size="sm" onPress={discard} />
        </View>
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={[styles.state, { backgroundColor: paused ? p.warningSoft : p.dangerSoft }]} accessibilityRole="text" accessibilityLabel={paused ? 'Paused' : 'Recording'}>
          <View style={[styles.recDot, { backgroundColor: paused ? p.warning : p.danger }]} />
          <Txt variant="label" style={{ color: paused ? p.warning : p.danger }}>{paused ? 'Paused' : 'Recording'}</Txt>
        </View>
        <View style={{ flex: 1 }} />
        <Badge icon={territory ? 'hexagon' : speed ? 'stopwatch' : 'lock'} label={s.mode === 'private' ? 'Private' : s.mode === 'territory' ? 'Territory' : s.mode === 'speed' ? 'Speed' : 'Territory + speed'} tone={competitive ? 'violet' : 'muted'} />
      </View>
      {interrupted ? (
        <Banner tone="warning" text="Recording was interrupted (the phone or system stopped the app). The missing time is kept as a gap and is never filled in. Competitive intervals with long gaps do not count." />
      ) : null}
      {s.state === 'recording' && recordingInForegroundOnly() ? (
        <Banner
          tone="info"
          text={
            isExpoGo
              ? 'Expo Go records only while Loopfield is open on screen, so the screen stays on during this run. Time spent outside the app is kept as a gap, never filled in.'
              : 'This phone did not allow background recording, so the screen stays on during this run. Time spent outside the app is kept as a gap, never filled in.'
          }
        />
      ) : null}
      {live.gpsQuality !== 'good' && s.state === 'recording' ? (
        <Banner tone="warning" text={live.gpsQuality === 'weak' ? 'GPS signal is weak. Loop and route results may not count.' : `No GPS fix${live.gpsStaleSeconds ? ` for ${Math.round(live.gpsStaleSeconds)} s` : ''}. This gap will be shown, not filled in.`} />
      ) : null}
      <View>
        <BigNumber value={dist.value} unit={dist.unit} size={96} dim={paused} />
        <Txt color="textMuted">{units === 'metric' ? 'Kilometres' : 'Miles'}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatTile icon="stopwatch" label="Time" value={fmtDuration(elapsed)} />
        <StatTile icon="speed" label="Pace" value={fmtPace(live.summary?.avgPaceSecPerKm ?? null, units)} />
      </View>
      {cue ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cue, { backgroundColor: p.infoSoft }]}>
          <Icon name="volume" color={p.info} size={18} />
          <Txt variant="label" style={{ color: p.text, flex: 1 }}>{cue.text}</Txt>
        </View>
      ) : null}
      <MapCanvas height={240} accessibilityLabel="Your route so far. Only you can see this map." layers={{ path: live.path }} showUser followUser />
      {territory ? (
        <Card tone={closing ? 'green' : 'surface'} accessibilityLabel="Loop capture">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="hexagon" color={closing ? '#121318' : p.primary} size={22} />
            <Txt variant="heading" style={{ flex: 1 }}>Loop capture</Txt>
            <Badge label={s.capture_state === 'none' ? 'Not started' : s.capture_state === 'open' ? (closing ? 'Near the start' : 'Open') : 'Ended'} tone={s.capture_state === 'open' ? 'violet' : 'muted'} />
          </View>
          {s.capture_state === 'none' ? (
            <>
              <Txt color="textMuted">Not started. Travel so far stays private.</Txt>
              <Button label="Start loop capture here" icon="flag" onPress={() => startCapture(s.id)} disabled={s.state !== 'recording'} />
            </>
          ) : s.capture_state === 'open' ? (
            <>
              <Txt variant="metric">{fmtDistance(live.captureDistanceM, units)}<Txt variant="label" color="textMuted" style={{ fontStyle: 'normal', fontWeight: '600' }}>{'  in this loop'}</Txt></Txt>
              <Txt variant={closing ? 'bodyStrong' : 'body'} color={closing ? 'text' : 'textMuted'}>
                {closing ? 'You are near the capture start. Finish or end the capture here to close the loop.' : 'Return near where the capture started to close the loop.'}
              </Txt>
              <Txt variant="caption">This hint is a preview. The server decides whether the loop counts.</Txt>
              <Button variant="secondary" icon="flag" label="End capture here" onPress={() => endCapture(s.id)} />
            </>
          ) : (
            <Txt color="textMuted">Capture ended. Only the first capture in a run counts.</Txt>
          )}
        </Card>
      ) : null}
      {speed ? (
        <Card accessibilityLabel="Speed attempt">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="stopwatch" color={p.orangeText} size={22} />
            <Txt variant="heading" style={{ flex: 1 }}>Speed attempt</Txt>
            <Badge label={s.speed_state === 'open' ? 'Armed' : 'Closed'} tone={s.speed_state === 'open' ? 'title' : 'muted'} />
          </View>
          <Txt color="textMuted">{s.speed_state === 'open' ? 'Timing starts when you cross the route start gate in its direction and ends at the finish gate.' : 'Attempt window closed.'}</Txt>
        </Card>
      ) : null}
      <Txt variant="caption">Recording continues with the screen locked. Very aggressive battery savers or force-stopping the app can still end it; any missing time is shown as a gap.</Txt>
    </Screen>
  );
}

function RoundControl({ icon, label, tone, onPress, busy, hint }: { icon: IconName; label: string; tone: 'primary' | 'soft' | 'ink'; onPress: () => void; busy?: boolean; hint?: string }) {
  const { palette: p } = useTheme();
  const bg = tone === 'primary' ? p.primaryFill : tone === 'ink' ? p.ink : p.primarySoft;
  const fg = tone === 'primary' ? '#FFFFFF' : tone === 'ink' ? p.onInk : p.primary;
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs }}>
      <PressableScale
        onPress={() => {
          tick('medium');
          onPress();
        }}
        disabled={busy}
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ busy: Boolean(busy) }}
        style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color={fg} /> : <Icon name={icon} color={fg} size={34} />}
      </PressableScale>
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.huge },
  state: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 34, borderRadius: radius.pill },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  cue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md }
});
