import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { localDayKey } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { fmtDuration, fmtRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Banner, Button, Card, EmptyState, ListGroup, Row, Screen, Txt } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { dailyValues, METRICS, sourcesFor, type MetricId } from '@/features/health/metrics';
import { PLATFORM_LABEL, STALE_AFTER_MS, syncHealth } from '@/health/sync';
import { deviceOffsetMin, useHealthConnection, useHealthDerived } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { radius, spacing, usePalette } from '@/theme/tokens';

const CARD_ORDER: MetricId[] = ['heart_rate', 'steps', 'calories', 'sleep', 'resting_hr', 'hrv_sdnn', 'hrv_rmssd', 'vo2_max'];

/** S37 Health dashboard — heart rate, zones, steps, calories, sleep, resting HR, HRV and VO2 max; sync status. */
export default function HealthDashboard() {
  const p = usePalette();
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
        <EmptyState icon="heart" title={`Connect ${PLATFORM_LABEL}`} body="See heart rate, steps, sleep and more in a private dashboard on this phone. Optional, and never used for competition." action={{ label: 'Set up', onPress: () => router.push('/health/connections') }} />
      </Screen>
    );
  }
  const stale = !conn.lastSyncAt || now - conn.lastSyncAt > STALE_AFTER_MS;
  return (
    <Screen onRefresh={() => void syncHealth()} refreshing={false}>
      <Stack.Screen options={{ title: 'Health', headerRight: () => <Button variant="secondary" size="sm" label="Sources" onPress={() => router.push('/health/connections')} /> }} />
      <View style={[styles.sync, { backgroundColor: conn.lastResult === 'error' ? p.dangerSoft : stale ? p.warningSoft : p.successSoft }]} accessibilityLabel="Sync status" accessible>
        <Icon name={conn.lastResult === 'error' ? 'alert' : stale ? 'clock' : 'check'} color={conn.lastResult === 'error' ? p.danger : stale ? p.warning : p.success} size={20} />
        <View style={{ flex: 1 }}>
          <Txt variant="label">{`${PLATFORM_LABEL} · ${conn.lastResult === 'error' ? 'sync failed' : stale ? 'not recently synced' : 'up to date'}`}</Txt>
          <Txt variant="caption">{conn.lastSyncAt ? `Last synced ${fmtRelative(new Date(conn.lastSyncAt).toISOString())}` : 'Not synced yet'}{conn.historyLimitedTo ? ` · up to ${conn.historyLimitedTo} days of history` : ''}. Pull down to sync.</Txt>
        </View>
      </View>
      {conn.lastResult === 'no_data' ? <Txt variant="caption">No readable data was found. On iPhone, the Health app does not say whether access was declined, so check Settings → Health → Data Access if you expected data.</Txt> : null}
      {cards.length === 0 ? <EmptyState icon="pulse" title="No cards enabled" action={{ label: 'Choose data types', onPress: () => router.push('/health/connections') }} /> : null}
      <View style={styles.grid}>
        {cards.map((c) => {
          if (disabled.data?.includes(c.meta.card)) {
            return <View key={c.id} style={{ flexBasis: '100%' }}><Banner tone="warning" text={`${c.meta.title} is temporarily unavailable while a data-quality problem is fixed.`} /></View>;
          }
          const value = c.todayValue ?? c.lastValue;
          const label = c.todayValue != null ? 'Today' : c.lastDay ? `Latest (${c.lastDay})` : 'No readable data';
          return (
            <Card key={c.id} style={styles.tile} onPress={() => router.push({ pathname: '/health/metric/[type]', params: { type: c.id } })} accessibilityLabel={`${c.meta.title}. ${label}${value != null ? `: ${value.toFixed(c.meta.digits)} ${c.meta.unit}` : ''}`}>
              <View style={[styles.tileIcon, { backgroundColor: p.greenSoft }]}>
                <Icon name={ICONS[c.id] ?? 'pulse'} color={p.greenText} size={20} />
              </View>
              <Txt variant="label" color="textMuted" numberOfLines={1}>{c.meta.title}</Txt>
              {value != null ? (
                <Txt variant="metric" style={{ fontSize: 28, lineHeight: 32 }} numberOfLines={1}>
                  {c.id === 'sleep' ? fmtDuration(value * 3_600_000) : value.toFixed(c.meta.digits)}
                  <Txt variant="label" color="textMuted" style={{ fontStyle: 'normal', fontWeight: '600' }}>{c.id === 'sleep' ? '' : ` ${c.meta.unit}`}</Txt>
                </Txt>
              ) : <Txt color="textMuted">No data</Txt>}
              <Txt variant="caption" numberOfLines={2}>{label}{c.sources.length ? ` · ${c.sources.length === 1 ? c.sources[0] : `${c.sources.length} sources`}` : ''}</Txt>
            </Card>
          );
        })}
      </View>
      {conn.enabledCards.includes('zones') || conn.enabledCards.includes('heart_rate') ? (
        <ListGroup>
          <Row icon="pulse" title="Heart rate zones" subtitle="Time in each zone for your runs" onPress={() => router.push('/health/zones')} />
        </ListGroup>
      ) : null}
      <Txt variant="caption" style={{ marginTop: spacing.md }}>These summaries describe data recorded by your devices. They are not medical advice, a diagnosis or a fitness assessment. Missing days are shown as missing, never as zero.</Txt>
    </Screen>
  );
}

const ICONS: Partial<Record<MetricId, IconName>> = { heart_rate: 'heart', steps: 'record', calories: 'flame', sleep: 'moon', resting_hr: 'heart', hrv_sdnn: 'pulse', hrv_rmssd: 'pulse', vo2_max: 'bolt' };

const styles = StyleSheet.create({
  sync: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexBasis: '46%', flexGrow: 1, gap: spacing.xs, padding: spacing.lg },
  tileIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs }
});
