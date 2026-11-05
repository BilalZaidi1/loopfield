import { useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { comparePeriods, type PeriodDays } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { BarChart, DataTable } from '@/components/charts';
import { Card, EmptyState, Screen, Section, Segmented, Txt } from '@/components/ui';
import { dailyValues, lastNDays, METRICS, sourcesFor, type MetricId } from '@/features/health/metrics';
import { deviceOffsetMin, useHealthDerived } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { fmtDay } from '@/lib/format';

/** S38 Metric detail — period chart, values, source, units, method, coverage, gaps and comparable-period change. */
export default function MetricDetail() {
  const { type } = useLocalSearchParams<{ type: MetricId }>();
  const meta = METRICS[type];
  const d = useHealthDerived();
  const [period, setPeriod] = useState<'7' | '28' | '90'>('28');
  const now = useNow(60_000);
  useEffect(() => track('health_viewed', { screen: 'metric_detail', session_count: d.sessions.length }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const daily = useMemo(() => (meta ? dailyValues(type, d) : new Map<string, number>()), [meta, type, d]);
  const days = lastNDays(Number(period));
  const cmp = useMemo(() => comparePeriods(daily, Number(period) as PeriodDays, now, deviceOffsetMin(), 0.8, meta?.mode ?? 'total'), [daily, period, meta, now]);
  if (!meta) return <Screen><EmptyState icon="pulse" title="Unknown metric" /></Screen>;
  const sources = sourcesFor(type, d);
  const covered = days.filter((k) => daily.has(k)).length;
  const fmt = (v: number) => (type === 'sleep' ? `${v.toFixed(1)} h` : v.toFixed(meta.digits));
  return (
    <Screen>
      <Stack.Screen options={{ title: meta.title }} />
      <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '28', label: '28 days' }, { value: '90', label: '90 days' }]} />
      <Card>
        <BarChart title={`${meta.title} per day (${meta.unit})`} unit={meta.unit} data={days.map((k) => ({ label: fmtDay(k), value: daily.get(k) ?? null }))} format={fmt} />
      </Card>
      <Card accessibilityLabel="Coverage and comparison">
        <Txt>Data on {covered} of {days.length} days{covered < days.length ? ' — days without readings are left empty, not counted as zero' : ''}.</Txt>
        {cmp.reason === 'ok' && cmp.changePct != null ? (
          <Txt>
            {meta.mode === 'total' ? 'Total' : 'Average'} vs the previous {period} complete days: {cmp.changePct > 0 ? '+' : ''}{cmp.changePct}%
          </Txt>
        ) : (
          <Txt color="textMuted">{cmp.reason === 'insufficient_coverage' ? 'Not enough days with data in both periods to compare fairly (80% needed).' : 'No data to compare yet.'}</Txt>
        )}
        <Txt variant="caption">Comparisons use complete days only, so today is not included.</Txt>
      </Card>
      <Section title="About this data" icon="info">
        <Txt variant="caption">{meta.note}</Txt>
        <Txt variant="caption">Unit: {meta.unit}. Sources: {sources.length ? sources.join(', ') : 'none yet'}.</Txt>
        <Txt variant="caption">Descriptive only — not medical advice.</Txt>
      </Section>
      <Section title="Values" icon="calendar">
        <DataTable header={['Day', meta.unit]} rows={[...days].reverse().map((k) => [fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }), daily.has(k) ? fmt(daily.get(k)!) : 'no data'])} />
      </Section>
    </Screen>
  );
}
