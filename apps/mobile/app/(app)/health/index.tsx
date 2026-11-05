import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { localDayKey } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { fmtDuration, fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Badge, Banner, Button, Card, EmptyState, Screen, Txt } from '@/components/ui';
import { dailyValues, METRICS, sourcesFor, type MetricId } from '@/features/health/metrics';
import { PLATFORM_LABEL, STALE_AFTER_MS, syncHealth } from '@/health/sync';
import { deviceOffsetMin, useHealthConnection, useHealthDerived } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { spacing } from '@/theme/tokens';

const CARD_ORDER: MetricId[] = ['heart_rate', 'steps', 'calories', 'sleep', 'resting_hr', 'hrv_sdnn', 'hrv_rmssd', 'vo2_max'];

/** S37 Health dashboard — heart rate, zones, steps, calories, sleep, resting HR, HRV and VO2 max; sync status. */
export default function HealthDashboard() {
  const conn = useHealthConnection();
  const d = useHealthDerived();
  const disabled = useQuery({
    queryKey: ['app_config', 'disabled_health_cards'],
    staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase().from('app_config').select('value').eq('key', 'disabled_health_cards').maybeSingle()).data?.value as string[] | undefined) ?? []
  });
  useEffect(() => track('health_viewed', { screen: 'dashboard', session_count: d.sessions.length }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow();
  const today = localDayKey(now, deviceOffsetMin());
  const cards = useMemo(
    () =>
      CARD_ORDER.filter((id) => conn.enabledCards.includes(METRICS[id].card)).map((id) => {
        const daily = dailyValues(id, d);
        const days = [...daily.keys()].sort();
        const lastDay = days[days.length - 1];
        return { id, meta: METRICS[id], todayValue: daily.get(today) ?? null, lastDay, lastValue: lastDay ? daily.get(lastDay)! : null, sources: sourcesFor(id, d) };
      }),
    [conn.enabledCards, d, today]
  );

  if (!conn.connected) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Health' }} />
        <EmptyState title={`Connect ${PLATFORM_LABEL}`} body="See heart rate, steps, sleep and more in a private dashboard on this phone. Optional, and never used for competition." action={{ label: 'Set up', onPress: () => router.push('/health/connections') }} />
      </Screen>
    );
  }
  const stale = !conn.lastSyncAt || now - conn.lastSyncAt > STALE_AFTER_MS;
  return (
    <Screen onRefresh={() => void syncHealth()} refreshing={false}>
      <Stack.Screen options={{ title: 'Health', headerRight: () => <Button variant="ghost" label="Sources" onPress={() => router.push('/health/connections')} /> }} />
      <Card accessibilityLabel="Sync status">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt variant="label">{PLATFORM_LABEL}</Txt>
          <Badge label={conn.lastResult === 'error' ? 'Sync failed' : stale ? 'Not recently synced' : 'Up to date'} tone={conn.lastResult === 'error' ? 'danger' : stale ? 'warning' : 'success'} />
        </View>
        <Txt variant="caption">{conn.lastSyncAt ? `Last synced ${fmtRelative(new Date(conn.lastSyncAt).toISOString())}` : 'Not synced yet'}{conn.historyLimitedTo ? ` · up to ${conn.historyLimitedTo} days of history` : ''}. Pull down to sync.</Txt>
        {conn.lastResult === 'no_data' ? <Txt variant="caption">No readable data was found. On iPhone, the Health app does not say whether access was declined, so check Settings → Health → Data Access if you expected data.</Txt> : null}
      </Card>
      {cards.length === 0 ? <EmptyState title="No cards enabled" action={{ label: 'Choose data types', onPress: () => router.push('/health/connections') }} /> : null}
      {cards.map((c) => {
        if (disabled.data?.includes(c.meta.card)) {
          return <Banner key={c.id} tone="warning" text={`${c.meta.title} is temporarily unavailable while a data-quality problem is fixed.`} />;
        }
        const value = c.todayValue ?? c.lastValue;
        const label = c.todayValue != null ? 'Today' : c.lastDay ? `Latest (${c.lastDay})` : 'No readable data';
        return (
          <Card key={c.id} onPress={() => router.push({ pathname: '/health/metric/[type]', params: { type: c.id } })} accessibilityLabel={`${c.meta.title}. ${label}${value != null ? `: ${value.toFixed(c.meta.digits)} ${c.meta.unit}` : ''}`}>
            <Txt variant="heading">{c.meta.title}</Txt>
            {value != null ? <Txt variant="title">{c.id === 'sleep' ? fmtDuration(value * 3_600_000) : value.toFixed(c.meta.digits)} <Txt variant="label" color="textMuted">{c.id === 'sleep' ? 'asleep' : c.meta.unit}</Txt></Txt> : <Txt color="textMuted">No readable data</Txt>}
            <Txt variant="caption">{label}{c.sources.length ? ` · ${c.sources.length === 1 ? c.sources[0] : `${c.sources.length} sources`}` : ''}</Txt>
          </Card>
        );
      })}
      {conn.enabledCards.includes('zones') || conn.enabledCards.includes('heart_rate') ? <Button variant="secondary" label="Heart rate zones" onPress={() => router.push('/health/zones')} /> : null}
      <Txt variant="caption" style={{ marginTop: spacing.md }}>These summaries describe data recorded by your devices. They are not medical advice, a diagnosis or a fitness assessment. Missing days are shown as missing, never as zero.</Txt>
    </Screen>
  );
}
