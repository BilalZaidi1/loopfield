import { localDayKey, type QuantitySample, type SleepNight } from '@loopfield/core';
import { fmtDay } from '@/lib/format';

/**
 * Shaping health data for the metric screens: daily values over a period (grouped into weeks for long
 * periods so a chart never has 90 slivers), per-day heart-rate ranges, the middle half of a set of
 * readings, and a summary of the nights in a period. Days without readings stay missing, never zero.
 */

export interface PeriodPoint {
  /** First day (YYYY-MM-DD) of the day or week this point covers. */
  key: string;
  /** Short axis label. */
  label: string;
  /** Full name for the readout and the numbers table. */
  long: string;
  value: number | null;
  /** Days in it with a reading. */
  covered: number;
  /** Days it spans (1, or up to 7 for a week). */
  span: number;
}

/** Periods longer than this are drawn as weeks. */
export const WEEKLY_AFTER_DAYS = 31;

/**
 * One point per day, or per week (the average of the days with readings, so a week with a missing day is
 * not shortchanged) when the period is long. Weeks are counted back from the last day.
 */
export function periodPoints(daily: ReadonlyMap<string, number>, days: readonly string[], weekly = days.length > WEEKLY_AFTER_DAYS): PeriodPoint[] {
  if (!weekly) {
    return days.map((k) => {
      const v = daily.get(k);
      return { key: k, label: fmtDay(k, { day: 'numeric' }), long: fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }), value: v ?? null, covered: v == null ? 0 : 1, span: 1 };
    });
  }
  const out: PeriodPoint[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end);
    const vals = chunk.map((k) => daily.get(k)).filter((v): v is number => v != null);
    const first = chunk[0]!;
    out.unshift({
      key: first,
      label: fmtDay(first, { day: 'numeric', month: 'short' }),
      long: `Week of ${fmtDay(first, { day: 'numeric', month: 'short' })}`,
      value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      covered: vals.length,
      span: chunk.length
    });
  }
  return out;
}

export interface DayRange {
  min: number;
  max: number;
  avg: number;
  n: number;
  minAt: number;
  maxAt: number;
}

/** Lowest, highest and average reading of each day (heart rate), by the day each reading was taken. */
export function dailyRanges(samples: readonly QuantitySample[], offsetMin: number): Map<string, DayRange> {
  const out = new Map<string, DayRange>();
  const sums = new Map<string, number>();
  for (const q of samples) {
    const k = localDayKey(q.start, q.tzOffsetMin ?? offsetMin);
    const r = out.get(k);
    if (!r) {
      out.set(k, { min: q.value, max: q.value, avg: q.value, n: 1, minAt: q.start, maxAt: q.start });
      sums.set(k, q.value);
      continue;
    }
    const sum = sums.get(k)! + q.value;
    sums.set(k, sum);
    r.n++;
    r.avg = sum / r.n;
    if (q.value < r.min) {
      r.min = q.value;
      r.minAt = q.start;
    }
    if (q.value > r.max) {
      r.max = q.value;
      r.maxAt = q.start;
    }
  }
  return out;
}

/** Weekly ranges for long periods: the lowest and highest of the week, and the average of its days. */
export function weeklyRanges(ranges: ReadonlyMap<string, DayRange>, days: readonly string[]): { key: string; label: string; long: string; range: DayRange | null }[] {
  const weekly = days.length > WEEKLY_AFTER_DAYS;
  if (!weekly) return days.map((k) => ({ key: k, label: fmtDay(k, { day: 'numeric' }), long: fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }), range: ranges.get(k) ?? null }));
  const out: { key: string; label: string; long: string; range: DayRange | null }[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end);
    const rs = chunk.map((k) => ranges.get(k)).filter((r): r is DayRange => Boolean(r));
    const first = chunk[0]!;
    let range: DayRange | null = null;
    for (const r of rs) {
      if (!range) range = { ...r, avg: r.avg * r.n };
      else {
        if (r.min < range.min) Object.assign(range, { min: r.min, minAt: r.minAt });
        if (r.max > range.max) Object.assign(range, { max: r.max, maxAt: r.maxAt });
        range.avg += r.avg * r.n;
        range.n += r.n;
      }
    }
    if (range) range.avg /= range.n;
    out.unshift({ key: first, label: fmtDay(first, { day: 'numeric', month: 'short' }), long: `Week of ${fmtDay(first, { day: 'numeric', month: 'short' })}`, range });
  }
  return out;
}

/** The q-th quantile (0–1) of a list of numbers, interpolated; NaN for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

export type Stage = 'deep' | 'light' | 'rem' | 'awake';
export const STAGES: Stage[] = ['deep', 'light', 'rem', 'awake'];

export interface SleepSummary {
  nights: number;
  avgAsleepMs: number | null;
  /** Average minutes in each stage, over the nights that reported stages; null when none did. */
  stages: Record<Stage, number> | null;
  stageNights: number;
  /** Typical bedtime and wake-up (median), in minutes after midnight. */
  bedtime: number | null;
  wake: number | null;
}

/** Minutes after midnight of a moment, in the zone of `offsetMin`. */
const clock = (t: number, offsetMin: number) => {
  const d = new Date(t + offsetMin * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/**
 * The nights that ended on the given days: average time asleep, the average split between stages, and the
 * typical bedtime and wake-up. Bedtimes are compared around noon so 23:30 and 00:30 count as an hour apart.
 */
export function sleepSummary(nights: readonly SleepNight[], days: ReadonlySet<string>, offsetMin: number): SleepSummary {
  const inPeriod = nights.filter((n) => days.has(n.night));
  if (!inPeriod.length) return { nights: 0, avgAsleepMs: null, stages: null, stageNights: 0, bedtime: null, wake: null };
  const withStages = inPeriod.filter((n) => n.stagesMs && Object.values(n.stagesMs).some((v) => (v ?? 0) > 0));
  const stages = withStages.length
    ? (Object.fromEntries(STAGES.map((s) => [s, mean(withStages.map((n) => (n.stagesMs?.[s] ?? 0) / 60_000))])) as Record<Stage, number>)
    : null;
  // Bedtimes before noon belong to the night after midnight: shift them a day so the median is right.
  const beds = inPeriod.map((n) => {
    const m = clock(n.start, offsetMin);
    return m < 12 * 60 ? m + 24 * 60 : m;
  });
  const bed = quantile(beds, 0.5);
  return {
    nights: inPeriod.length,
    avgAsleepMs: mean(inPeriod.map((n) => n.asleepMs)),
    stages,
    stageNights: withStages.length,
    bedtime: Math.round(bed) % (24 * 60),
    wake: Math.round(quantile(inPeriod.map((n) => clock(n.end, offsetMin)), 0.5))
  };
}

/** "23:40" for minutes after midnight. */
export function fmtClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "7 h 12 min" for a duration in minutes. */
export function fmtHoursMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
