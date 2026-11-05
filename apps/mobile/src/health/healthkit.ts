import { Platform } from 'react-native';
import { toCanonical, type HealthChange, type QuantitySample, type QuantityType, type SleepSegment, type SleepStage, type SourceKind, type WorkoutRecord } from '@loopfield/core';
import { getCursor, setCursor, type HealthCardId } from './cache';

/**
 * Apple Health adapter (iOS). Uses anchored queries so source updates and deletions are processed.
 * HealthKit does not reveal whether *read* access was denied: an empty result is reported as
 * "no readable data", never as "permission denied" (PRD §9, S28).
 */
const HK = Platform.OS === 'ios' ? require('@kingstinct/react-native-healthkit') : null;

const QUANTITY: Record<string, { id: string; type: QuantityType; unit: string; method?: string }> = {
  heart_rate: { id: 'HKQuantityTypeIdentifierHeartRate', type: 'heart_rate', unit: 'count/min' },
  resting_hr: { id: 'HKQuantityTypeIdentifierRestingHeartRate', type: 'resting_heart_rate', unit: 'count/min' },
  hrv: { id: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', type: 'hrv', unit: 'ms', method: 'sdnn' },
  vo2_max: { id: 'HKQuantityTypeIdentifierVO2Max', type: 'vo2_max', unit: 'ml/(kg*min)' },
  steps: { id: 'HKQuantityTypeIdentifierStepCount', type: 'steps', unit: 'count' },
  calories: { id: 'HKQuantityTypeIdentifierActiveEnergyBurned', type: 'active_energy', unit: 'kcal' },
  elevation: { id: 'HKQuantityTypeIdentifierFlightsClimbed', type: 'elevation_gain', unit: 'count' }
};
const SLEEP_ID = 'HKCategoryTypeIdentifierSleepAnalysis';
const WORKOUT_ID = 'HKWorkoutTypeIdentifier';
const OWN_BUNDLE_HINT = 'loopfield';

export const healthKitAvailable = async (): Promise<boolean> => Boolean(HK && (await HK.isHealthDataAvailableAsync().catch(() => false)));

function readTypesFor(cards: HealthCardId[]): string[] {
  const ids = new Set<string>([WORKOUT_ID]);
  for (const c of cards) {
    if (c === 'zones') ids.add(QUANTITY.heart_rate!.id);
    else if (c === 'sleep') ids.add(SLEEP_ID);
    else if (QUANTITY[c]) ids.add(QUANTITY[c]!.id);
  }
  return [...ids];
}

/** Request only the types needed for the cards the runner enabled (FR46). */
export async function requestHealthKit(cards: HealthCardId[], exportWorkouts: boolean): Promise<boolean> {
  if (!HK) return false;
  return HK.requestAuthorization({ toRead: readTypesFor(cards), toShare: exportWorkouts ? [WORKOUT_ID] : [] });
}

function sourceKind(bundle: string, productType?: string): SourceKind {
  if (bundle.toLowerCase().includes(OWN_BUNDLE_HINT)) return 'self';
  if (productType?.startsWith('Watch')) return 'watch';
  if (bundle.startsWith('com.apple.health')) return 'phone';
  return 'other_app';
}

const SLEEP_MAP: Record<number, SleepStage> = { 0: 'in_bed', 1: 'asleep', 2: 'awake', 3: 'light', 4: 'deep', 5: 'rem' };

async function anchoredQuantity(card: string, since: Date): Promise<HealthChange[]> {
  const q = QUANTITY[card]!;
  const key = `hk:${q.id}`;
  const res = await HK.queryQuantitySamplesWithAnchor(q.id, { limit: 0, anchor: getCursor(key) ?? undefined, unit: q.unit, filter: { date: { startDate: since } } });
  const changes: HealthChange[] = res.samples.map((s: { uuid: string; quantity: number; unit: string; startDate: Date; endDate: Date; sourceRevision: { source: { bundleIdentifier: string }; productType?: string } }) => ({
    kind: 'upsert' as const,
    table: 'quantity' as const,
    record: {
      id: s.uuid,
      type: q.type,
      value: q.type === 'elevation_gain' ? s.quantity * 3 : toCanonical(q.type, s.quantity, s.unit),
      start: new Date(s.startDate).getTime(),
      end: new Date(s.endDate).getTime(),
      sourceId: s.sourceRevision.source.bundleIdentifier,
      sourceKind: sourceKind(s.sourceRevision.source.bundleIdentifier, s.sourceRevision.productType),
      method: q.type === 'elevation_gain' ? 'flights_climbed_x3m' : q.method ?? null,
      tzOffsetMin: -new Date(s.startDate).getTimezoneOffset()
    } satisfies QuantitySample
  }));
  for (const d of res.deletedSamples) changes.push({ kind: 'delete', table: 'quantity', id: d.uuid });
  setCursor(key, res.newAnchor);
  return changes;
}

export async function syncHealthKit(cards: HealthCardId[], historyDays = 90): Promise<HealthChange[]> {
  if (!HK) return [];
  const since = new Date(Date.now() - historyDays * 86_400_000);
  const changes: HealthChange[] = [];
  for (const card of cards) {
    if (card === 'zones' || card === 'sleep' || card === 'workouts' || card === 'cadence') continue;
    if (QUANTITY[card]) changes.push(...(await anchoredQuantity(card, since)));
  }
  if (cards.includes('zones') && !cards.includes('heart_rate')) changes.push(...(await anchoredQuantity('heart_rate', since)));
  if (cards.includes('sleep')) {
    const key = `hk:${SLEEP_ID}`;
    const res = await HK.queryCategorySamplesWithAnchor(SLEEP_ID, { limit: 0, anchor: getCursor(key) ?? undefined, filter: { date: { startDate: since } } });
    for (const s of res.samples as { uuid: string; value: number; startDate: Date; endDate: Date; sourceRevision: { source: { bundleIdentifier: string }; productType?: string } }[]) {
      changes.push({
        kind: 'upsert',
        table: 'sleep',
        record: {
          id: s.uuid,
          start: new Date(s.startDate).getTime(),
          end: new Date(s.endDate).getTime(),
          stage: SLEEP_MAP[s.value] ?? 'unknown',
          sourceId: s.sourceRevision.source.bundleIdentifier,
          sourceKind: sourceKind(s.sourceRevision.source.bundleIdentifier, s.sourceRevision.productType),
          tzOffsetMin: -new Date(s.startDate).getTimezoneOffset()
        } satisfies SleepSegment
      });
    }
    for (const d of res.deletedSamples) changes.push({ kind: 'delete', table: 'sleep', id: d.uuid });
    setCursor(key, res.newAnchor);
  }
  // Workouts (always read: needed for duplicate resolution and the running overview).
  const wkey = `hk:${WORKOUT_ID}`;
  const w = await HK.queryWorkoutSamplesWithAnchor({ limit: 0, anchor: getCursor(wkey) ?? undefined, filter: { date: { startDate: since } } });
  for (const wo of w.workouts as { uuid: string; workoutActivityType: number; startDate: Date; endDate: Date; totalDistance?: { quantity: number; unit: string }; totalEnergyBurned?: { quantity: number; unit: string }; metadata?: Record<string, unknown>; sourceRevision: { source: { bundleIdentifier: string }; productType?: string } }[]) {
    const external = (wo.metadata?.HKExternalUUID as string | undefined) ?? null;
    changes.push({
      kind: 'upsert',
      table: 'workout',
      record: {
        id: wo.uuid,
        activity: wo.workoutActivityType === 37 ? 'running' : wo.workoutActivityType === 52 ? 'walking' : 'other',
        start: new Date(wo.startDate).getTime(),
        end: new Date(wo.endDate).getTime(),
        sourceId: wo.sourceRevision.source.bundleIdentifier,
        sourceKind: sourceKind(wo.sourceRevision.source.bundleIdentifier, wo.sourceRevision.productType),
        distanceM: wo.totalDistance ? toCanonical('distance', wo.totalDistance.quantity, wo.totalDistance.unit) : null,
        activeEnergyKcal: wo.totalEnergyBurned ? toCanonical('active_energy', wo.totalEnergyBurned.quantity, wo.totalEnergyBurned.unit) : null,
        externalId: external?.startsWith('loopfield:') ? external.slice('loopfield:'.length) : null
      } satisfies WorkoutRecord
    });
  }
  for (const d of w.deletedSamples) changes.push({ kind: 'delete', table: 'workout', id: d.uuid });
  setCursor(wkey, w.newAnchor);
  return changes;
}

/** Optional export of a first-party run (separate write consent). External UUID prevents re-import duplicates. */
export async function exportRunToHealthKit(run: { activityId: string; start: number; end: number; distanceM: number }): Promise<void> {
  if (!HK) return;
  const existing = await HK.queryWorkoutSamples({ limit: 1, filter: { metadata: { withMetadataKey: 'HKExternalUUID', operatorType: 4 /* ComparisonPredicateOperator.equalTo */, value: `loopfield:${run.activityId}` } } }).catch(() => []);
  if (existing.length) return; // retries update nothing: exactly one app-owned record
  await HK.saveWorkoutSample(37, [], new Date(run.start), new Date(run.end), { distance: run.distanceM }, { HKExternalUUID: `loopfield:${run.activityId}` });
}
