import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { friendlyError } from '@/lib/api';
import { PAUSED_TEXT, useAppConfig } from '@/lib/appConfig';
import { fmtDistance } from '@/lib/format';
import { Banner, Button, confirm, EmptyState, ErrorState, ListGroup, LoadingState, ProgressBar, Row, Screen, Sheet, Txt } from '@/components/ui';
import { mapAvailability } from '@/features/map/MapCanvas';
import { deletePlannedRoute, routeLine, usePlannedRoutes, type PlannedRoute } from '@/features/plan/api';
import { downloadRoute, estimateOfflineBytes, offlineState, removeOffline, sizeLabel, type OfflineState } from '@/features/plan/offline';
import { useUnits } from '@/state/session';
import { spacing, useTheme } from '@/theme/tokens';

/** Planned routes (R1): the runner's own routes, to follow on a run, edit, keep offline or delete. */
export default function PlannedRoutes() {
  const units = useUnits();
  const { settings } = useAppConfig();
  const { saved } = useLocalSearchParams<{ saved?: string }>();
  const routes = usePlannedRoutes();
  const [open, setOpen] = useState<PlannedRoute | null>(null);
  const canMap = mapAvailability().ok;
  return (
    <Screen onRefresh={() => void routes.refetch()} refreshing={routes.isRefetching}>
      <Stack.Screen options={{ title: 'Planned routes' }} />
      {saved ? <Banner tone="success" text="Route saved. Choose it on the Record tab to follow it on a run." /> : null}
      {!settings.enabled.route_builder_enabled ? <Banner tone="info" text={PAUSED_TEXT.route_builder_enabled} /> : null}
      {canMap ? (
        <Button label="Plan a route" icon="plus" onPress={() => router.push('/plan')} disabled={!settings.enabled.route_builder_enabled} />
      ) : (
        <Txt variant="caption">Planning and following routes needs the Loopfield phone app.</Txt>
      )}
      {routes.isLoading ? <LoadingState variant="rows" /> : routes.error ? <ErrorState error={routes.error} onRetry={() => void routes.refetch()} /> : !routes.data?.length ? (
        <EmptyState icon="route" title="No planned routes yet" body="Plan a route on the map, then follow it on a run. You'll be told if you go off it." />
      ) : (
        <ListGroup>
          {routes.data.map((r) => (
            <Row key={r.id} icon="route" title={r.name} subtitle={`${fmtDistance(r.distance_m, units)}${r.is_loop ? ' · loop' : ''}`} onPress={() => setOpen(r)} />
          ))}
        </ListGroup>
      )}
      <Txt variant="caption">Only you can see your planned routes. Following one never changes how a run counts for land or titles.</Txt>
      <RouteActions key={open?.id ?? 'none'} route={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}

function RouteActions({ route, onClose }: { route: PlannedRoute | null; onClose: () => void }) {
  const t = useTheme();
  const units = useUnits();
  const [offline, setOffline] = useState<OfflineState | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new sheet per route (see the key above), so only the offline state needs loading here.
  useEffect(() => {
    if (route) void offlineState(route.id).then(setOffline);
  }, [route]);

  if (!route) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  const estimate = estimateOfflineBytes(routeLine(route));
  const download = async () => {
    setError(null);
    setProgress(0);
    try {
      await downloadRoute(route.id, routeLine(route), t.mapStyleUrl, (pct) => {
        setProgress(pct);
        if (pct >= 100) void offlineState(route.id).then(setOffline);
      });
    } catch (e) {
      setProgress(null);
      setError(friendlyError(e));
    }
  };
  return (
    <Sheet visible onClose={onClose} title={route.name}>
      <View style={{ gap: spacing.md }}>
        <Txt>{`${fmtDistance(route.distance_m, units)}${route.is_loop ? ', a loop' : ''}${route.snapped ? ', following paths' : ''}.`}</Txt>
        <Button label="Follow on my next run" icon="play" onPress={() => { onClose(); router.push({ pathname: '/run/active', params: { plan: route.id } }); }} />
        <Button variant="secondary" icon="edit" label="Edit" onPress={() => { onClose(); router.push({ pathname: '/plan', params: { id: route.id } }); }} />
        {offline?.state === 'unavailable' ? null : progress !== null && progress < 100 ? (
          <View style={{ gap: spacing.xs }}>
            <Txt variant="label">{`Downloading the map… ${progress}%`}</Txt>
            <ProgressBar value={progress / 100} />
          </View>
        ) : offline?.state === 'ready' || progress === 100 ? (
          <Button variant="secondary" icon="download" label="Remove the offline map" onPress={() => void removeOffline(route.id).then(() => setOffline({ state: 'none' }))} />
        ) : (
          <>
            <Button variant="secondary" icon="download" label="Download for offline" onPress={() => void download()} />
            <Txt variant="caption">{`Keeps the map 500 m either side of the route on this phone (${estimate ? sizeLabel(estimate) : 'a few MB'}), so you can follow it with no signal.`}</Txt>
          </>
        )}
        {error ? <Banner tone="danger" text={error} /> : null}
        <Button variant="ghost" icon="trash" label="Delete route" onPress={() => confirm('Delete this route?', 'It is removed from your planned routes. Runs you did along it stay.', 'Delete', () => {
          void deletePlannedRoute(route).then(() => removeOffline(route.id)).then(onClose).catch((e) => setError(friendlyError(e)));
        })} />
      </View>
    </Sheet>
  );
}
