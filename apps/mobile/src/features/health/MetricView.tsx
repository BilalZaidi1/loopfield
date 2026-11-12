import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { comparePeriods, localDayKey, type PeriodDays } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { DataTable } from '@/components/charts';
import { CalendarHeat, ColumnChart, RangeChart, StageBar, TrendLine } from '@/components/healthCharts';
import { Button, Card, EmptyState, Screen, Section, Segmented, Txt } from '@/components/ui';
import { dailyValues, lastNDays, METRICS, sourcesFor, type MetricId, type MetricMeta } from '@/features/health/metrics';
import { dailyRanges, fmtClock, fmtHoursMinutes, mean, periodPoints, quantile, sleepSummary, weeklyRanges, type PeriodPoint, type Stage } from '@/features/health/series';
import { deviceOffsetMin, type useHealthDerived } from '@/health/useHealth';
import { useNow } from '@/lib/useNow';
import { fmtDay } from '@/lib/format';
import { spacing } from '@/theme/tokens';

type Period = '7' | '28' | '90';
type Derived = ReturnType<typeof useHealthDerived>;

const int = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(v));
const dec = (v: number, digits: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
const longDay = (k: string) => fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' });
const dayTime = (t: number) => `${longDay(localDayKey(t, deviceOffsetMin()))}, ${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(t))}`;

/** Where each kind of reading comes from, for the empty state. */
const SOURCE_HINT: Partial<Record<MetricId, string>> = {
  steps: 'Steps come from your phone or a watch.',
  calories: 'Active calories come from a watch, a band or a fitness app.',
  sleep: 'Sleep comes from a watch, a band or a sleep app.',
  heart_rate: 'Heart rate comes from a watch or band.',
  resting_hr: 'Resting heart rate is worked out by a watch or band, usually from wearing it overnight.',
  hrv_sdnn: 'Heart rate variability comes from a watch that measures it, usually overnight.',
  hrv_rmssd: 'Heart rate variability comes from a watch that measures it, usually overnight.',
  vo2_max: 'Some watches estimate VO₂ max after outdoor walks and runs.',
  cadence: 'Cadence comes from a watch or a running sensor.',
  elevation: 'Elevation comes from your phone or a watch with a barometer.'
};

/**
 * S38 Metric detail (the screen body; the route reads the metric and the phone's health data). Each metric gets the form that suits it: steps as columns per day, active calories as
 * a calendar, sleep as nightly time asleep with an average night's stages, heart rate as each day's range,
 * resting heart rate and HRV as trends with your usual range, VO₂ max as its estimates over time. Long
 * periods are drawn in weeks; there is no long list of values (the numbers are one tap away instead).
 * Coverage, the comparable-period change, sources and method stay on every screen.
 */
export function MetricView({ type, d }: { type: MetricId; d: Derived }) {
  const meta = METRICS[type];
  const [period, setPeriod] = useState<Period>('28');
  const now = useNow(60_000);
  useEffect(() => track('health_viewed', { screen: 'metric_detail', session_count: d.sessions.length }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const daily = useMemo(() => (meta ? dailyValues(type, d) : new Map<string, number>()), [meta, type, d]);
  const days = useMemo(() => lastNDays(Number(period)), [period, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmp = useMemo(() => comparePeriods(daily, Number(period) as PeriodDays, now, deviceOffsetMin(), 0.8, meta?.mode ?? 'total'), [daily, period, meta, now]);
  if (!meta) return <Screen><EmptyState icon="pulse" title="Unknown metric" /></Screen>;
  const covered = days.filter((k) => daily.has(k)).length;
  const sources = sourcesFor(type, d);
  const props: BodyProps = { type, meta, d, daily, days, period };
  return (
    <Screen>
      <Stack.Screen options={{ title: meta.title }} />
      <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '28', label: '28 days' }, { value: '90', label: '90 days' }]} />
      {covered === 0 ? (
        <EmptyState icon="pulse" title={`No ${meta.title.toLowerCase()} in the last ${period} days`}
          body={`${SOURCE_HINT[type] ?? ''} If you expected readings, check that Loopfield can read them in Sources.`.trim()}
          action={{ label: 'Sources', onPress: () => router.push('/health/connections') }} />
      ) : (
        <>
          {type === 'steps' || type === 'elevation' ? <DailyColumns {...props} /> : null}
          {type === 'calories' ? <CalendarBody {...props} /> : null}
          {type === 'sleep' ? <SleepBody {...props} /> : null}
          {type === 'heart_rate' ? <HeartRateBody {...props} /> : null}
          {type === 'resting_hr' || type === 'hrv_sdnn' || type === 'hrv_rmssd' || type === 'cadence' ? <TrendBody {...props} /> : null}
          {type === 'vo2_max' ? <EstimateBody {...props} /> : null}
          <Txt variant="caption">
            {`Readings on ${covered} of ${days.length} days${covered < days.length ? '; days without readings are left out, never counted as zero' : ''}. `}
            {cmp.reason === 'ok' && cmp.changePct != null
              ? `${meta.mode === 'total' ? 'Total' : 'Average'} ${cmp.changePct === 0 ? 'the same as' : `${Math.abs(cmp.changePct)}% ${cmp.changePct > 0 ? 'higher than' : 'lower than'}`} the ${period} complete days before.`
              : cmp.reason === 'insufficient_coverage' ? 'Too few days with readings to compare with the period before (80% needed).' : ''}
          </Txt>
        </>
      )}
      <Section title="About this data" icon="info">
        <Txt variant="caption">{meta.note}</Txt>
        <Txt variant="caption">{`Unit: ${meta.unit}. Sources: ${sources.length ? sources.join(', ') : 'none yet'}.`}</Txt>
        <Txt variant="caption">Descriptive only, not medical advice.</Txt>
      </Section>
    </Screen>
  );
}

interface BodyProps {
  type: MetricId;
  meta: MetricMeta;
  d: Derived;
  daily: Map<string, number>;
  days: string[];
  period: Period;
}

/** The figure a metric leads with: a large number, its unit, and one line of context. */
function Lead({ value, unit, caption }: { value: string; unit: string; caption?: string | null }) {
  return (
    <View style={{ gap: 2 }} accessible accessibilityLabel={`${value} ${unit}${caption ? `. ${caption}` : ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing.sm }}>
        <Txt variant="title" style={{ fontSize: 48, lineHeight: 56, letterSpacing: -1.2 }}>{value}</Txt>
        <Txt variant="headline" color="textMuted">{unit}</Txt>
      </View>
      {caption ? <Txt color="textMuted">{caption}</Txt> : null}
    </View>
  );
}

/** Two short facts side by side (best day, lowest reading and so on). */
function Facts({ items }: { items: ({ label: string; value: string; caption?: string } | null)[] }) {
  const list = items.filter(Boolean) as { label: string; value: string; caption?: string }[];
  if (!list.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {list.map((f) => (
        <Card key={f.label} style={{ flex: 1, gap: 2, padding: spacing.lg }} accessibilityLabel={`${f.label}: ${f.value}${f.caption ? `, ${f.caption}` : ''}`}>
          <Txt variant="caption">{f.label}</Txt>
          <Txt variant="headline">{f.value}</Txt>
          {f.caption ? <Txt variant="caption">{f.caption}</Txt> : null}
        </Card>
      ))}
    </View>
  );
}

/** The numbers behind a chart, only the days (or weeks) with readings, newest first; hidden until asked for. */
function Numbers({ header, rows }: { header: [string, string]; rows: string[][] }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Button variant="ghost" size="sm" icon={open ? 'minus' : 'plus'} label={open ? 'Hide the numbers' : 'Show the numbers'} onPress={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }} />
      {open ? <DataTable header={header} rows={rows} /> : null}
    </View>
  );
}

const pointRows = (points: PeriodPoint[], fmt: (v: number) => string) =>
  [...points].reverse().filter((x) => x.value != null).map((x) => [x.long, `${fmt(x.value!)}${x.span > 1 ? ` (${x.covered} of ${x.span} days)` : ''}`]);

/** Steps and elevation: a column per day (per week on 90 days) against the period's daily average. */
function DailyColumns({ meta, daily, days }: BodyProps) {
  const points = periodPoints(daily, days);
  const values = days.map((k) => daily.get(k)).filter((v): v is number => v != null);
  const avg = mean(values);
  const today = daily.get(days[days.length - 1]!);
  const best = days.reduce<string | null>((b, k) => (daily.has(k) && (!b || daily.get(k)! > daily.get(b)!) ? k : b), null);
  const weekly = points.length < days.length;
  const unitDay = meta.id === 'steps' ? 'steps a day' : `${meta.unit} a day`;
  return (
    <>
      <Lead value={int(avg)} unit={unitDay} caption={today != null ? `Today so far: ${int(today)} ${meta.unit}` : `Average over the days with readings`} />
      <Card>
        <ColumnChart points={points} average={avg}
          label={`${meta.title} ${weekly ? 'per week, as a daily average' : 'per day'} over the last ${days.length} days. Average ${int(avg)} a day${best ? `, highest ${int(daily.get(best)!)} on ${longDay(best)}` : ''}.`}
          describe={(x) => (x.value == null ? `${x.long}: no readings` : `${x.long}: ${int(x.value)} ${weekly ? `${meta.unit} a day on average` : meta.unit}`)} />
        <Numbers header={[weekly ? 'Week' : 'Day', weekly ? `${meta.unit} a day` : meta.unit]} rows={pointRows(points, int)} />
      </Card>
      <Facts items={[
        best ? { label: 'Best day', value: `${int(daily.get(best)!)}`, caption: longDay(best) } : null,
        { label: 'Days with readings', value: `${values.length} of ${days.length}` }
      ]} />
    </>
  );
}

/** Active calories: a calendar of the period, each day shaded by how much energy it burned. */
function CalendarBody({ meta, daily, days }: BodyProps) {
  const values = days.map((k) => daily.get(k)).filter((v): v is number => v != null);
  const total = values.reduce((a, b) => a + b, 0);
  const top = days.reduce<string | null>((b, k) => (daily.has(k) && (!b || daily.get(k)! > daily.get(b)!) ? k : b), null);
  return (
    <>
      <Lead value={int(total)} unit={`kcal in ${days.length} days`} caption={`About ${int(mean(values))} kcal on a day with readings`} />
      <Card>
        <CalendarHeat days={days} daily={daily}
          label={`Active calories per day over the last ${days.length} days, as a calendar. Total ${int(total)} kcal${top ? `; most on ${longDay(top)}, ${int(daily.get(top)!)} kcal` : ''}.`}
          describe={(k, v) => (v == null ? `${longDay(k)}: no readings` : `${longDay(k)}: ${int(v)} kcal`)} />
        <Numbers header={['Day', meta.unit]} rows={[...days].reverse().filter((k) => daily.has(k)).map((k) => [longDay(k), int(daily.get(k)!)])} />
      </Card>
      <Facts items={[
        top ? { label: 'Most active day', value: `${int(daily.get(top)!)} kcal`, caption: longDay(top) } : null,
        { label: 'Days with readings', value: `${values.length} of ${days.length}` }
      ]} />
    </>
  );
}

const STAGE_NAMES: Record<Stage, string> = { deep: 'Deep', light: 'Light', rem: 'REM', awake: 'Awake' };

/** Sleep: time asleep night by night, the typical bedtime and wake-up, and how an average night splits into stages. */
function SleepBody({ d, daily, days }: BodyProps) {
  const sum = sleepSummary(d.nights, new Set(days), deviceOffsetMin());
  const points = periodPoints(daily, days);
  const weekly = points.length < days.length;
  const avgH = sum.avgAsleepMs != null ? sum.avgAsleepMs / 3_600_000 : mean(days.map((k) => daily.get(k)).filter((v): v is number => v != null));
  return (
    <>
      <Lead value={fmtHoursMinutes(avgH * 60)} unit="asleep a night"
        caption={sum.bedtime != null && sum.wake != null ? `A typical night runs from ${fmtClock(sum.bedtime)} to ${fmtClock(sum.wake)}` : null} />
      <Card>
        <ColumnChart points={points} average={avgH}
          label={`Time asleep ${weekly ? 'per week, as a nightly average' : 'per night'} over the last ${days.length} days. Average ${fmtHoursMinutes(avgH * 60)}.`}
          describe={(x) => (x.value == null ? `${x.long}: no sleep recorded` : `${weekly ? `${x.long}: ${fmtHoursMinutes(x.value * 60)} a night on average` : `Night to ${x.long}: ${fmtHoursMinutes(x.value * 60)} asleep`}`)} />
        <Numbers header={[weekly ? 'Week' : 'Night to', 'Asleep']} rows={pointRows(points, (v) => fmtHoursMinutes(v * 60))} />
      </Card>
      {sum.stages ? (
        <Card accessibilityLabel="Sleep stages on an average night">
          <Txt variant="heading">An average night</Txt>
          <StageBar minutes={sum.stages} names={STAGE_NAMES} fmt={(m) => fmtHoursMinutes(m)} />
          <Txt variant="caption">{`From the ${sum.stageNights} ${sum.stageNights === 1 ? 'night' : 'nights'} your device split into stages.`}</Txt>
        </Card>
      ) : null}
      <Facts items={[
        { label: 'Nights recorded', value: `${sum.nights} of ${days.length}` },
        sum.wake != null ? { label: 'Usual wake-up', value: fmtClock(sum.wake) } : null
      ]} />
    </>
  );
}

/** Heart rate: each day's lowest to highest reading, the average marked. */
function HeartRateBody({ d, days }: BodyProps) {
  const off = deviceOffsetMin();
  const inPeriod = new Set(days);
  const ranges = dailyRanges(d.heartRate.filter((q) => inPeriod.has(localDayKey(q.start, q.tzOffsetMin ?? off))), off);
  const points = weeklyRanges(ranges, days);
  const all = [...ranges.values()];
  const low = all.reduce<(typeof all)[number] | null>((b, r) => (!b || r.min < b.min ? r : b), null);
  const high = all.reduce<(typeof all)[number] | null>((b, r) => (!b || r.max > b.max ? r : b), null);
  const n = all.reduce((a, r) => a + r.n, 0);
  const avg = n ? all.reduce((a, r) => a + r.avg * r.n, 0) / n : NaN;
  const weekly = points.length < days.length;
  return (
    <>
      <Lead value={int(avg)} unit="bpm on average" caption={low && high ? `From ${int(low.min)} to ${int(high.max)} bpm over the last ${days.length} days` : null} />
      <Card>
        <RangeChart points={points}
          label={`Heart rate ${weekly ? 'per week' : 'per day'}, lowest to highest with the average, over the last ${days.length} days. Average ${int(avg)} bpm.`}
          describe={(x) => (x.range ? `${x.long}: ${int(x.range.min)} to ${int(x.range.max)} bpm, average ${int(x.range.avg)}` : `${x.long}: no readings`)} />
        <Numbers header={[weekly ? 'Week' : 'Day', 'Lowest · average · highest (bpm)']}
          rows={[...points].reverse().filter((x) => x.range).map((x) => [x.long, `${int(x.range!.min)} · ${int(x.range!.avg)} · ${int(x.range!.max)}`])} />
      </Card>
      <Facts items={[
        low ? { label: 'Lowest reading', value: `${int(low.min)} bpm`, caption: dayTime(low.minAt) } : null,
        high ? { label: 'Highest reading', value: `${int(high.max)} bpm`, caption: dayTime(high.maxAt) } : null
      ]} />
    </>
  );
}

/** Resting heart rate, HRV and cadence: the trend, with the middle half of your readings shaded as your usual range. */
function TrendBody({ type, meta, daily, days }: BodyProps) {
  const pts = days.filter((k) => daily.has(k));
  const values = pts.map((k) => daily.get(k)!);
  const last = pts[pts.length - 1]!;
  const band: [number, number] | null = values.length >= 5 ? [quantile(values, 0.25), quantile(values, 0.75)] : null;
  const unit = meta.unit;
  const hrv = type === 'hrv_sdnn' || type === 'hrv_rmssd';
  const lowest = pts.reduce((b, k) => (daily.get(k)! < daily.get(b)! ? k : b), pts[0]!);
  return (
    <>
      <Lead value={int(daily.get(last)!)} unit={unit}
        caption={band ? `Latest, on ${longDay(last)}. Your usual range is ${int(band[0])}–${int(band[1])} ${unit}.` : `Latest, on ${longDay(last)}`} />
      <Card>
        <TrendLine days={days} daily={daily} band={band} smooth={type === 'resting_hr' && values.length >= 7 ? 7 : undefined}
          label={`${meta.title} over the last ${days.length} days: latest ${int(daily.get(last)!)} ${unit}${band ? `, usual range ${int(band[0])} to ${int(band[1])}` : ''}.`}
          describe={(k, v) => `${longDay(k)}: ${int(v)} ${unit}`} />
        <Numbers header={['Day', unit]} rows={[...pts].reverse().map((k) => [longDay(k), int(daily.get(k)!)])} />
      </Card>
      <Facts items={[
        { label: 'Average', value: `${int(mean(values))} ${unit}` },
        type === 'resting_hr' ? { label: 'Lowest', value: `${int(daily.get(lowest)!)} ${unit}`, caption: longDay(lowest) } : { label: 'Readings', value: `${values.length}` }
      ]} />
      {band ? <Txt variant="caption">{`Your usual range is the middle half of your readings in this period${hrv ? '. HRV varies a lot from day to day, so the range says more than any single reading' : ''}.`}</Txt> : null}
    </>
  );
}

/** VO₂ max: each estimate your device made, and how the latest compares with the first in the period. */
function EstimateBody({ meta, daily, days }: BodyProps) {
  const pts = days.filter((k) => daily.has(k));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const change = daily.get(last)! - daily.get(first)!;
  return (
    <>
      <Lead value={dec(daily.get(last)!, 1)} unit={meta.unit}
        caption={pts.length > 1 ? `Latest estimate, on ${longDay(last)}: ${change === 0 ? 'the same as' : `${dec(Math.abs(change), 1)} ${change > 0 ? 'higher than' : 'lower than'}`} on ${longDay(first)}` : `Estimated on ${longDay(last)}`} />
      <Card>
        <TrendLine days={days} daily={daily} digits={1} joinDays={Infinity}
          label={`${meta.title} estimates over the last ${days.length} days: latest ${dec(daily.get(last)!, 1)}.`}
          describe={(k, v) => `${longDay(k)}: ${dec(v, 1)} ${meta.unit}`} />
        <Numbers header={['Day', meta.unit]} rows={[...pts].reverse().map((k) => [longDay(k), dec(daily.get(k)!, 1)])} />
      </Card>
      <Facts items={[{ label: 'Estimates', value: `${pts.length}` }, { label: 'Highest', value: dec(Math.max(...pts.map((k) => daily.get(k)!)), 1) }]} />
    </>
  );
}

