import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { ActionBar, Badge, Banner, BigNumber, Button, Card, EmptyState, ListGroup, Row, Screen, Sheet, StatLine, Txt } from '@/components/ui';
import { RunPointsCard } from '@/features/movement/Reclaim';
import { Icon } from '@/components/icons';
import { Celebration } from '@/features/run/Celebration';
import { IntegrityCard, LandCard, TitleCards } from '@/features/results/ResultCards';
import { readLocalRun, useActivityDetail, type LocalRun } from '@/features/results/useActivity';
import { canExportRuns, exportRun } from '@/health/export';
import { PLATFORM_LABEL } from '@/health/sync';
import { processUploads } from '@/recording/uploader';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/** S22 Run summary — workout totals and separate land/title cards; validation status, share and optional export. */
export default function RunSummary() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const { userId } = useSession();
  const [local, setLocal] = useState<LocalRun | null>(() => (id ? readLocalRun(id) : null));
  const uploaded = local?.uploadState === 'received';
  const detail = useActivityDetail(id, uploaded);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (uploaded) return;
    const t = setInterval(() => setLocal(id ? readLocalRun(id) : null), 2000);
    return () => clearInterval(t);
  }, [id, uploaded]);

  useEffect(() => {
    if (detail.data?.claim && detail.data.claim.status !== 'processing') {
      track('claim_explained', { result_type: detail.data.claim.status === 'eligible' ? 'land' : 'none', viewed: true });
    }
  }, [detail.data?.claim?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const [more, setMore] = useState(false);
  const saveable = canExportRuns() && Boolean(local?.startedAt && local?.endedAt);
  const save = () =>
    void exportRun({ activityId: id!, start: local!.startedAt!, end: local!.endedAt!, distanceM: detail.data?.activity?.distance_m ?? local?.summary?.distanceM ?? 0 })
      .then(() => setExported(true))
      .catch((e) => Alert.alert('Not saved', friendlyError(e)));

  if (!local) return <Screen><EmptyState icon="record" title="Run not found on this phone" action={{ label: 'Activity history', onPress: () => router.replace('/activities') }} /></Screen>;
  const s = local.summary;
  const a = detail.data?.activity;
  const territoryRequested = local.mode === 'territory' || local.mode === 'territory_speed';
  const dist = splitValue(fmtDistance(a?.distance_m ?? s?.distanceM ?? 0, units));
  const gapSeconds = Math.round((s?.gaps ?? []).reduce((t, g) => t + g.seconds, 0));

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Run summary', headerBackVisible: false, headerRight: () => <Button variant="secondary" size="sm" label="Done" onPress={() => router.replace('/home')} /> }} />
      <Card tone="blue">
        <Celebration />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="record" color={p.blue} size={22} />
          </View>
          <Txt variant="headline" style={{ flex: 1 }}>{local.mode === 'private' ? 'Private run saved' : 'Run saved'}</Txt>
        </View>
        <BigNumber value={dist.value} unit={dist.unit} size={88} />
        <Txt color="textMuted">{units === 'metric' ? 'Kilometres' : 'Miles'}</Txt>
      </Card>
      <Card padded={false} style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.xs }}>
        <StatLine icon="stopwatch" label="Time" value={fmtDuration(a?.elapsed_ms ?? s?.elapsedMs ?? 0)} />
        <StatLine icon="speed" label="Avg pace" value={fmtPace(a?.avg_pace_s_per_km ?? s?.avgPaceSecPerKm ?? null, units)} />
        <StatLine icon="clock" label="Recording gaps" value={s?.gaps.length ? `${s.gaps.length} · ${gapSeconds} s` : 'None'} />
      </Card>
      {s?.gaps.length ? <Banner tone="warning" text={`${s.gaps.length} recording gap${s.gaps.length > 1 ? 's' : ''} (${gapSeconds} s). Gaps are shown as missing, never filled in.`} /> : null}
      <Card accessibilityLabel="Upload status">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name={uploaded ? 'check' : local.uploadState === 'failed_permanent' ? 'alert' : 'refresh'} color={uploaded ? p.success : local.uploadState === 'failed_permanent' ? p.danger : p.info} size={22} />
          <Txt variant="heading" style={{ flex: 1 }}>{uploaded ? 'Uploaded' : local.uploadState === 'failed_permanent' ? 'Upload failed' : 'Saved on this phone'}</Txt>
          <Badge label={uploaded ? 'Received by server' : local.uploadState === 'failed_permanent' ? 'Not accepted' : 'Waiting to upload'} tone={uploaded ? 'success' : local.uploadState === 'failed_permanent' ? 'danger' : 'info'} />
        </View>
        <Txt color="textMuted">
          {uploaded
            ? 'The server has your run and a durable receipt. Competitive results below come from the server.'
            : local.uploadState === 'failed_permanent'
              ? `The server could not accept this run (${local.lastError ?? 'unknown reason'}). It stays in your history on this phone.`
              : 'Saved on this phone. It uploads automatically when you are online.'}
        </Txt>
        {!uploaded && local.uploadState !== 'failed_permanent' && userId ? <Button variant="secondary" icon="refresh" label="Upload now" onPress={() => void processUploads(userId).then(() => setLocal(readLocalRun(id!)))} /> : null}
      </Card>
      {local.mode === 'private' ? <Txt color="textMuted">Private run: kept for your own history only.</Txt> : null}
      {uploaded ? (
        <>
          {detail.error ? <Banner tone="danger" text={friendlyError(detail.error)} action={{ label: 'Retry', onPress: () => void detail.refetch() }} /> : null}
          <IntegrityCard activity={detail.data?.activity} />
          <RunPointsCard activityId={id} />
          <LandCard claim={detail.data?.claim ?? null} territoryRequested={territoryRequested} />
          <TitleCards attempts={detail.data?.attempts ?? []} context={detail.data?.title_context ?? []} />
        </>
      ) : territoryRequested || local.mode !== 'private' ? (
        <Txt variant="caption">Land and title results appear after the upload is checked.</Txt>
      ) : null}
      {uploaded ? (
        <Card>
          <ActionBar
            actions={[
              { icon: 'share', label: 'Share', primary: true, accessibilityLabel: 'Share this run', onPress: () => router.push({ pathname: '/share/[id]', params: { id: id! } }) },
              ...(saveable
                ? [{ icon: 'pulse' as const, label: exported ? 'Saved' : 'Save', disabled: exported, accessibilityLabel: exported ? `Saved to ${PLATFORM_LABEL}` : `Save this workout to ${PLATFORM_LABEL}`, onPress: save }]
                : []),
              { icon: 'progress', label: 'Analytics', accessibilityLabel: 'Open the activity details and analytics', onPress: () => router.push({ pathname: '/activities/[id]', params: { id: id! } }) },
              { icon: 'more', label: 'More', accessibilityLabel: 'More options', onPress: () => setMore(true) }
            ]}
          />
        </Card>
      ) : null}
      <Sheet visible={more} title="More options" onClose={() => setMore(false)}>
        <ListGroup>
          {detail.data?.claim ? (
            <Row icon="flag" title="Request a review of the land result" subtitle="For example after a GPS error" onPress={() => { setMore(false); router.push({ pathname: '/appeals', params: { type: 'loop_claim', id: detail.data!.claim!.id } }); }} />
          ) : null}
          <Row icon="clock" title="Activity history" onPress={() => { setMore(false); router.replace('/activities'); }} />
          <Row icon="home" title="Back to Home" onPress={() => { setMore(false); router.replace('/home'); }} />
        </ListGroup>
      </Sheet>
    </Screen>
  );
}
