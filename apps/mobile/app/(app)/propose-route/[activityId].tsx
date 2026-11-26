import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { buildCourse, decodePolyline, isLoopShape, pathLengthMeters, sliceLine, STRETCH_RULES, type LatLng } from '@loopfield/core';
import { ROUTE_PUBLICATION_CONSENT_VERSION } from '@/config/env';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDistance, fmtRuleDistance } from '@/lib/format';
import { useAppConfig } from '@/lib/appConfig';
import { useSpeedRules } from '@/lib/gameRules';
import { PausedNote, SuspendedNotice, useSuspended } from '@/components/Notices';
import { Banner, Button, Card, ListGroup, LoadingState, Screen, Segmented, TextField, Toggle, Txt } from '@/components/ui';
import { Slider } from '@/components/Slider';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { MapCanvas, type MapMarker } from '@/features/map/MapCanvas';
import { defaultPart, overlapWith, PROTECTED_MARGIN_M, touchedArea, useOwnAreas, useRunProposals } from '@/features/propose/parts';
import { useActivityDetail, type ActivityJson } from '@/features/results/useActivity';
import { useUnits } from '@/state/session';

/** Ends of a part are kept at least this far apart while sliding. */
const MIN_GAP_M = 100;

/**
 * S26 Propose speed route — the whole run or part of it (R4), checked on the phone as it is chosen (length,
 * loop or start to finish, protected areas, parts already proposed), then direction, gates, consent and submit.
 */
export default function ProposeRoute() {
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const detail = useActivityDetail(activityId);
  const a = detail.data?.activity;
  const points = useMemo(() => (a?.personal_route ? decodePolyline(a.personal_route) : []), [a]);
  if (detail.isLoading) return <LoadingState />;
  if (!a || points.length < 2) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Propose a route' }} />
        <Banner tone="warning" text="This run has no processed route yet, so it cannot be proposed." />
      </Screen>
    );
  }
  return <ProposeForm key={a.id} activity={a} points={points} />;
}

function ProposeForm({ activity: a, points }: { activity: ActivityJson; points: LatLng[] }) {
  const p = usePalette();
  const units = useUnits();
  // The running season's route rules (back office), built-in when offline; reviewers and the server check again.
  const S = useSpeedRules();
  const { settings } = useAppConfig();
  const proposalsOn = settings.enabled.route_proposals_enabled;
  const aToB = settings.routeProposalsAToB;
  const suspended = useSuspended();
  const areas = useOwnAreas();
  const existing = useRunProposals(a.id);
  const corridor = S.corridorMeters.value;
  const minM = S.minCourseLengthMeters.value;
  const maxM = S.maxCourseLengthMeters.value;
  const lengthM = useMemo(() => pathLengthMeters(points), [points]);
  const wholeLoop = isLoopShape(points, corridor);
  const [mode, setMode] = useState<'whole' | 'part'>(wholeLoop && lengthM >= minM && lengthM <= maxM ? 'whole' : 'part');
  // The sliders move `live`; the map and the checks follow `range`, set when a slider is let go.
  const [live, setLive] = useState<[number, number]>(() => defaultPart(lengthM, maxM));
  const [range, setRange] = useState<[number, number]>(live);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [founding, setFounding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whole = mode === 'whole';
  const [fromM, toM] = whole ? [0, lengthM] : range;
  const chosen = useMemo(() => (whole ? points : sliceLine(points, fromM, toM)), [whole, points, fromM, toM]);
  const closed = isLoopShape(chosen, corridor);
  const preview = useMemo(() => (chosen.length > 1 ? buildCourse(chosen, { closed, rules: S }) : null), [chosen, closed, S]);
  const lengthOk = preview ? preview.lengthM >= minM && preview.lengthM <= maxM : false;
  const shapeOk = closed || aToB;
  const area = touchedArea(chosen, areas.data ?? []);
  const clash = existing.data ? overlapWith(existing.data, whole, fromM, toM) : null;
  // A whole land loop goes as before; anything else is sent as the part it is (a private run has no captured loop).
  const sendPart = !whole || !a.modes?.territory || !wholeLoop;
  const checksLoaded = areas.isSuccess && existing.isSuccess;
  const ready = consent && name.trim().length >= 3 && lengthOk && shapeOk && !area && !clash && checksLoaded && proposalsOn && !suspended && !busy;

  const full = useMemo(() => points.map((x) => [x.lng, x.lat] as [number, number]), [points]);
  const path = useMemo(() => chosen.map((x) => [x.lng, x.lat] as [number, number]), [chosen]);
  const markers: MapMarker[] = path.length
    ? closed
      ? [{ id: 's', coord: path[0]!, label: 'Start and finish', kind: 'start' }]
      : [{ id: 's', coord: path[0]!, label: 'Start', kind: 'start' }, { id: 'f', coord: path[path.length - 1]!, label: 'Finish', kind: 'finish' }]
    : [];

  const slide = (which: 0 | 1, v: number): [number, number] => {
    const [s, e] = live;
    const next: [number, number] = which === 0 ? [Math.min(v, e - MIN_GAP_M), e] : [s, Math.max(v, s + MIN_GAP_M)];
    setLive(next);
    return next;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc<string>('propose_route', {
        p_activity: a.id,
        p_name: name.trim(),
        p_consent_version: ROUTE_PUBLICATION_CONSENT_VERSION,
        p_score_founding_run: founding,
        ...(sendPart ? { p_from_m: Math.round(fromM), p_to_m: Math.round(toM) } : {})
      });
      await rpc('set_consent', { p_kind: 'route_publication', p_granted: true, p_version: ROUTE_PUBLICATION_CONSENT_VERSION });
      track('route_proposed', { outcome: 'submitted', from_stretch: !whole, shape: closed ? 'loop' : 'start_to_finish' });
      router.replace('/proposals');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const meetM = Math.round(corridor * STRETCH_RULES.closedCorridors);
  const clashText = !clash
    ? null
    : clash.kind === 'whole_taken'
      ? 'You have already proposed this whole run.'
      : clash.kind === 'parts_taken'
        ? 'Parts of this run are already proposed, so the whole run cannot be. Choose another part instead.'
        : `This overlaps “${clash.other.name}”, which you proposed from ${fmtRuleDistance(clash.other.from_m ?? 0, units)} to ${fmtRuleDistance(clash.other.to_m ?? 0, units)}.`;

  return (
    <Screen footer={<Button label="Submit for review" size="lg" arrow onPress={() => void submit()} loading={busy} disabled={!ready} />}>
      <Stack.Screen options={{ title: 'Propose a route' }} />
      {!proposalsOn ? <PausedNote feature="route_proposals_enabled" /> : suspended ? <SuspendedNotice what="compete" /> : null}
      <Segmented label="What to propose" value={mode} onChange={setMode} options={[{ value: 'whole', label: 'Whole run' }, { value: 'part', label: 'Part of this run' }]} />
      <MapCanvas height={260} layers={{ faint: whole ? undefined : full, path, markers }}
        accessibilityLabel={whole ? 'Your run, proposed whole, with its start and finish.' : `Your run, with the chosen part from ${fmtRuleDistance(fromM, units)} to ${fmtRuleDistance(toM, units)} highlighted.`} />
      {whole ? null : (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Txt variant="label">{`Start at ${fmtRuleDistance(live[0], units)}`}</Txt>
            <Slider testID="stretch-start" label="Start of the part" valueText={`Start at ${fmtRuleDistance(live[0], units)}`} value={live[0]} min={0} max={lengthM} step={10}
              accessibilityStep={100} highlight={live} onChange={(v) => slide(0, v)} onSlidingEnd={(v) => setRange(slide(0, v))} />
          </View>
          <View style={{ gap: spacing.xs }}>
            <Txt variant="label">{`End at ${fmtRuleDistance(live[1], units)}`}</Txt>
            <Slider testID="stretch-end" label="End of the part" valueText={`End at ${fmtRuleDistance(live[1], units)}`} value={live[1]} min={0} max={lengthM} step={10}
              accessibilityStep={100} highlight={live} onChange={(v) => slide(1, v)} onSlidingEnd={(v) => setRange(slide(1, v))} />
          </View>
          <Txt variant="caption">{`Your run is ${fmtRuleDistance(lengthM, units)}. Several parts of one run can be proposed, as long as they don’t overlap.`}</Txt>
        </Card>
      )}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="route" color={p.greenText} size={22} />
          <Txt variant="headline" style={{ flex: 1 }}>{`${preview ? fmtDistance(preview.lengthM, units) : '—'} · ${closed ? 'loop' : 'start to finish'}`}</Txt>
        </View>
        <Txt color="textMuted">Direction follows your run. Start and finish gates are placed across the path at each end; a reviewer may adjust gates and checkpoints and will check it is public, safe and not a duplicate.</Txt>
        {!lengthOk ? <Banner tone="warning" text={`Routes must be ${fmtRuleDistance(minM, units)}–${fmtRuleDistance(maxM, units)} long this season.${whole && lengthM > maxM ? ' Choose part of this run instead.' : ''}`} /> : null}
        {!shapeOk ? <Banner tone="warning" text={`Only loops can be proposed for now: the start and finish must be within ${meetM} m of each other. Move the start or the end until they meet.`} /> : null}
        {area ? <Banner tone="warning" text={`This passes within ${PROTECTED_MARGIN_M} m of your protected area${area.label ? ` “${area.label}”` : ''}, so it would be declined. Choose a part away from it.`} /> : null}
        {clashText ? <Banner tone="warning" text={clashText} /> : null}
        {areas.isError || existing.isError ? <Banner tone="warning" text="Your protected areas and earlier proposals could not be checked. Check your connection and try again." /> : null}
      </Card>
      <TextField label="Route name" value={name} onChangeText={setName} maxLength={60} />
      <ListGroup>
        <Toggle label="Publish this route geometry if approved" description="The course line (not your run’s timing or the rest of your trace) becomes visible to everyone in the competition. Required to submit." value={consent} onChange={setConsent} />
        <Toggle label="Count this run as the founding attempt" description={whole ? 'If approved, your time on this run can set the first record.' : 'If approved, your time over this part of the run can set the first record.'} value={founding} onChange={setFounding} />
      </ListGroup>
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
