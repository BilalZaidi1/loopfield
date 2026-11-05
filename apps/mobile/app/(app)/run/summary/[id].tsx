import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { Badge, Banner, Button, Card, EmptyState, Screen, StatTile, Txt } from '@/components/ui';
import { LandCard, TitleCards } from '@/features/results/ResultCards';
import { readLocalRun, useActivityDetail, type LocalRun } from '@/features/results/useActivity';
import { canExportRuns, exportRun } from '@/health/export';
import { PLATFORM_LABEL } from '@/health/sync';
import { processUploads } from '@/recording/uploader';
import { useSession, useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/** S22 Run summary — workout totals and separate land/title cards; validation status, share and optional export. */
export default function RunSummary() {
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

  if (!local) return <Screen><EmptyState title="Run not found on this phone" action={{ label: 'Activity history', onPress: () => router.replace('/activities') }} /></Screen>;
  const s = local.summary;
  const a = detail.data?.activity;
  const territoryRequested = local.mode === 'territory' || local.mode === 'territory_speed';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Run summary', headerBackVisible: false, headerRight: () => <Button variant="ghost" label="Done" onPress={() => router.replace('/home')} /> }} />
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <StatTile label="Distance" value={fmtDistance(a?.distance_m ?? s?.distanceM ?? 0, units)} />
          <StatTile label="Time" value={fmtDuration(a?.elapsed_ms ?? s?.elapsedMs ?? 0)} />
          <StatTile label="Pace" value={fmtPace(a?.avg_pace_s_per_km ?? s?.avgPaceSecPerKm ?? null, units)} />
        </View>
        {s?.gaps.length ? <Banner tone="warning" text={`${s.gaps.length} recording gap${s.gaps.length > 1 ? 's' : ''} (${Math.round(s.gaps.reduce((t, g) => t + g.seconds, 0))} s). Gaps are shown as missing, never filled in.`} /> : null}
        <Card accessibilityLabel="Upload status">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt variant="heading">Saved</Txt>
            <Badge label={uploaded ? 'Received by server' : local.uploadState === 'failed_permanent' ? 'Upload failed' : 'Waiting to upload'} tone={uploaded ? 'success' : local.uploadState === 'failed_permanent' ? 'danger' : 'info'} />
          </View>
          <Txt color="textMuted">
            {uploaded
              ? 'The server has your run and a durable receipt. Competitive results below come from the server.'
              : local.uploadState === 'failed_permanent'
                ? `The server could not accept this run (${local.lastError ?? 'unknown reason'}). It stays in your history on this phone.`
                : 'Saved on this phone. It uploads automatically when you are online.'}
          </Txt>
          {!uploaded && local.uploadState !== 'failed_permanent' && userId ? <Button variant="secondary" label="Upload now" onPress={() => void processUploads(userId).then(() => setLocal(readLocalRun(id!)))} /> : null}
        </Card>
        {local.mode === 'private' ? <Txt color="textMuted">Private run: kept for your own history only.</Txt> : null}
        {uploaded ? (
          <>
            {detail.error ? <Banner tone="danger" text={friendlyError(detail.error)} action={{ label: 'Retry', onPress: () => void detail.refetch() }} /> : null}
            <LandCard claim={detail.data?.claim ?? null} territoryRequested={territoryRequested} />
            <TitleCards attempts={detail.data?.attempts ?? []} context={detail.data?.title_context ?? []} />
          </>
        ) : territoryRequested || local.mode !== 'private' ? (
          <Txt variant="caption">Land and title results appear after the upload is checked.</Txt>
        ) : null}
        {uploaded ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Share" variant="secondary" onPress={() => router.push({ pathname: '/share/[id]', params: { id: id! } })} />
            <Button label="Activity details" variant="secondary" onPress={() => router.push({ pathname: '/activities/[id]', params: { id: id! } })} />
            {canExportRuns() && local.startedAt && local.endedAt ? (
              <Button
                variant="ghost"
                label={exported ? `Saved to ${PLATFORM_LABEL}` : `Save workout to ${PLATFORM_LABEL}`}
                disabled={exported}
                onPress={() =>
                  void exportRun({ activityId: id!, start: local.startedAt!, end: local.endedAt!, distanceM: a?.distance_m ?? s?.distanceM ?? 0 })
                    .then(() => setExported(true))
                    .catch((e) => Alert.alert('Not saved', friendlyError(e)))
                }
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
