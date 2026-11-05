import { localDayKey, type DailyTotal, type MethodSeries, type QuantitySample, type SleepNight } from '@loopfield/core';
import type { HealthCardId } from '@/health/cache';
import type { useHealthDerived } from '@/health/useHealth';
import { deviceOffsetMin } from '@/health/useHealth';

export type MetricId = 'steps' | 'calories' | 'sleep' | 'resting_hr' | 'hrv_sdnn' | 'hrv_rmssd' | 'vo2_max' | 'heart_rate' | 'cadence' | 'elevation';

export interface MetricMeta {
  id: MetricId;
  card: HealthCardId;
  title: string;
  unit: string;
  mode: 'total' | 'average';
  digits: number;
  note: string;
}

export const METRICS: Record<MetricId, MetricMeta> = {
  steps: { id: 'steps', card: 'steps', title: 'Steps', unit: 'steps', mode: 'total', digits: 0, note: 'Daily totals. Where phone and watch both counted steps, each hour uses one source so steps are not double-counted.' },
  calories: { id: 'calories', card: 'calories', title: 'Active calories', unit: 'kcal', mode: 'total', digits: 0, note: 'Active energy as estimated by your devices. Estimates vary between devices.' },
  sleep: { id: 'sleep', card: 'sleep', title: 'Sleep', unit: 'h asleep', mode: 'average', digits: 1, note: 'Time asleep per night from one source per night. Time in bed is shown separately when available.' },
  resting_hr: { id: 'resting_hr', card: 'resting_hr', title: 'Resting heart rate', unit: 'bpm', mode: 'average', digits: 0, note: 'As reported by your device. Daily values are averages of that day’s readings.' },
  hrv_sdnn: { id: 'hrv_sdnn', card: 'hrv', title: 'HRV (SDNN)', unit: 'ms', mode: 'average', digits: 0, note: 'SDNN method (Apple Health). Not comparable with RMSSD values, so the two are never combined.' },
  hrv_rmssd: { id: 'hrv_rmssd', card: 'hrv', title: 'HRV (RMSSD)', unit: 'ms', mode: 'average', digits: 0, note: 'RMSSD method (Health Connect). Not comparable with SDNN values, so the two are never combined.' },
  vo2_max: { id: 'vo2_max', card: 'vo2_max', title: 'VO₂ max (estimate)', unit: 'mL/kg/min', mode: 'average', digits: 1, note: 'A device estimate. Different devices estimate differently.' },
  heart_rate: { id: 'heart_rate', card: 'heart_rate', title: 'Heart rate', unit: 'bpm', mode: 'average', digits: 0, note: 'Daily average of recorded readings. Periods without readings are not counted.' },
  cadence: { id: 'cadence', card: 'cadence', title: 'Cadence', unit: 'steps/min', mode: 'average', digits: 0, note: 'Daily average of recorded cadence readings.' },
  elevation: { id: 'elevation', card: 'elevation', title: 'Elevation gained', unit: 'm', mode: 'total', digits: 0, note: 'On iPhone this is estimated from flights climbed (about 3 m per flight).' }
};

const fromTotals = (t: DailyTotal[]) => new Map(t.map((d) => [d.day, d.value]));

function dailyAverage(samples: readonly QuantitySample[]): Map<string, number> {
  const sums = new Map<string, { s: number; n: number }>();
  const off = deviceOffsetMin();
  for (const q of samples) {
    const k = localDayKey(q.start, q.tzOffsetMin ?? off);
    const e = sums.get(k) ?? { s: 0, n: 0 };
    e.s += q.value;
    e.n++;
    sums.set(k, e);
  }
  return new Map([...sums].map(([k, v]) => [k, v.s / v.n]));
}

function seriesDaily(series: MethodSeries[], method: string): Map<string, number> {
  const pts = series.filter((s) => s.method === method).flatMap((s) => s.points);
  const off = deviceOffsetMin();
  const sums = new Map<string, { s: number; n: number }>();
  for (const p of pts) {
    const k = localDayKey(p.t, off);
    const e = sums.get(k) ?? { s: 0, n: 0 };
    e.s += p.value;
    e.n++;
    sums.set(k, e);
  }
  return new Map([...sums].map(([k, v]) => [k, v.s / v.n]));
}

const sleepDaily = (n: SleepNight[]) => new Map(n.map((x) => [x.night, x.asleepMs / 3_600_000]));

/** Daily values for one metric; days without readings are absent (missing is not zero). */
export function dailyValues(id: MetricId, d: ReturnType<typeof useHealthDerived>): Map<string, number> {
  switch (id) {
    case 'steps':
      return fromTotals(d.steps);
    case 'calories':
      return fromTotals(d.energy);
    case 'sleep':
      return sleepDaily(d.nights);
    case 'resting_hr':
      return seriesDaily(d.resting, d.resting[0]?.method ?? 'unspecified');
    case 'hrv_sdnn':
      return seriesDaily(d.hrv, 'sdnn');
    case 'hrv_rmssd':
      return seriesDaily(d.hrv, 'rmssd');
    case 'vo2_max':
      return dailyAverage(d.vo2Series.flatMap((s) => s.points.map((p) => ({ id: '', type: 'vo2_max' as const, value: p.value, start: p.t, end: p.t, sourceId: s.sourceId, sourceKind: 'unknown' as const }))));
    case 'heart_rate':
      return dailyAverage(d.heartRate);
    case 'cadence':
      return dailyAverage(d.cadence);
    case 'elevation':
      return fromTotals(d.elevation);
  }
}

export function sourcesFor(id: MetricId, d: ReturnType<typeof useHealthDerived>): string[] {
  const set = new Set<string>();
  switch (id) {
    case 'steps':
      d.steps.forEach((x) => x.sourceIds.forEach((s) => set.add(s)));
      break;
    case 'calories':
      d.energy.forEach((x) => x.sourceIds.forEach((s) => set.add(s)));
      break;
    case 'sleep':
      d.nights.forEach((n) => set.add(n.sourceId));
      break;
    case 'resting_hr':
      d.resting.forEach((s) => set.add(s.sourceId));
      break;
    case 'hrv_sdnn':
    case 'hrv_rmssd':
      d.hrv.filter((s) => s.method === (id === 'hrv_sdnn' ? 'sdnn' : 'rmssd')).forEach((s) => set.add(s.sourceId));
      break;
    case 'vo2_max':
      d.vo2Series.forEach((s) => set.add(s.sourceId));
      break;
    case 'heart_rate':
      d.heartRate.forEach((s) => set.add(s.sourceId));
      break;
    case 'cadence':
      d.cadence.forEach((s) => set.add(s.sourceId));
      break;
    case 'elevation':
      d.elevation.forEach((x) => x.sourceIds.forEach((s) => set.add(s)));
      break;
  }
  return [...set];
}

export function lastNDays(n: number): string[] {
  const off = deviceOffsetMin();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(localDayKey(Date.now() - i * 86_400_000, off));
  return out;
}
