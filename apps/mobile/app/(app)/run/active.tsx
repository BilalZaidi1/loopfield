import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { onCue, type Cue } from '@/lib/cues';
import { log } from '@/lib/log';
import { Badge, Banner, BigNumber, Button, Card, EmptyState, IconButton, PressableScale, Screen, StatTile, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { tick, useReducedMotion } from '@/theme/motion';
import { MapCanvas, mapboxModule } from '@/features/map/MapCanvas';
import { RunMap, type RunMapHandle } from '@/features/map/RunMap';
import { discardRun, endCapture, finishRun, pauseRun, recordingInForegroundOnly, resumeAfterInterruption, resumeRun, startCapture } from '@/recording/recorder';
import { isExpoGo } from '@/lib/runtime';
import { processUploads } from '@/recording/uploader';
import { latestIntegrityNotice } from '@/recording/integrity';
import { useRecording, type LiveState } from '@/recording/useRecording';
import { useSession, useUnits } from '@/state/session';
import { radius, spacing, usePalette, useTheme } from '@/theme/tokens';

/**
 * S21 Active recording — route, elapsed time, distance, pace, status and controls; loop closure or speed
 * progress. Where the map can be drawn (installed builds) the map fills the screen and everything else
 * floats over it; elsewhere (browser, Expo Go) the screen leads with the numbers.
 */
export default function ActiveRun() {
  const live = useRecording();
  const [now, setNow] = useState(() => Date.now());
  const [cue, setCue] = useState<Cue | null>(null);
  useEffect(() => onCue(setCue), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = live.session;
  if (!s) {
    return (
      <Screen>
        <EmptyState icon="record" title="No run in progress" action={{ label: 'Go to Record', onPress: () => router.replace('/record') }} />
      </Screen>
    );
  }
  return mapboxModule() ? <MapRun live={live} now={now} cue={cue} /> : <StatsRun live={live} now={now} cue={cue} />;
}

/** Shared state and actions for both layouts. */
function useRun(live: LiveState, now: number) {
  const { userId } = useSession();
  const [busy, setBusy] = useState(false);
  const s = live.session!;
  const events = live.events;
  const interrupted = s.state === 'paused' && events.length > 0 && events[events.length - 1]!.kind === 'interrupted';
  const elapsed = s.started_at ? (s.state === 'recording' ? now - s.started_at - (live.summary?.pausedMs ?? 0) : live.summary?.elapsedMs ?? 0) : 0;
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
  return {
    s,
    busy,
    interrupted,
    elapsed,
    finish,
    discard,
    competitive,
    territory: s.mode === 'territory' || s.mode === 'territory_speed',
    speed: s.mode === 'speed' || s.mode === 'territory_speed',
    paused: s.state === 'paused',
    closing: live.closure === 'possible_closure',
    pauseOrResume: () => void (s.state === 'paused' ? (interrupted ? resumeAfterInterruption(s.id) : resumeRun(s.id)) : pauseRun(s.id))
  };
}

const MODE_LABEL: Record<string, string> = { private: 'Private', territory: 'Territory', speed: 'Speed', territory_speed: 'Territory + speed' };

/** Problems worth interrupting the run for, most important first. */
function alertsFor(live: LiveState, r: ReturnType<typeof useRun>): { tone: 'warning' | 'info'; text: string }[] {
  const out: { tone: 'warning' | 'info'; text: string }[] = [];
  // Speed or step warnings and automatic pauses come first: they change what this run can count for.
  const notice = latestIntegrityNotice(live.events);
  if (notice) out.push({ tone: 'warning', text: notice.text });
  if (r.interrupted) out.push({ tone: 'warning', text: 'Recording was interrupted by the phone or system. The missing time is kept as a gap and never filled in.' });
  if (live.gpsQuality !== 'good' && r.s.state === 'recording') {
    out.push({ tone: 'warning', text: live.gpsQuality === 'weak' ? 'Weak GPS signal. Loop and route results may not count.' : `No GPS fix${live.gpsStaleSeconds ? ` for ${Math.round(live.gpsStaleSeconds)} s` : ''}. This gap is shown, not filled in.` });
  }
  if (r.s.state === 'recording' && recordingInForegroundOnly()) {
    out.push({ tone: 'info', text: isExpoGo ? 'Expo Go records only while Loopfield is on screen, so the screen stays on.' : 'Background recording is off on this phone, so the screen stays on during this run.' });
  }
  return out;
}

function MapRun({ live, now, cue }: { live: LiveState; now: number; cue: Cue | null }) {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const insets = useSafeAreaInsets();
  const r = useRun(live, now);
  const [following, setFollowing] = useState(true);
  const [threeD, setThreeD] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [topH, setTopH] = useState(insets.top + 64);
  const [panelH, setPanelH] = useState(260);
  const map = useRef<RunMapHandle>(null);
  const dist = splitValue(fmtDistance(live.summary?.distanceM ?? 0, units));
  const alerts = alertsFor(live, r);
  const mapInsets = useMemo(() => ({ top: topH, bottom: panelH + 16 }), [topH, panelH]);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <RunMap
        handle={map}
        path={live.path}
        captureStart={r.territory && r.s.capture_state === 'open' ? live.captureStart : null}
        closing={r.closing}
        threeD={threeD}
        insets={mapInsets}
        following={following}
        onFollowingChange={setFollowing}
        accessibilityLabel={`Map of your run so far. ${following ? 'Following your position.' : 'Exploring the map; following resumes on its own.'} Only you can see this map.`}
      />

      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + spacing.sm }]} onLayout={(e) => setTopH(insets.top + spacing.sm + Math.round(e.nativeEvent.layout.height) + spacing.sm)}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <StatusPill paused={r.paused} elapsed={r.elapsed} />
          <View style={{ flex: 1 }} />
          <View style={[styles.floatChip, { backgroundColor: p.surface }, t.elevation.floating]} accessible accessibilityLabel={`${MODE_LABEL[r.s.mode]} run`}>
            <Icon name={r.territory ? 'hexagon' : r.speed ? 'stopwatch' : 'lock'} color={r.competitive ? p.primary : p.textMuted} size={16} />
            <Txt variant="label">{MODE_LABEL[r.s.mode]}</Txt>
          </View>
        </View>
        {alerts.slice(0, 2).map((a) => (
          <Animated.View key={a.text} entering={FadeIn} exiting={FadeOut} style={[styles.alert, { backgroundColor: a.tone === 'warning' ? p.warningSoft : p.surface }, t.elevation.floating]} accessibilityRole="alert">
            <Icon name={a.tone === 'warning' ? 'alert' : 'info'} color={a.tone === 'warning' ? p.warning : p.info} size={18} />
            <Txt variant="caption" color="text" style={{ flex: 1 }}>{a.text}</Txt>
          </Animated.View>
        ))}
      </View>

      <View pointerEvents="box-none" style={[styles.side, { bottom: panelH + insets.bottom + spacing.lg }]}>
        <IconButton variant="surface" icon="layers" label={threeD ? 'Switch to flat map' : 'Switch to 3D map'} color={threeD ? p.primary : p.textSubtle} onPress={() => setThreeD(!threeD)} />
        {following ? null : (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <PressableScale onPress={() => { tick('light'); map.current?.recenter(); }} accessibilityRole="button" accessibilityLabel="Recenter on my position" style={[styles.recenter, { backgroundColor: p.primaryFill }, t.elevation.floating]}>
              <Icon name="locate" color="#FFFFFF" size={24} />
            </PressableScale>
          </Animated.View>
        )}
      </View>

      {cue ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cue, { backgroundColor: p.ink, bottom: panelH + insets.bottom + spacing.lg, right: 76 }]}>
          <Icon name="volume" color={p.onInk} size={18} />
          <Txt variant="label" style={{ color: p.onInk, flex: 1 }}>{cue.text}</Txt>
        </Animated.View>
      ) : null}

      <Animated.View
        layout={LinearTransition.duration(220)}
        onLayout={(e) => setPanelH(Math.round(e.nativeEvent.layout.height))}
        style={[styles.panel, { backgroundColor: p.surface, bottom: insets.bottom + spacing.sm }, t.elevation.floating]}>
        <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Show fewer details' : 'Show more details'} accessibilityState={{ expanded }} hitSlop={10} style={styles.grabberHit}>
          <View style={[styles.grabber, { backgroundColor: p.borderStrong }]} />
        </Pressable>
        <View style={styles.stats}>
          <View style={{ flex: 1.3 }} accessible accessibilityLabel={`Distance ${dist.value} ${dist.unit}`}>
            <BigNumber value={dist.value} unit={dist.unit} size={56} dim={r.paused} />
          </View>
          <Stat label="Time" value={fmtDuration(r.elapsed)} dim={r.paused} />
          <Stat label="Pace" value={fmtPace(live.summary?.avgPaceSecPerKm ?? null, units)} dim={r.paused} />
        </View>
        {r.territory ? <CaptureStrip live={live} r={r} detailed={expanded} /> : null}
        {expanded && r.speed ? (
          <View style={[styles.strip, { backgroundColor: p.surfaceAlt }]}>
            <Icon name="stopwatch" color={p.orangeText} size={20} />
            <Txt variant="caption" color="text" style={{ flex: 1 }}>{r.s.speed_state === 'open' ? 'Speed attempt armed: timing starts at the route start gate.' : 'Speed attempt window closed.'}</Txt>
          </View>
        ) : null}
        <View style={styles.controls}>
          <RoundControl icon={r.paused ? 'play' : 'pause'} label={r.paused ? 'Resume' : 'Pause'} tone={r.paused ? 'primary' : 'soft'} onPress={r.pauseOrResume} hint={r.competitive && !r.paused ? 'Pausing during a capture or attempt makes that interval ineligible.' : undefined} />
          <RoundControl icon="stop" label="Finish" tone="ink" onPress={r.finish} busy={r.busy} />
        </View>
        {expanded ? (
          <View style={{ gap: spacing.xs }}>
            <Button label="Discard run" variant="ghost" size="sm" onPress={r.discard} />
            <Txt variant="caption" align="center">Recording continues with the screen locked. Force-stopping the app can still end it; any missing time is shown as a gap.</Txt>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Loop capture: one line while collapsed, the explanation and buttons when expanded. */
function CaptureStrip({ live, r, detailed }: { live: LiveState; r: ReturnType<typeof useRun>; detailed: boolean }) {
  const p = usePalette();
  const units = useUnits();
  const st = r.s.capture_state;
  const label = st === 'none' ? 'Loop capture not started' : st === 'open' ? (r.closing ? 'Near the start: close the loop' : `${fmtDistance(live.captureDistanceM, units)} in this loop`) : 'Capture ended';
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.strip, { backgroundColor: r.closing ? p.greenSoft : p.primarySoft }]} accessible accessibilityLabel={`Loop capture: ${label}`}>
        <Icon name="hexagon" color={r.closing ? p.greenText : p.primary} size={20} />
        <Txt variant="label" style={{ flex: 1, color: r.closing ? p.greenText : p.onPrimarySoft }} numberOfLines={1}>{label}</Txt>
        {st === 'none' ? (
          <Button size="sm" icon="flag" label="Start here" onPress={() => startCapture(r.s.id)} disabled={r.s.state !== 'recording'} />
        ) : st === 'open' ? (
          <Button size="sm" variant="secondary" icon="flag" label="End here" onPress={() => endCapture(r.s.id)} />
        ) : null}
      </View>
      {detailed ? (
        <Txt variant="caption">
          {st === 'none'
            ? 'Travel before the capture starts stays private. Start the capture where you want the loop to begin.'
            : st === 'open'
              ? 'Return near where the capture started to close the loop. This hint is a preview; the server decides whether the loop counts.'
              : 'Only the first capture in a run counts.'}
        </Txt>
      ) : null}
    </View>
  );
}

function Stat({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label} ${value}`}>
      <Txt variant="metric" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 24, lineHeight: 28, opacity: dim ? 0.5 : 1 }}>{value}</Txt>
      <Txt variant="caption">{label}</Txt>
    </View>
  );
}

/** Recording status with the elapsed time; the dot breathes while recording (not with Reduce Motion). */
function StatusPill({ paused, elapsed }: { paused: boolean; elapsed: number }) {
  const t = useTheme();
  const p = t.palette;
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = paused || reduced ? 1 : withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [paused, reduced, o]);
  const dot = useAnimatedStyle(() => ({ opacity: o.value }));
  const color = paused ? p.warning : p.danger;
  return (
    <View style={[styles.floatChip, { backgroundColor: p.surface, paddingRight: spacing.lg }, t.elevation.floating]} accessible accessibilityRole="text" accessibilityLabel={`${paused ? 'Paused' : 'Recording'}, ${fmtDuration(elapsed)}`}>
      <Animated.View style={[styles.recDot, { backgroundColor: color }, dot]} />
      <Txt variant="label" style={{ color }}>{paused ? 'Paused' : 'Recording'}</Txt>
      <Txt variant="bodyStrong" tabular>{fmtDuration(elapsed)}</Txt>
    </View>
  );
}

/** Where maps cannot be drawn: the numbers lead and the map card explains why it is empty. */
function StatsRun({ live, now, cue }: { live: LiveState; now: number; cue: Cue | null }) {
  const p = usePalette();
  const units = useUnits();
  const r = useRun(live, now);
  const dist = splitValue(fmtDistance(live.summary?.distanceM ?? 0, units));
  return (
    <Screen
      edges={['top']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <View style={styles.controls}>
            <RoundControl icon={r.paused ? 'play' : 'pause'} label={r.paused ? 'Resume' : 'Pause'} tone={r.paused ? 'primary' : 'soft'} onPress={r.pauseOrResume} hint={r.competitive && !r.paused ? 'Pausing during a capture or attempt makes that interval ineligible.' : undefined} />
            <RoundControl icon="stop" label="Finish" tone="ink" onPress={r.finish} busy={r.busy} />
          </View>
          <Button label="Discard run" variant="ghost" size="sm" onPress={r.discard} />
        </View>
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <StatusPill paused={r.paused} elapsed={r.elapsed} />
        <View style={{ flex: 1 }} />
        <Badge icon={r.territory ? 'hexagon' : r.speed ? 'stopwatch' : 'lock'} label={MODE_LABEL[r.s.mode]!} tone={r.competitive ? 'violet' : 'muted'} />
      </View>
      {alertsFor(live, r).map((a) => <Banner key={a.text} tone={a.tone} text={a.text} />)}
      <View>
        <BigNumber value={dist.value} unit={dist.unit} size={96} dim={r.paused} />
        <Txt color="textMuted">{units === 'metric' ? 'Kilometres' : 'Miles'}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatTile icon="stopwatch" label="Time" value={fmtDuration(r.elapsed)} />
        <StatTile icon="speed" label="Pace" value={fmtPace(live.summary?.avgPaceSecPerKm ?? null, units)} />
      </View>
      {cue ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cueInline, { backgroundColor: p.infoSoft }]}>
          <Icon name="volume" color={p.info} size={18} />
          <Txt variant="label" style={{ color: p.text, flex: 1 }}>{cue.text}</Txt>
        </View>
      ) : null}
      <MapCanvas height={200} accessibilityLabel="Your route so far. Only you can see this map." layers={{ path: live.path }} showUser followUser />
      {r.territory ? <Card accessibilityLabel="Loop capture"><CaptureStrip live={live} r={r} detailed /></Card> : null}
      {r.speed ? (
        <Card accessibilityLabel="Speed attempt">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="stopwatch" color={p.orangeText} size={22} />
            <Txt variant="heading" style={{ flex: 1 }}>Speed attempt</Txt>
            <Badge label={r.s.speed_state === 'open' ? 'Armed' : 'Closed'} tone={r.s.speed_state === 'open' ? 'title' : 'muted'} />
          </View>
          <Txt color="textMuted">{r.s.speed_state === 'open' ? 'Timing starts when you cross the route start gate in its direction and ends at the finish gate.' : 'Attempt window closed.'}</Txt>
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
        style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color={fg} /> : <Icon name={icon} color={fg} size={30} />}
      </PressableScale>
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  floatChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  side: { position: 'absolute', right: spacing.lg, gap: spacing.md, alignItems: 'center' },
  recenter: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  cue: { position: 'absolute', left: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  cueInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  panel: { position: 'absolute', left: spacing.md, right: spacing.md, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  grabberHit: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 2 },
  grabber: { width: 40, height: 5, borderRadius: 3 },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, minHeight: 48, borderRadius: radius.md },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.huge }
});
