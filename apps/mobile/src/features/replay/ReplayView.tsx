import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { distanceBucket, replayAt, type ReplayPlan } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { fmtRuleDistance } from '@/lib/format';
import { Button, Card, ListGroup, Segmented, Toggle, Txt } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { MapCanvas, mapAvailability, type MapHandle, type MapMarker } from '@/features/map/MapCanvas';
import { boundsOf } from '@/territory/h3';
import { radius, spacing, useTheme } from '@/theme/tokens';
import { ReplayClock } from './clock';
import { PACE_SHADES, NO_PACE, shadeColor } from './colors';

type Cause = 'reduce_motion' | 'slow_phone' | 'chosen';

/**
 * 3D replay of the runner's own run (R4): the camera follows the run's line over terrain in about 20 seconds,
 * the line shaded by each kilometre's pace and every kilometre marked. With Reduce Motion, or when the phone
 * cannot keep 30 frames a second, it is a flat map with the same line and a slider, and nothing moves by itself.
 * Everything is worked out on the phone from the run's own line: no data leaves it, apart from map tiles.
 */
export function ReplayView({ plan, runM, units, reduced }: { plan: ReplayPlan; runM: number; units: 'metric' | 'imperial'; reduced: boolean }) {
  const t = useTheme();
  const scheme = t.scheme === 'dark' ? 'dark' : 'light';
  const map = useRef<MapHandle>(null);
  const clock = useRef<ReplayClock | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1' | '2'>('1');
  const [flat, setFlat] = useState<Cause | null>(reduced ? 'reduce_motion' : null);
  const length = distanceBucket(runM);
  const played = useRef(false);

  useEffect(() => {
    const c = new ReplayClock(plan, {
      onCamera: (config) => map.current?.setCamera(config),
      onPosition: setAt,
      onEnd: () => {
        setPlaying(false);
        track('replay', { action: 'finished', length });
      },
      onSlow: () => {
        c.pause();
        setPlaying(false);
        setFlat('slow_phone');
      }
    });
    clock.current = c;
    return () => c.stop();
  }, [plan, length]);

  useEffect(() => {
    if (flat) track('replay', { action: 'switched_to_flat', length, cause: flat });
  }, [flat, length]);

  const paceLines = useMemo(() => plan.stretches.map((s) => ({ coords: s.line.map((x) => [x.lng, x.lat] as [number, number]), color: shadeColor(s.shade, scheme) })), [plan, scheme]);
  const markers = useMemo<MapMarker[]>(() => {
    const first = plan.frames[0]!.center;
    const last = plan.frames[plan.frames.length - 1]!.center;
    return [
      ...plan.markers.map((m) => ({ id: `km-${m.label}`, coord: [m.point.lng, m.point.lat] as [number, number], label: String(m.label), kind: 'km' as const })),
      { id: 'start', coord: [first.lng, first.lat], label: 'Start', kind: 'start' },
      { id: 'finish', coord: [last.lng, last.lat], label: 'Finish', kind: 'finish' }
    ];
  }, [plan]);
  const fit = useMemo(() => boundsOf(paceLines.flatMap((l) => l.coords)), [paceLines]);
  const here = replayAt(plan, at);
  const ranM = (here.distanceM / Math.max(1, plan.lengthM)) * runM;

  const play = () => {
    const c = clock.current;
    if (!c) return;
    if (c.playing) {
      c.pause();
      setPlaying(false);
      return;
    }
    c.play(Number(speed));
    setPlaying(true);
    if (!played.current) {
      played.current = true;
      track('replay', { action: 'played', length });
    }
  };
  const changeSpeed = (v: '1' | '2') => {
    setSpeed(v);
    clock.current?.setSpeed(Number(v));
  };
  const toFlat = (on: boolean) => {
    clock.current?.pause();
    setPlaying(false);
    setFlat(on ? 'chosen' : null);
  };

  const controls = (
    <Card>
      <Slider testID="replay-scrub" label="Replay position" valueText={`${fmtRuleDistance(ranM, units)} of ${fmtRuleDistance(runM, units)}`}
        value={at} min={0} max={plan.durationMs} step={50} accessibilityStep={1000}
        onSlidingStart={() => {
          clock.current?.pause();
          setPlaying(false);
        }}
        onChange={(v) => clock.current?.seek(v)}
        onSlidingEnd={(v) => {
          clock.current?.seek(v);
          track('replay', { action: 'dragged', length });
        }} />
      <Txt variant="caption" tabular>{`${fmtRuleDistance(ranM, units)} of ${fmtRuleDistance(runM, units)}`}</Txt>
      {flat === 'reduce_motion' ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Button icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : at >= plan.durationMs ? 'Play again' : 'Play'} onPress={play} />
          <View style={{ flex: 1 }}>
            <Segmented label="Replay speed" value={speed} onChange={changeSpeed} options={[{ value: '1', label: 'Normal' }, { value: '2', label: 'Double' }]} />
          </View>
        </View>
      )}
    </Card>
  );

  return (
    <>
      {flat ? (
        <MapCanvas key="flat" height={380} fit={fit} layers={{ paceLines, markers, dot: [here.center.lng, here.center.lat] }}
          accessibilityLabel="Flat map of your run, shaded by pace, with a dot where the replay has got to." />
      ) : (
        <View>
          <MapCanvas key="3d" mapRef={map} height={420} threeD locked={playing} center={[plan.frames[0]!.center.lng, plan.frames[0]!.center.lat]} zoom={plan.zoom}
            initialPitch={plan.pitch} initialHeading={plan.frames[0]!.headingDeg} layers={{ paceLines, markers }}
            onLoaded={() => clock.current?.seek(clock.current.position)}
            accessibilityLabel="3D replay of your run over the terrain, shaded by pace. The camera follows the run." />
          {/* The camera is centred on where the replay has got to, so the runner's dot sits in the middle. */}
          {mapAvailability().ok ? (
            <View pointerEvents="none" style={styles.centre}>
              <View style={[styles.dot, { backgroundColor: t.territory.path, borderColor: t.territory.pathCasing }]} />
            </View>
          ) : null}
        </View>
      )}
      {controls}
      <Card accessibilityLabel="Line colours: lighter blue is slower, deeper blue is faster; grey kilometres had a pause or gap.">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Txt variant="caption">Slower</Txt>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {PACE_SHADES[scheme].map((c) => <View key={c} style={[styles.swatch, { backgroundColor: c }]} />)}
          </View>
          <Txt variant="caption">Faster</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={[styles.swatch, { backgroundColor: NO_PACE[scheme] }]} />
          <Txt variant="caption">Pause or gap in that kilometre</Txt>
        </View>
        <Txt variant="caption">Each kilometre is shaded by its pace. Numbers mark every {units === 'imperial' ? 'mile' : 'kilometre'}.</Txt>
      </Card>
      {flat === 'reduce_motion' ? (
        <Txt variant="caption">Reduce Motion is on, so the replay is a flat map that moves only when you drag the slider.</Txt>
      ) : (
        <ListGroup>
          <Toggle label="Flat map" description={flat === 'slow_phone' ? 'Switched on because the 3D view was running slowly on this phone.' : 'A still, flat map with the same line and slider.'}
            value={Boolean(flat)} onChange={toFlat} />
        </ListGroup>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centre: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3 },
  swatch: { width: 18, height: 10, borderRadius: radius.xs }
});
