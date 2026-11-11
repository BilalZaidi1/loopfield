import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigNumber, Button, Card, EmptyState, ErrorState, LoadingState, Txt } from '@/components/ui';
import { Icon } from '@/components/icons';
import { LoopMark, Wordmark } from '@/components/Brand';
import { usePublicActivity } from '@/features/share/api';
import { landLine, RouteSketch } from '@/features/share/RouteSketch';
import Constants from 'expo-constants';
import { fmtArea, fmtDay, fmtDistance, fmtDuration, fmtPace, splitValue } from '@/lib/format';
import { useSession, useUnits } from '@/state/session';
import { spacing, usePalette } from '@/theme/tokens';

/**
 * A public activity page, opened from a share link or QR code (signed in or not). It shows exactly what
 * the runner chose: the trimmed route, distance, time, pace and land. No health data, no exact start or
 * finish, nothing searchable; it stops working as soon as the runner turns the link off.
 */
const APP_SCHEME = (Array.isArray(Constants.expoConfig?.scheme) ? Constants.expoConfig?.scheme[0] : Constants.expoConfig?.scheme) ?? 'loopfield';

export default function PublicActivity() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const { session } = useSession();
  const { token } = useLocalSearchParams<{ token: string }>();
  const q = usePublicActivity(token);
  const d = q.data;
  const s = d?.summary ?? null;
  const dist = s?.distance_m != null ? splitValue(fmtDistance(s.distance_m, units)) : null;
  const land = landLine(d?.land ?? null);
  const stats = [
    s?.elapsed_ms != null ? `Time ${fmtDuration(s.elapsed_ms)}` : null,
    s?.avg_pace_s_per_km != null ? `Pace ${fmtPace(s.avg_pace_s_per_km, units)}` : null,
    s?.activity_date ? fmtDay(s.activity_date, { day: 'numeric', month: 'long', year: 'numeric' }) : null
  ].filter(Boolean) as string[];
  const appLink = `${APP_SCHEME}://a/${token}`;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ title: d ? `${d.runner.display_name}'s run` : 'Loopfield run' }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.huge, paddingHorizontal: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <LoopMark size={30} />
          <Wordmark size={22} />
        </View>
        {q.isLoading ? <LoadingState variant="cards" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? (
          <EmptyState icon="lock" title="This run is not available" body="The runner may have turned the link off, or the run is still being published (results appear 30 minutes after a run)." />
        ) : (
          <>
            <View style={{ gap: 2 }}>
              <Txt variant="title">{d.runner.display_name}</Txt>
              <Txt variant="caption">{`@${d.runner.handle}`}</Txt>
            </View>
            {d.route?.length || d.land?.cells?.length ? (
              <RouteSketch input={{ route: d.route, cells: d.land?.cells, taken: d.land?.taken }} height={320} accessibilityLabel="Route of the run with the land it holds. The first and last 200 m are not shown." />
            ) : null}
            <Card tone="violet">
              {dist ? <BigNumber value={dist.value} unit={dist.unit} size={72} /> : null}
              {stats.length ? <Txt>{stats.join('   ')}</Txt> : null}
              {land ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Icon name="hexagon" color="#FFFFFF" size={20} />
                  <Txt variant="label" style={{ flex: 1 }}>{`${land}${d.land?.area_m2 ? ` · ${fmtArea(d.land.area_m2, units)}` : ''}`}</Txt>
                </View>
              ) : null}
              {s?.achievement_title === 'route_title' ? <Txt variant="label">Took a route title on this run</Txt> : null}
            </Card>
            <Txt variant="caption">Green dot: start · orange or black dot: finish. The first and last 200 m of the run and the runner&apos;s private areas are never shown.</Txt>
            {Platform.OS === 'web' ? (
              <View style={{ gap: spacing.sm }}>
                <Button label="Open in Loopfield" arrow icon="external" onPress={() => void Linking.openURL(appLink).catch(() => {})} />
                <Txt variant="caption">Loopfield turns runs into territory: close a loop to hold the ground inside it.</Txt>
              </View>
            ) : session ? (
              <Button label="Back to Loopfield" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
