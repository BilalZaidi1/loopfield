import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  canonicalSessions,
  dailyCumulative,
  emptyStore,
  latestBySource,
  seriesByMethod,
  sleepNights
} from '../src/health/reconcile.ts';
import { comparePeriods, heartRateSummary, timeInZones, zonesFromMaxHr } from '../src/health/metrics.ts';
import { toCanonical } from '../src/health/units.ts';
import type { QuantitySample, SleepSegment, WorkoutRecord } from '../src/health/types.ts';

const H = 3_600_000;
const day0 = Date.UTC(2026, 9, 1, 0, 0, 0); // 1 Oct 2026 00:00Z
const PKT = 300; // UTC+5 minutes

const q = (over: Partial<QuantitySample> & Pick<QuantitySample, 'id' | 'type' | 'value' | 'start'>): QuantitySample => ({
  end: over.start,
  sourceId: 'watch',
  sourceKind: 'watch',
  ...over
});

describe('workout reconciliation (FR50, Appendix A)', () => {
  const run = { activityId: 'act-1', start: day0 + 6 * H, end: day0 + 7 * H, distanceM: 10_000 };
  const watch: WorkoutRecord = { id: 'w1', activity: 'running', start: day0 + 6 * H + 60_000, end: day0 + 7 * H, sourceId: 'com.apple.workout', sourceKind: 'watch', distanceM: 10_100, activeEnergyKcal: 640 };
  const phone: WorkoutRecord = { id: 'p1', activity: 'running', start: day0 + 6 * H, end: day0 + 7 * H - 120_000, sourceId: 'com.apple.health', sourceKind: 'phone', distanceM: 9_800 };

  it('folds phone and watch copies of one run into a single canonical session', () => {
    const sessions = canonicalSessions([watch, phone], []);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.primarySourceId).toBe('com.apple.workout');
    expect(sessions[0]!.recordIds.sort()).toEqual(['p1', 'w1']);
    expect(sessions[0]!.imported).toBe(true);
  });

  it('links this app’s own exported workout to the first-party run instead of re-importing it', () => {
    const exported: WorkoutRecord = { id: 'e1', activity: 'running', start: run.start, end: run.end, sourceId: 'app.loopfield', sourceKind: 'self', externalId: 'act-1' };
    const sessions = canonicalSessions([exported, watch], [run]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.firstPartyActivityId).toBe('act-1');
    expect(sessions[0]!.imported).toBe(false);
    expect(sessions[0]!.distanceM).toBe(10_000);
  });

  it('keeps a separate non-overlapping imported workout as personal history only', () => {
    const other: WorkoutRecord = { ...watch, id: 'w2', start: day0 + 18 * H, end: day0 + 19 * H };
    const sessions = canonicalSessions([other], [run]);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.id === 'hs:w2')!.imported).toBe(true);
  });

  it('rebuilds after source updates and deletions', () => {
    const store = emptyStore();
    applyChanges(store, [
      { kind: 'upsert', table: 'workout', record: { ...watch, version: 1 } },
      { kind: 'upsert', table: 'workout', record: phone }
    ]);
    expect(canonicalSessions([...store.workout.values()], [])).toHaveLength(1);
    const stale = applyChanges(store, [{ kind: 'upsert', table: 'workout', record: { ...watch, version: 0, distanceM: 1 } }]);
    expect(stale.ignored).toBe(1);
    applyChanges(store, [{ kind: 'delete', table: 'workout', id: 'w1' }]);
    const sessions = canonicalSessions([...store.workout.values()], []);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.primarySourceId).toBe('com.apple.health');
  });
});

describe('cumulative metrics without double counting', () => {
  it('never sums phone and watch steps for the same hour', () => {
    const samples: QuantitySample[] = [
      q({ id: 'a', type: 'steps', value: 1000, start: day0 + 8 * H, end: day0 + 8 * H + 30 * 60_000, sourceId: 'watch', sourceKind: 'watch' }),
      q({ id: 'b', type: 'steps', value: 950, start: day0 + 8 * H, end: day0 + 8 * H + 30 * 60_000, sourceId: 'phone', sourceKind: 'phone' }),
      q({ id: 'c', type: 'steps', value: 400, start: day0 + 10 * H, end: day0 + 10 * H + 10 * 60_000, sourceId: 'phone', sourceKind: 'phone' })
    ];
    const days = dailyCumulative(samples, 0);
    expect(days).toHaveLength(1);
    expect(days[0]!.value).toBe(1400);
    expect(days[0]!.coveredHours).toBe(2);
  });

  it('assigns readings to the local day in their own recorded time zone', () => {
    // 19:30Z on 1 Oct is 00:30 on 2 Oct in UTC+5.
    const s = q({ id: 'x', type: 'steps', value: 100, start: day0 + 19.5 * H, end: day0 + 19.5 * H + 60_000, tzOffsetMin: PKT });
    expect(dailyCumulative([s], 0)[0]!.day).toBe('2026-10-02');
    const noTz = q({ id: 'y', type: 'steps', value: 100, start: day0 + 19.5 * H, end: day0 + 19.5 * H + 60_000 });
    expect(dailyCumulative([noTz], 0)[0]!.day).toBe('2026-10-01');
  });
});

describe('sleep reconciliation', () => {
  it('uses one source per night and separates time in bed from time asleep', () => {
    const segs: SleepSegment[] = [
      { id: 's1', start: day0 - 2 * H, end: day0 + 6 * H, stage: 'in_bed', sourceId: 'phone', sourceKind: 'phone' },
      { id: 's2', start: day0 - 1 * H, end: day0 + 2 * H, stage: 'light', sourceId: 'watch', sourceKind: 'watch' },
      { id: 's3', start: day0 + 2 * H, end: day0 + 3 * H, stage: 'deep', sourceId: 'watch', sourceKind: 'watch' },
      { id: 's4', start: day0 + 3 * H, end: day0 + 5 * H, stage: 'rem', sourceId: 'watch', sourceKind: 'watch' },
      { id: 's5', start: day0, end: day0 + 4 * H, stage: 'asleep', sourceId: 'phone', sourceKind: 'phone' }
    ];
    const nights = sleepNights(segs, 0);
    expect(nights).toHaveLength(1);
    expect(nights[0]!.sourceId).toBe('watch');
    expect(nights[0]!.asleepMs).toBe(6 * H);
    expect(nights[0]!.stagesMs!.deep).toBe(H);
    expect(nights[0]!.inBedMs).toBeNull(); // the watch did not record in-bed; the phone's is not mixed in
  });
});

describe('method-specific series (FR48)', () => {
  it('keeps SDNN and RMSSD as separate series', () => {
    const hrv: QuantitySample[] = [
      q({ id: 'h1', type: 'hrv', value: 48, start: day0, method: 'sdnn', sourceId: 'apple' }),
      q({ id: 'h2', type: 'hrv', value: 35, start: day0 + H, method: 'rmssd', sourceId: 'hc' })
    ];
    const series = seriesByMethod(hrv, 'hrv');
    expect(series.map((s) => s.method).sort()).toEqual(['rmssd', 'sdnn']);
    expect(series.every((s) => s.points.length === 1)).toBe(true);
  });

  it('returns the latest VO2 max estimate per source with its method', () => {
    const v: QuantitySample[] = [
      q({ id: 'v1', type: 'vo2_max', value: 44.1, start: day0, method: 'cooper', sourceId: 'a' }),
      q({ id: 'v2', type: 'vo2_max', value: 45.0, start: day0 + 24 * H, method: 'cooper', sourceId: 'a' })
    ];
    const latest = latestBySource(v, 'vo2_max');
    expect(latest).toHaveLength(1);
    expect(latest[0]!.value).toBe(45.0);
  });
});

describe('heart rate and zones (FR49)', () => {
  const start = day0 + 6 * H;
  const hr = (sec: number, value: number): QuantitySample => q({ id: `hr${sec}`, type: 'heart_rate', value, start: start + sec * 1000 });
  const samples = [hr(0, 100), hr(5, 130), hr(10, 150), hr(15, 170), /* gap */ hr(100, 160), hr(105, 165)];

  it('reports coverage and preserves gaps', () => {
    const s = heartRateSummary(samples, start, start + 120_000);
    expect(s.max).toBe(170);
    expect(s.coverage).toBeLessThan(0.25);
  });

  it('counts time in zone only over covered intervals and versions the zone basis', () => {
    const config = zonesFromMaxHr(190, 3);
    const z = timeInZones(samples, start, start + 120_000, config);
    expect(z.zoneVersion).toBe(3);
    const covered = z.msInZone.reduce((a, b) => a + b, 0);
    expect(covered).toBe(20_000);
    expect(z.uncoveredMs).toBe(100_000);
  });
});

describe('period comparison', () => {
  const now = Date.UTC(2026, 9, 30, 12);
  it('treats missing days as missing and refuses comparisons with poor coverage', () => {
    const daily = new Map<string, number>();
    for (let i = 1; i <= 7; i++) daily.set(new Date(now - i * 86_400_000).toISOString().slice(0, 10), 5000);
    const c = comparePeriods(daily, 7, now, 0);
    expect(c.current.daysWithData).toBe(7);
    expect(c.comparable).toBe(false);
    expect(c.reason).toBe('insufficient_coverage');
    for (let i = 8; i <= 14; i++) daily.set(new Date(now - i * 86_400_000).toISOString().slice(0, 10), 4000);
    const c2 = comparePeriods(daily, 7, now, 0);
    expect(c2.comparable).toBe(true);
    expect(c2.changePct).toBe(25);
  });
});

describe('units', () => {
  it('normalises energy and distance units and rejects unknown units', () => {
    expect(toCanonical('active_energy', 4184, 'kJ')).toBeCloseTo(1000);
    expect(toCanonical('distance', 1, 'mi')).toBeCloseTo(1609.344);
    expect(() => toCanonical('heart_rate', 1, 'furlongs')).toThrow();
  });
});
