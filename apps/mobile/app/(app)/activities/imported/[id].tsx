import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { fmtDate, fmtDistance, fmtDuration, fmtPace } from '@/lib/format';
import { useAppConfig } from '@/lib/appConfig';
import { Banner, Button, Card, EmptyState, Screen, Section, Txt } from '@/components/ui';
import { MapCanvas } from '@/features/map/MapCanvas';
import { PLATFORM_LABEL } from '@/health/sync';
import { useHealthDerived } from '@/health/useHealth';
import { IMPORTED_ROUTES_CARD, importedMapsSupported, keptRouteFor, routeRecordIds, showImportedRoute, useImportedMapsOn, type ImportedRoute } from '@/health/routes';
import { useUnits } from '@/state/session';
import { spacing } from '@/theme/tokens';

/**
 * An imported run (R3): its numbers from the health app and, on Android, its map once the runner shows it.
 * Imported runs stay on this phone, never earn land, titles, points or challenges, and their maps can't be shared.
 */
export default function ImportedRun() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const units = useUnits();
  const { settings } = useAppConfig();
  const health = useHealthDerived();
  const mapsOn = useImportedMapsOn();
  const s = health.sessions.find((x) => x.id === id && x.imported) ?? null;
  const records = useMemo(() => (s ? routeRecordIds(s, health.store) : []), [s, health.store]);
  const [shown, setShown] = useState<ImportedRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const route = shown ?? (mapsOn ? keptRouteFor(records) : null);
  const mapsAllowed = importedMapsSupported() && !settings.disabledHealthCards.includes(IMPORTED_ROUTES_CARD);

  if (!s) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Imported run' }} />
        <EmptyState icon="pulse" title="This run isn't on this phone any more" body={`Imported runs come from ${PLATFORM_LABEL} and are kept here for a limited time.`} />
      </Screen>
    );
  }
  const show = async () => {
    setBusy(true);
    try {
      setShown(await showImportedRoute(records, s.end));
    } finally {
      setBusy(false);
    }
  };
  const durationMs = s.end - s.start;
  return (
    <Screen>
      <Stack.Screen options={{ title: s.activity === 'running' ? 'Imported run' : 'Imported walk' }} />
      <Txt variant="caption">{`${fmtDate(s.start, { dateStyle: 'full', timeStyle: 'short' })} · from ${s.primarySourceId}`}</Txt>
      <Card>
        <Txt variant="title" tabular>{s.distanceM != null ? fmtDistance(s.distanceM, units) : 'Distance not recorded'}</Txt>
        <Txt tabular>{`${fmtDuration(durationMs)}${s.distanceM ? ` · ${fmtPace(durationMs / 1000 / (s.distanceM / 1000), units)}` : ''}`}</Txt>
      </Card>
      {mapsAllowed ? (
        <Section title="Map" icon="map">
          {route?.kind === 'route' ? (
            <MapCanvas height={260} layers={{ path: route.points }} accessibilityLabel="Map of this imported run, seen only by you" />
          ) : route?.kind === 'none' ? (
            <Txt>This run was saved without a map.</Txt>
          ) : !mapsOn ? (
            <View style={{ gap: spacing.sm }}>
              <Txt>Turn on Show maps for imported runs to see where this run went.</Txt>
              <Button variant="secondary" label="Health connections" onPress={() => router.push('/health/connections')} />
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {route?.kind === 'declined' ? <Banner tone="info" text="Android didn't share this route. Tap Show map to be asked again." /> : null}
              <Button icon="map" label="Show map" loading={busy} disabled={busy} onPress={() => void show()} />
              <Txt variant="caption">For a route another app recorded, Android asks you once for this run.</Txt>
            </View>
          )}
        </Section>
      ) : null}
      <Txt variant="caption">{"Imported runs stay on this phone. They never earn land, titles, points or challenges, and their maps can't be shared."}</Txt>
    </Screen>
  );
}
