import type {
  FirstPartyRun,
  HealthChange,
  QuantitySample,
  SleepSegment,
  SourceKind,
  WorkoutActivity,
  WorkoutRecord
} from './types.ts';

/** Default source priority: this app's own exported records, then watch, phone, other apps. */
export const DEFAULT_SOURCE_PRIORITY: Record<SourceKind, number> = { self: 5, watch: 4, phone: 3, other_app: 2, unknown: 1 };

export interface HealthStore {
  quantity: Map<string, QuantitySample>;
  workout: Map<string, WorkoutRecord>;
  sleep: Map<string, SleepSegment>;
}

export function emptyStore(): HealthStore {
  return { quantity: new Map(), workout: new Map(), sleep: new Map() };
}

/**
 * Apply source-store changes (Health Connect change tokens / HealthKit anchored queries).
 * Updates replace older versions; deletions remove the record so dependent summaries rebuild (FR50).
 */
export function applyChanges(store: HealthStore, changes: readonly HealthChange[]): { upserted: number; deleted: number; ignored: number } {
  let upserted = 0;
  let deleted = 0;
  let ignored = 0;
  for (const change of changes) {
    const table = store[change.table] as Map<string, { version?: number | null }>;
    if (change.kind === 'delete') {
      if (table.delete(change.id)) deleted++;
      else ignored++;
      continue;
    }
    const existing = table.get(change.record.id);
    const incomingVersion = (change.record as { version?: number | null }).version ?? 0;
    if (existing && (existing.version ?? 0) > incomingVersion) {
      ignored++;
      continue;
    }
    table.set(change.record.id, change.record as never);
    upserted++;
  }
  return { upserted, deleted, ignored };
}

export interface CanonicalSession {
  id: string;
  activity: WorkoutActivity;
  start: number;
  end: number;
  /** First-party activity id when this session is (or duplicates) a run recorded in this app. */
  firstPartyActivityId: string | null;
  primarySourceId: string;
  /** Every source record folded into this session, for provenance display. */
  recordIds: string[];
  sourceIds: string[];
  distanceM: number | null;
  activeEnergyKcal: number | null;
  /** Imported sessions are personal analytics only and can never enter a contest (FR52). */
  imported: boolean;
}

function overlapMs(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Two records describe one physical session when they overlap by at least half of the shorter one. */
export function sameSession(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  if (shorter <= 0) return false;
  return overlapMs(a, b) >= shorter * 0.5;
}

/**
 * Resolve phone/watch/app duplicates and this app's own exports into one canonical session per
 * physical workout (FR50, Appendix A "Phone and watch duplicate", "Export reimport").
 */
export function canonicalSessions(
  workouts: readonly WorkoutRecord[],
  firstParty: readonly FirstPartyRun[],
  priority: Record<SourceKind, number> = DEFAULT_SOURCE_PRIORITY
): CanonicalSession[] {
  const sessions: CanonicalSession[] = firstParty.map((r) => ({
    id: `fp:${r.activityId}`,
    activity: 'running',
    start: r.start,
    end: r.end,
    firstPartyActivityId: r.activityId,
    primarySourceId: 'self',
    recordIds: [],
    sourceIds: ['self'],
    distanceM: r.distanceM,
    activeEnergyKcal: null,
    imported: false
  }));
  const byActivityId = new Map(sessions.map((s) => [s.firstPartyActivityId!, s]));
  const primaryRank = new Map<string, number>(sessions.map((s) => [s.id, priority.self + 1]));

  const sorted = [...workouts].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  for (const w of sorted) {
    const linked = w.externalId ? byActivityId.get(w.externalId) : undefined;
    const target = linked ?? sessions.find((s) => s.activity === w.activity && sameSession(s, w));
    const rank = priority[w.sourceKind] ?? 0;
    if (target) {
      target.recordIds.push(w.id);
      if (!target.sourceIds.includes(w.sourceId)) target.sourceIds.push(w.sourceId);
      if (target.activeEnergyKcal == null && w.activeEnergyKcal != null) target.activeEnergyKcal = w.activeEnergyKcal;
      if (rank > (primaryRank.get(target.id) ?? 0)) {
        primaryRank.set(target.id, rank);
        target.primarySourceId = w.sourceId;
        if (w.distanceM != null && target.firstPartyActivityId == null) target.distanceM = w.distanceM;
        if (w.activeEnergyKcal != null) target.activeEnergyKcal = w.activeEnergyKcal;
      }
      continue;
    }
    const session: CanonicalSession = {
      id: `hs:${w.id}`,
      activity: w.activity,
      start: w.start,
      end: w.end,
      firstPartyActivityId: null,
      primarySourceId: w.sourceId,
      recordIds: [w.id],
      sourceIds: [w.sourceId],
      distanceM: w.distanceM ?? null,
      activeEnergyKcal: w.activeEnergyKcal ?? null,
      imported: true
    };
    sessions.push(session);
    primaryRank.set(session.id, rank);
  }
  return sessions.sort((a, b) => a.start - b.start);
}

export function localDayKey(t: number, offsetMin: number): string {
  return new Date(t + offsetMin * 60_000).toISOString().slice(0, 10);
}

export interface DailyTotal {
  day: string;
  value: number;
  /** Hours in the day for which at least one source contributed. */
  coveredHours: number;
  sourceIds: string[];
}

/**
 * Daily totals for cumulative metrics (steps, active energy) without double counting overlapping
 * phone and watch records: within each local hour only the highest-priority source contributes.
 * Prefer platform aggregation APIs on device; this function is the documented fallback and the
 * fixture reference.
 */
export function dailyCumulative(
  samples: readonly QuantitySample[],
  defaultOffsetMin: number,
  priority: Record<SourceKind, number> = DEFAULT_SOURCE_PRIORITY
): DailyTotal[] {
  // hourKey -> sourceId -> {value, rank}
  const hours = new Map<string, Map<string, { value: number; rank: number }>>();
  for (const s of samples) {
    const offset = s.tzOffsetMin ?? defaultOffsetMin;
    const duration = Math.max(1, s.end - s.start);
    // Split samples spanning hour boundaries proportionally.
    let cursor = s.start;
    while (cursor < s.end || (s.end === s.start && cursor === s.start)) {
      const local = cursor + offset * 60_000;
      const hourStartLocal = Math.floor(local / 3_600_000) * 3_600_000;
      const nextBoundary = hourStartLocal + 3_600_000 - offset * 60_000;
      const segEnd = s.end === s.start ? s.end : Math.min(s.end, nextBoundary);
      const portion = s.end === s.start ? 1 : (segEnd - cursor) / duration;
      const key = new Date(hourStartLocal).toISOString().slice(0, 13);
      const perSource = hours.get(key) ?? new Map();
      const prev = perSource.get(s.sourceId) ?? { value: 0, rank: priority[s.sourceKind] ?? 0 };
      prev.value += s.value * portion;
      perSource.set(s.sourceId, prev);
      hours.set(key, perSource);
      if (s.end === s.start) break;
      cursor = segEnd;
    }
  }
  const days = new Map<string, DailyTotal>();
  for (const [hourKey, perSource] of hours) {
    let best: { id: string; value: number; rank: number } | null = null;
    for (const [id, v] of perSource) {
      if (!best || v.rank > best.rank || (v.rank === best.rank && v.value > best.value)) best = { id, ...v };
    }
    if (!best) continue;
    const day = hourKey.slice(0, 10);
    const d = days.get(day) ?? { day, value: 0, coveredHours: 0, sourceIds: [] };
    d.value += best.value;
    d.coveredHours += 1;
    if (!d.sourceIds.includes(best.id)) d.sourceIds.push(best.id);
    days.set(day, d);
  }
  return [...days.values()].map((d) => ({ ...d, value: Math.round(d.value * 10) / 10 })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

function unionMs(intervals: Array<{ start: number; end: number }>): number {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const i of sorted) {
    if (i.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else curEnd = Math.max(curEnd, i.end);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

const ASLEEP: ReadonlySet<string> = new Set(['asleep', 'light', 'deep', 'rem']);

export interface SleepNight {
  /** Local date of the morning the night ended. */
  night: string;
  sourceId: string;
  asleepMs: number;
  inBedMs: number | null;
  stagesMs: Partial<Record<'light' | 'deep' | 'rem' | 'awake', number>> | null;
  start: number;
  end: number;
}

/**
 * One sleep summary per night from the highest-priority source that reported sleep; overlapping
 * sources are never added together, and time in bed is kept separate from time asleep.
 */
export function sleepNights(
  segments: readonly SleepSegment[],
  defaultOffsetMin: number,
  priority: Record<SourceKind, number> = DEFAULT_SOURCE_PRIORITY
): SleepNight[] {
  // A night runs from 18:00 to 18:00 local time and is labelled with the morning's date.
  const byNight = new Map<string, SleepSegment[]>();
  for (const s of segments) {
    const offset = s.tzOffsetMin ?? defaultOffsetMin;
    const key = localDayKey(s.end + 6 * 3_600_000, offset);
    const list = byNight.get(key) ?? [];
    list.push(s);
    byNight.set(key, list);
  }
  const out: SleepNight[] = [];
  for (const [night, segs] of byNight) {
    const bySource = new Map<string, SleepSegment[]>();
    for (const s of segs) bySource.set(s.sourceId, [...(bySource.get(s.sourceId) ?? []), s]);
    let chosen: SleepSegment[] | null = null;
    let chosenRank = -1;
    for (const list of bySource.values()) {
      const hasAsleep = list.some((s) => ASLEEP.has(s.stage));
      const rank = (priority[list[0]!.sourceKind] ?? 0) + (hasAsleep ? 10 : 0);
      if (rank > chosenRank) {
        chosen = list;
        chosenRank = rank;
      }
    }
    if (!chosen) continue;
    const asleep = chosen.filter((s) => ASLEEP.has(s.stage));
    const inBed = chosen.filter((s) => s.stage === 'in_bed');
    const staged = chosen.some((s) => s.stage === 'light' || s.stage === 'deep' || s.stage === 'rem');
    out.push({
      night,
      sourceId: chosen[0]!.sourceId,
      asleepMs: unionMs(asleep),
      inBedMs: inBed.length ? unionMs(inBed) : null,
      stagesMs: staged
        ? {
            light: unionMs(chosen.filter((s) => s.stage === 'light')),
            deep: unionMs(chosen.filter((s) => s.stage === 'deep')),
            rem: unionMs(chosen.filter((s) => s.stage === 'rem')),
            awake: unionMs(chosen.filter((s) => s.stage === 'awake'))
          }
        : null,
      start: Math.min(...chosen.map((s) => s.start)),
      end: Math.max(...chosen.map((s) => s.end))
    });
  }
  return out.sort((a, b) => (a.night < b.night ? -1 : 1));
}

export interface SeriesPoint {
  t: number;
  value: number;
}

export interface MethodSeries {
  key: string;
  method: string;
  sourceId: string;
  points: SeriesPoint[];
}

/** HRV (and other method-dependent metrics) as separate labelled series — never averaged together. */
export function seriesByMethod(samples: readonly QuantitySample[], type: QuantitySample['type']): MethodSeries[] {
  const groups = new Map<string, MethodSeries>();
  for (const s of samples) {
    if (s.type !== type) continue;
    const method = s.method ?? 'unspecified';
    const key = `${method}|${s.sourceId}`;
    const g = groups.get(key) ?? { key, method, sourceId: s.sourceId, points: [] };
    g.points.push({ t: s.end, value: s.value });
    groups.set(key, g);
  }
  for (const g of groups.values()) g.points.sort((a, b) => a.t - b.t);
  return [...groups.values()];
}

/** Latest reading per source (VO2 max, resting heart rate) with its method retained. */
export function latestBySource(samples: readonly QuantitySample[], type: QuantitySample['type']): QuantitySample[] {
  const latest = new Map<string, QuantitySample>();
  for (const s of samples) {
    if (s.type !== type) continue;
    const prev = latest.get(s.sourceId);
    if (!prev || s.end > prev.end) latest.set(s.sourceId, s);
  }
  return [...latest.values()].sort((a, b) => b.end - a.end);
}
