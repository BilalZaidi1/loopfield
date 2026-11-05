import { Platform } from 'react-native';
import type { HealthChange, QuantitySample, QuantityType, SleepSegment, SleepStage, SourceKind, WorkoutRecord } from '@loopfield/core';
import { isExpoGo, optionalNativeModule } from '@/lib/runtime';
import { getCursor, setCursor, type HealthCardId } from './cache';

/**
 * Android Health Connect adapter. Initial reads are bounded to the default history window
 * (30 days without the extra history permission, which this release does not request); later syncs
 * use change tokens so updates and deletions are applied (S50, S54, S55).
 * Expo Go has no Health Connect module, so there the adapter reports Health Connect as unavailable.
 */
const HC = Platform.OS === 'android' && !isExpoGo ? optionalNativeModule('react-native-health-connect', () => require('react-native-health-connect')) : null;
const OWN_PACKAGE_HINT = 'loopfield';
const DEFAULT_HISTORY_DAYS = 30;

const RECORDS: Record<string, { recordType: string; type?: QuantityType }> = {
  heart_rate: { recordType: 'HeartRate', type: 'heart_rate' },
  resting_hr: { recordType: 'RestingHeartRate', type: 'resting_heart_rate' },
  hrv: { recordType: 'HeartRateVariabilityRmssd', type: 'hrv' },
  vo2_max: { recordType: 'Vo2Max', type: 'vo2_max' },
  steps: { recordType: 'Steps', type: 'steps' },
  calories: { recordType: 'ActiveCaloriesBurned', type: 'active_energy' },
  elevation: { recordType: 'ElevationGained', type: 'elevation_gain' },
  cadence: { recordType: 'StepsCadence', type: 'cadence' },
  sleep: { recordType: 'SleepSession' },
  workouts: { recordType: 'ExerciseSession' }
};

export async function healthConnectStatus(): Promise<'available' | 'needs_update' | 'unavailable'> {
  if (!HC) return 'unavailable';
  const status = await HC.getSdkStatus().catch(() => 1);
  return status === 3 ? 'available' : status === 2 ? 'needs_update' : 'unavailable';
}

function recordTypesFor(cards: HealthCardId[]): string[] {
  const types = new Set<string>(['ExerciseSession']);
  for (const c of cards) {
    if (c === 'zones') types.add('HeartRate');
    else if (RECORDS[c]) types.add(RECORDS[c]!.recordType);
  }
  return [...types];
}

export async function requestHealthConnect(cards: HealthCardId[], exportWorkouts: boolean): Promise<{ granted: string[] }> {
  if (!HC) return { granted: [] };
  await HC.initialize();
  const perms = recordTypesFor(cards).map((recordType) => ({ accessType: 'read', recordType }));
  if (exportWorkouts) perms.push({ accessType: 'write', recordType: 'ExerciseSession' });
  const granted = (await HC.requestPermission(perms)) as { recordType: string; accessType: string }[];
  return { granted: granted.filter((g) => g.accessType === 'read').map((g) => g.recordType) };
}

export async function grantedReadTypes(): Promise<string[]> {
  if (!HC) return [];
  await HC.initialize();
  const g = (await HC.getGrantedPermissions()) as { recordType: string; accessType: string }[];
  return g.filter((p) => p.accessType === 'read').map((p) => p.recordType);
}

const kind = (origin: string | undefined): SourceKind => (!origin ? 'unknown' : origin.toLowerCase().includes(OWN_PACKAGE_HINT) ? 'self' : origin.includes('wear') || origin.includes('watch') ? 'watch' : 'other_app');
const SLEEP_STAGE: Record<number, SleepStage> = { 0: 'unknown', 1: 'awake', 2: 'asleep', 3: 'in_bed', 4: 'light', 5: 'deep', 6: 'rem', 7: 'awake' };

/** Map one Health Connect record to normalised changes (heart-rate series expand to samples). */
function mapRecord(rt: string, r: Record<string, any>): HealthChange[] {
  const meta = r.metadata ?? {};
  const id = String(meta.id);
  const origin = meta.dataOrigin as string | undefined;
  const version = meta.lastModifiedTime ? Date.parse(meta.lastModifiedTime) : null;
  const q = (type: QuantityType, value: number, start: string, end: string, method: string | null = null, sub = ''): HealthChange => ({
    kind: 'upsert',
    table: 'quantity',
    record: { id: id + sub, type, value, start: Date.parse(start), end: Date.parse(end), sourceId: origin ?? 'unknown', sourceKind: kind(origin), method, version } satisfies QuantitySample
  });
  switch (rt) {
    case 'HeartRate':
      return (r.samples ?? []).map((s: { time: string; beatsPerMinute: number }, i: number) => q('heart_rate', s.beatsPerMinute, s.time, s.time, null, `#${i}`));
    case 'RestingHeartRate':
      return [q('resting_heart_rate', r.beatsPerMinute, r.time, r.time)];
    case 'HeartRateVariabilityRmssd':
      return [q('hrv', r.heartRateVariabilityMillis, r.time, r.time, 'rmssd')];
    case 'Vo2Max':
      return [q('vo2_max', r.vo2MillilitersPerMinuteKilogram, r.time, r.time, String(r.measurementMethod ?? 'unspecified'))];
    case 'Steps':
      return [q('steps', r.count, r.startTime, r.endTime)];
    case 'ActiveCaloriesBurned':
      return [q('active_energy', r.energy?.inKilocalories ?? 0, r.startTime, r.endTime)];
    case 'ElevationGained':
      return [q('elevation_gain', r.elevation?.inMeters ?? 0, r.startTime, r.endTime)];
    case 'StepsCadence':
      return (r.samples ?? []).map((s: { time: string; rate: number }, i: number) => q('cadence', s.rate, s.time, s.time, null, `#${i}`));
    case 'SleepSession':
      return (r.stages ?? [{ startTime: r.startTime, endTime: r.endTime, stage: 2 }]).map((s: { startTime: string; endTime: string; stage: number }, i: number) => ({
        kind: 'upsert' as const,
        table: 'sleep' as const,
        record: { id: `${id}#${i}`, start: Date.parse(s.startTime), end: Date.parse(s.endTime), stage: SLEEP_STAGE[s.stage] ?? 'unknown', sourceId: origin ?? 'unknown', sourceKind: kind(origin) } satisfies SleepSegment
      }));
    case 'ExerciseSession': {
      const client = (meta.clientRecordId as string | undefined) ?? null;
      return [{
        kind: 'upsert',
        table: 'workout',
        record: {
          id,
          activity: r.exerciseType === 56 ? 'running' : r.exerciseType === 79 ? 'walking' : 'other',
          start: Date.parse(r.startTime),
          end: Date.parse(r.endTime),
          sourceId: origin ?? 'unknown',
          sourceKind: kind(origin),
          externalId: client?.startsWith('loopfield:') ? client.slice('loopfield:'.length) : null,
          version
        } satisfies WorkoutRecord
      }];
    }
  }
  return [];
}

export async function syncHealthConnect(cards: HealthCardId[]): Promise<{ changes: HealthChange[]; historyLimitedTo: number }> {
  if (!HC) return { changes: [], historyLimitedTo: DEFAULT_HISTORY_DAYS };
  await HC.initialize();
  const granted = new Set(await grantedReadTypes());
  const types = recordTypesFor(cards).filter((t) => granted.has(t));
  const changes: HealthChange[] = [];
  for (const rt of types) {
    const key = `hc:${rt}`;
    const token = getCursor(key);
    if (!token) {
      const start = new Date(Date.now() - DEFAULT_HISTORY_DAYS * 86_400_000).toISOString();
      let pageToken: string | undefined;
      do {
        const res = await HC.readRecords(rt, { timeRangeFilter: { operator: 'after', startTime: start }, pageToken, pageSize: 1000 });
        for (const r of res.records) changes.push(...mapRecord(rt, r));
        pageToken = res.pageToken || undefined;
      } while (pageToken);
      const t = await HC.getChanges({ recordTypes: [rt] });
      setCursor(key, t.nextChangesToken);
      continue;
    }
    let next = token;
    for (let i = 0; i < 20; i++) {
      const res = await HC.getChanges({ changesToken: next });
      if (res.changesTokenExpired) {
        setCursor(key, '');
        break;
      }
      for (const u of res.upsertionChanges) changes.push(...mapRecord(rt, u.record as Record<string, unknown>));
      for (const d of res.deletionChanges) changes.push({ kind: 'delete', table: rt === 'SleepSession' ? 'sleep' : rt === 'ExerciseSession' ? 'workout' : 'quantity', id: d.recordId });
      next = res.nextChangesToken;
      if (!res.hasMore) break;
    }
    setCursor(key, next);
  }
  return { changes, historyLimitedTo: DEFAULT_HISTORY_DAYS };
}

/** Optional workout export; clientRecordId makes retries update one app-owned record (FR53). */
export async function exportRunToHealthConnect(run: { activityId: string; start: number; end: number }): Promise<void> {
  if (!HC) return;
  await HC.insertRecords([
    { recordType: 'ExerciseSession', exerciseType: 56, startTime: new Date(run.start).toISOString(), endTime: new Date(run.end).toISOString(), title: 'Run', metadata: { clientRecordId: `loopfield:${run.activityId}`, clientRecordVersion: 1 } }
  ]);
}

export function openHealthConnectSettings(): void {
  HC?.openHealthConnectSettings();
}

/** Revokes every Health Connect permission this app holds. False when Health Connect is not in this build. */
export async function revokeHealthConnect(): Promise<boolean> {
  if (!HC) return false;
  await HC.initialize();
  await HC.revokeAllPermissions();
  return true;
}
