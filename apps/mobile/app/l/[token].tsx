import { useEffect, useRef } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner, BigNumber, Button, Card, EmptyState, ErrorState, LoadingState, Txt } from '@/components/ui';
import { LoopMark, Wordmark } from '@/components/Brand';
import { countLiveView, usePublicLiveLink } from '@/features/live/api';
import { fmtElapsed, freshness, liveHeadline, mapsLink } from '@/features/live/pageText';
import { LiveTrail } from '@/features/live/LiveTrail';
import { NoIndex } from '@/features/live/NoIndex';
import { fmtDate, fmtDistance, splitValue } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/**
 * A live link's page (R1), opened by the people a runner sent it to, signed in or not. It shows the runner's
 * name, the trail of this run, how long they have been running and how far, refreshing by itself. Nothing
 * else: no profile, no health data, no land. Positions near the runner's private places are never sent here
 * unless the runner chose to show them; the page stops showing the run shortly after it ends.
 */
export default function LiveLinkPage() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const { session } = useSession();
  const { token } = useLocalSearchParams<{ token: string }>();
  const q = usePublicLiveLink(token);
  const now = useNow(5_000);
  const counted = useRef<string | null>(null);

  // One opening per page load; the refreshes after it are not counted.
  useEffect(() => {
    if (!token || counted.current === token) return;
    counted.current = token;
    void countLiveView(token);
  }, [token]);

  const d = q.data;
  const head = d ? liveHeadline(d) : null;
  const active = d && (d.status === 'running' || d.status === 'paused' || d.status === 'finished');
  const dist = active && d.distance_m != null ? splitValue(fmtDistance(d.distance_m, units)) : null;
  const startedMs = d?.started_at ? new Date(d.started_at).getTime() : null;
  const untilMs = d?.status === 'finished' && d.last_update ? new Date(d.last_update).getTime() : now;
  const fresh = d?.status === 'running' ? freshness(d.last_update, now) : null;
  const stats = active && startedMs ? [
    `${d.status === 'finished' ? 'Ran for' : 'Running for'} ${fmtElapsed(untilMs - startedMs)}`,
    `Started ${fmtDate(startedMs, { hour: 'numeric', minute: '2-digit' })}`
  ] : [];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <NoIndex />
      <Stack.Screen options={{ title: d ? `${d.name}: live location` : 'Loopfield live location' }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.huge, paddingHorizontal: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <LoopMark size={30} />
          <Wordmark size={22} />
        </View>
        {q.isLoading ? <LoadingState variant="cards" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} support={false} /> : !d || !head ? (
          <EmptyState icon="lock" title="This live link is not available" body="The runner may have turned it off or changed it. Ask them for a new link." />
        ) : (
          <>
            <View style={{ gap: spacing.xs }} accessibilityLiveRegion="polite">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {d.status === 'running' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.danger }} accessibilityElementsHidden /> : null}
                <Txt variant="title" style={{ flex: 1 }}>{head.title}</Txt>
              </View>
              {head.body ? <Txt variant="caption">{head.body}</Txt> : null}
              {fresh ? <Txt variant="caption" color={fresh.stale ? 'danger' : undefined}>{fresh.text}</Txt> : null}
            </View>
            {active ? (
              <LiveTrail trail={d.trail ?? []} last={d.last ?? null} height={340}
                accessibilityLabel={`Map of ${d.name}'s run so far${d.last ? ', with a dot where they are now' : ''}.`} />
            ) : null}
            {active && d.hidden ? (
              <Banner tone="info" text={`${d.name} is in one of their protected areas, so where they are is hidden for now.`} />
            ) : null}
            {dist || stats.length ? (
              <Card tone="violet">
                {dist ? <BigNumber value={dist.value} unit={dist.unit} size={64} /> : null}
                {stats.length ? <Txt>{stats.join('   ')}</Txt> : null}
              </Card>
            ) : null}
            {active && d.last ? (
              <Button variant="secondary" icon="external" label="Open in maps" onPress={() => void Linking.openURL(mapsLink(d.last!)).catch(() => {})} />
            ) : null}
            <Txt variant="caption">
              {`${d.name} sent you this link from Loopfield. Only people with the link can see it, and it shows nothing outside their runs. Where they have been is deleted soon after each run.`}
            </Txt>
            {Platform.OS !== 'web' && session ? (
              <Button label="Back to Loopfield" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
