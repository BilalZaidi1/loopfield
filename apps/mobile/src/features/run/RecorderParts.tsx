import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import type { Cue } from '@/lib/cues';
import { log } from '@/lib/log';
import { ArrowLink, Badge, Banner, BigNumber, Button, Card, IconButton, OfflineBanner, PressableScale, Screen, StatTile, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { tick, useReducedMotion } from '@/theme/motion';
import { MapCanvas } from '@/features/map/MapCanvas';
import { discardRun, endCapture, ensureLocationPermission, finishRun, pauseRun, recordingInForegroundOnly, resumeAfterInterruption, resumeRun, startCapture } from '@/recording/recorder';
import { isExpoGo } from '@/lib/runtime';
import { processUploads } from '@/recording/uploader';
import { latestIntegrityNotice } from '@/recording/integrity';
import type { LiveState } from '@/recording/useRecording';
import { useSession, useUnits } from '@/state/session';
import { radius, spacing, usePalette, useTheme } from '@/theme/tokens';
import { PreRunControls } from './PreRunPanel';
import { gpsColor, gpsLabel, useGpsReadiness, usePreRun, type Gps } from './usePreRun';

/**
 * The recorder's panels: before the run (close, GPS, run type and GO) and during it (status, alerts,
 * distance, time, pace and the controls), floating over the map in installed builds; and the same two
 * moments as ordinary screens where maps cannot be drawn (browser, Expo Go).
 */

/** Leave the recorder (a run in progress keeps recording; the Record button brings it back). */
export function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}

/** Shared state and actions for a run in progress, in both layouts. */
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
  // Discarding returns the recorder to choosing a run type, on the same screen.
  const discard = () =>
    Alert.alert('Discard this run?', 'The recording is deleted from this phone and nothing is uploaded.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardRun(s.id) }
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

/** Before the run: close and GPS at the top, run type and GO in the bottom panel. */
export function PreParts({ course, onTop, onPanel, panelBottom }: { course: string | null; onTop: (h: number) => void; onPanel: (h: number) => void; panelBottom: number }) {
  const t = useTheme();
  const p = t.palette;
  const insets = useSafeAreaInsets();
  const pre = usePreRun(course);
  const gps = useGpsReadiness(true);
  return (
    <>
      <View pointerEvents="box-none" style={[recorderStyles.top, { top: insets.top + spacing.sm }]} onLayout={(e) => onTop(insets.top + spacing.sm + Math.round(e.nativeEvent.layout.height) + spacing.sm)}>
        <View pointerEvents="box-none" style={recorderStyles.topRow}>
          <IconButton variant="surface" icon="close" label="Close the recorder" onPress={close} />
          <GpsPill gps={gps} />
          <View style={{ flex: 1 }} />
          <IconButton variant="surface" icon="help" label="How loops and titles work" onPress={() => router.push('/help')} />
        </View>
      </View>
      <Animated.View layout={LinearTransition.duration(220)} onLayout={(e) => onPanel(Math.round(e.nativeEvent.layout.height))}
        style={[recorderStyles.panel, { backgroundColor: p.surface, bottom: panelBottom, paddingTop: spacing.lg }, t.elevation.floating]}>
        {gps.state === 'off' ? (
          <Banner tone="warning" text="Location is off for Loopfield, so the map cannot show where you are."
            action={{ label: 'Allow', onPress: () => void ensureLocationPermission().then(gps.recheck) }} />
        ) : null}
        <PreRunControls pre={pre} compact />
      </Animated.View>
    </>
  );
}

export function GpsPill({ gps, dark }: { gps: Gps; dark?: boolean }) {
  const t = useTheme();
  const p = t.palette;
  const label = gpsLabel(gps);
  const text = gps.accuracy != null && gps.state !== 'off' ? `${label} · ±${Math.round(gps.accuracy)} m` : label;
  return (
    <View style={[recorderStyles.floatChip, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : p.surface }, dark ? null : t.elevation.floating]} accessible
      accessibilityLabel={`${label}${gps.accuracy != null ? `, about plus or minus ${Math.round(gps.accuracy)} metres` : ''}`}>
      <View style={[recorderStyles.gpsDot, { backgroundColor: gpsColor(gps) }]} />
      <Txt variant="label" style={dark ? { color: '#FFFFFF' } : undefined}>{text}</Txt>
    </View>
  );
}

/** During the run: status and alerts at the top; distance, time, pace and the controls in the panel. */
export function LiveParts({ live, now, onTop, onPanel, panelBottom }: { live: LiveState; now: number; onTop: (h: number) => void; onPanel: (h: number) => void; panelBottom: number }) {
  const t = useTheme();
  const p = t.palette;
  const units = useUnits();
  const insets = useSafeAreaInsets();
  const r = useRun(live, now);
  const [expanded, setExpanded] = useState(false);
  const dist = splitValue(fmtDistance(live.summary?.distanceM ?? 0, units));
  const alerts = alertsFor(live, r);
  return (
    <>
      <View pointerEvents="box-none" style={[recorderStyles.top, { top: insets.top + spacing.sm }]} onLayout={(e) => onTop(insets.top + spacing.sm + Math.round(e.nativeEvent.layout.height) + spacing.sm)}>
        <View pointerEvents="box-none" style={recorderStyles.topRow}>
          <StatusPill paused={r.paused} elapsed={r.elapsed} />
          <View style={{ flex: 1 }} />
          <View style={[recorderStyles.floatChip, { backgroundColor: p.surface }, t.elevation.floating]} accessible accessibilityLabel={`${MODE_LABEL[r.s.mode]} run`}>
            <Icon name={r.territory ? 'hexagon' : r.speed ? 'stopwatch' : 'lock'} color={r.competitive ? p.primary : p.textMuted} size={16} />
            <Txt variant="label">{MODE_LABEL[r.s.mode]}</Txt>
          </View>
        </View>
        {alerts.slice(0, 2).map((a) => (
          <Animated.View key={a.text} entering={FadeIn} exiting={FadeOut} style={[recorderStyles.alert, { backgroundColor: a.tone === 'warning' ? p.warningSoft : p.surface }, t.elevation.floating]} accessibilityRole="alert">
            <Icon name={a.tone === 'warning' ? 'alert' : 'info'} color={a.tone === 'warning' ? p.warning : p.info} size={18} />
            <Txt variant="caption" color="text" style={{ flex: 1 }}>{a.text}</Txt>
          </Animated.View>
        ))}
      </View>

      <Animated.View
        layout={LinearTransition.duration(220)}
        onLayout={(e) => onPanel(Math.round(e.nativeEvent.layout.height))}
        style={[recorderStyles.panel, { backgroundColor: p.surface, bottom: panelBottom }, t.elevation.floating]}>
        <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Show fewer details' : 'Show more details'} accessibilityState={{ expanded }} hitSlop={10} style={recorderStyles.grabberHit}>
          <View style={[recorderStyles.grabber, { backgroundColor: p.borderStrong }]} />
        </Pressable>
        {/* Three columns, values over labels, labels on one line: a number shrinks to fit its column rather than being cut. */}
        <View style={recorderStyles.stats}>
          <Stat label="Distance" value={dist.value} unit={dist.unit} size={44} variant="hero" flex={1.35} dim={r.paused} />
          <Stat label="Time" value={fmtDuration(r.elapsed)} size={26} dim={r.paused} />
          <Stat label="Pace" {...paceParts(fmtPace(live.summary?.avgPaceSecPerKm ?? null, units))} size={26} dim={r.paused} />
        </View>
        {r.territory ? <CaptureStrip live={live} r={r} detailed={expanded} /> : null}
        {expanded && r.speed ? (
          <View style={[recorderStyles.strip, { backgroundColor: p.surfaceAlt }]}>
            <Icon name="stopwatch" color={p.orangeText} size={20} />
            <Txt variant="caption" color="text" style={{ flex: 1 }}>{r.s.speed_state === 'open' ? 'Speed attempt armed: timing starts at the route start gate.' : 'Speed attempt window closed.'}</Txt>
          </View>
        ) : null}
        <View style={recorderStyles.controls}>
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
    </>
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
      <View style={[recorderStyles.strip, { backgroundColor: r.closing ? p.greenSoft : p.primarySoft }]} accessible accessibilityLabel={`Loop capture: ${label}`}>
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

/** "5:01 /km" as the number and its unit, so the unit can be set smaller; "—" stays as it is. */
function paceParts(formatted: string): { value: string; unit?: string } {
  const i = formatted.lastIndexOf(' ');
  return i > 0 ? { value: formatted.slice(0, i), unit: formatted.slice(i + 1) } : { value: formatted };
}

/**
 * One live number over its label. The number is measured at full size off screen and set smaller only
 * when it would not fit its column, so "12.48 km" or "1:02:33" is never cut short (on every platform,
 * without relying on the system's shrink-to-fit).
 */
function Stat({ label, value, unit, size, variant = 'metric', flex = 1, dim }: { label: string; value: string; unit?: string; size: number; variant?: 'metric' | 'hero'; flex?: number; dim?: boolean }) {
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState(0);
  const scale = box && natural ? Math.min(1, (box - 2) / natural) : 1;
  const fs = Math.max(12, Math.floor(size * scale));
  const unitSize = (n: number) => Math.max(10, Math.round(n * 0.38));
  const text = (n: number) => (
    <>
      {value}
      {unit ? <Txt variant="label" color="textMuted" style={{ fontSize: unitSize(n), fontStyle: 'normal' }}>{` ${unit}`}</Txt> : null}
    </>
  );
  return (
    <View style={{ flex, minWidth: 0, gap: 2 }} accessible accessibilityLabel={`${label} ${value}${unit ? ` ${unit}` : ''}`} onLayout={(e) => setBox(Math.floor(e.nativeEvent.layout.width))}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: 1000, opacity: 0, alignItems: 'flex-start' }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View onLayout={(e) => setNatural(Math.ceil(e.nativeEvent.layout.width))}>
          <Txt variant={variant} tabular style={{ fontSize: size, lineHeight: Math.round(size * 1.15) }}>{text(size)}</Txt>
        </View>
      </View>
      <Txt variant={variant} tabular numberOfLines={1} style={{ fontSize: fs, lineHeight: Math.round(size * 1.15), opacity: dim ? 0.5 : 1 }}>{text(fs)}</Txt>
      <Txt variant="caption" numberOfLines={1}>{label}</Txt>
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
    <View style={[recorderStyles.floatChip, { backgroundColor: p.surface, paddingRight: spacing.lg }, t.elevation.floating]} accessible accessibilityRole="text" accessibilityLabel={`${paused ? 'Paused' : 'Recording'}, ${fmtDuration(elapsed)}`}>
      <Animated.View style={[recorderStyles.recDot, { backgroundColor: color }, dot]} />
      <Txt variant="label" style={{ color }}>{paused ? 'Paused' : 'Recording'}</Txt>
      <Txt variant="bodyStrong" tabular>{fmtDuration(elapsed)}</Txt>
    </View>
  );
}

/** Where maps cannot be drawn, before the run: the run type and GO on an ordinary screen. */
export function PreRunScreen({ course }: { course: string | null }) {
  const p = usePalette();
  const pre = usePreRun(course);
  const gps = useGpsReadiness(true);
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <IconButton variant="surface" icon="close" label="Close the recorder" onPress={close} />
        <Txt variant="headline" style={{ flex: 1 }}>Record</Txt>
        <GpsPill gps={gps} />
      </View>
      <OfflineBanner />
      <Card>
        <PreRunControls pre={pre} />
      </Card>
      {isExpoGo ? <Txt variant="caption" style={{ color: p.textMuted }}>Expo Go cannot draw maps, so the run is shown as numbers here. The installed app shows it on a full-screen map.</Txt> : null}
      <ArrowLink label="How loops and titles work" onPress={() => router.push('/help')} />
    </Screen>
  );
}

/** Where maps cannot be drawn, during the run: the numbers lead and the map card explains why it is empty. */
export function StatsRun({ live, now, cue }: { live: LiveState; now: number; cue: Cue | null }) {
  const p = usePalette();
  const units = useUnits();
  const r = useRun(live, now);
  const dist = splitValue(fmtDistance(live.summary?.distanceM ?? 0, units));
  return (
    <Screen
      edges={['top']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <View style={recorderStyles.controls}>
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
        <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[recorderStyles.cueInline, { backgroundColor: p.infoSoft }]}>
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

export const recorderStyles = StyleSheet.create({
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  floatChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  gpsDot: { width: 9, height: 9, borderRadius: 5 },
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
