import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { buildCourse, decodePolyline, haversineMeters } from '@loopfield/core';
import { ROUTE_PUBLICATION_CONSENT_VERSION } from '@/config/env';
import { friendlyError, rpc } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDistance, fmtRuleDistance } from '@/lib/format';
import { useFeature } from '@/lib/appConfig';
import { useSpeedRules } from '@/lib/gameRules';
import { PausedNote, SuspendedNotice, useSuspended } from '@/components/Notices';
import { Banner, Button, Card, ListGroup, LoadingState, Screen, TextField, Toggle, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { spacing, usePalette } from '@/theme/tokens';
import { MapCanvas, type MapMarker } from '@/features/map/MapCanvas';
import { useActivityDetail } from '@/features/results/useActivity';
import { useUnits } from '@/state/session';

/** S26 Propose speed route — geometry, direction, gates, publication consent and submit. */
export default function ProposeRoute() {
  const p = usePalette();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const units = useUnits();
  const detail = useActivityDetail(activityId);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [founding, setFounding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The running season's route rules (back office), built-in when offline; reviewers and the server check again.
  const S = useSpeedRules();
  const proposalsOn = useFeature('route_proposals_enabled');
  const suspended = useSuspended();
  const a = detail.data?.activity;
  const points = useMemo(() => (a?.personal_route ? decodePolyline(a.personal_route) : []), [a]);
  const closed = points.length > 1 && haversineMeters(points[0]!, points[points.length - 1]!) <= S.corridorMeters.value * 1.5;
  const preview = useMemo(() => (points.length > 1 ? buildCourse(points, { closed }) : null), [points, closed]);
  if (detail.isLoading) return <LoadingState />;
  const path = points.map((x) => [x.lng, x.lat] as [number, number]);
  const markers: MapMarker[] = path.length ? [{ id: 's', coord: path[0]!, label: 'Start', kind: 'start' }, { id: 'f', coord: path[path.length - 1]!, label: 'Finish', kind: 'finish' }] : [];
  const lengthOk = preview ? preview.lengthM >= S.minCourseLengthMeters.value && preview.lengthM <= S.maxCourseLengthMeters.value : false;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc<string>('propose_route', { p_activity: activityId, p_name: name.trim(), p_consent_version: ROUTE_PUBLICATION_CONSENT_VERSION, p_score_founding_run: founding });
      await rpc('set_consent', { p_kind: 'route_publication', p_granted: true, p_version: ROUTE_PUBLICATION_CONSENT_VERSION });
      track('route_proposed', { outcome: 'submitted' });
      router.replace('/proposals');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label="Submit for review" size="lg" arrow onPress={() => void submit()} loading={busy} disabled={!consent || name.trim().length < 3 || !path.length || !lengthOk || busy || !proposalsOn || suspended} />}>
      <Stack.Screen options={{ title: 'Propose a route' }} />
      {!proposalsOn ? <PausedNote feature="route_proposals_enabled" /> : suspended ? <SuspendedNotice what="compete" /> : null}
      {!path.length ? <Banner tone="warning" text="This run has no processed route yet, so it cannot be proposed." /> : (
        <>
          <MapCanvas height={260} layers={{ path, markers }} accessibilityLabel="Proposed route geometry with start and finish." />
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="route" color={p.greenText} size={22} />
              <Txt variant="headline" style={{ flex: 1 }}>{`${preview ? fmtDistance(preview.lengthM, units) : '—'} · ${closed ? 'loop' : 'one way'}`}</Txt>
            </View>
            <Txt color="textMuted">Direction follows your run. Start and finish gates are placed across the path at each end; a reviewer may adjust gates and checkpoints and will check it is public, safe and not a duplicate.</Txt>
            {!lengthOk ? <Banner tone="warning" text={`Routes must be ${fmtRuleDistance(S.minCourseLengthMeters.value, units)}–${fmtRuleDistance(S.maxCourseLengthMeters.value, units)} long this season.`} /> : null}
          </Card>
        </>
      )}
      <TextField label="Route name" value={name} onChangeText={setName} maxLength={60} />
      <ListGroup>
        <Toggle label="Publish this route geometry if approved" description="The course line (not your run’s timing or the rest of your trace) becomes visible to everyone in the competition. Required to submit." value={consent} onChange={setConsent} />
        <Toggle label="Count this run as the founding attempt" description="If approved, your time on this run can set the first record." value={founding} onChange={setFounding} />
      </ListGroup>
      {error ? <Banner tone="danger" text={error} /> : null}
    </Screen>
  );
}
