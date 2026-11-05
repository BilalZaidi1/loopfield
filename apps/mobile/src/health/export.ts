import { Platform } from 'react-native';
import { getConnection } from './cache';
import { exportRunToHealthConnect } from './healthconnect';
import { exportRunToHealthKit } from './healthkit';
import { HEALTH_PLATFORM } from './sync';

/**
 * Optional, opt-in export of a first-party run's basic workout totals to the platform store (FR53).
 * Only start/end and distance are written; no route, no competition data. Retries are idempotent
 * through the app-owned external identifier, which also prevents re-import duplicates.
 */
export function canExportRuns(): boolean {
  const c = getConnection(HEALTH_PLATFORM);
  return c.connected && c.exportEnabled;
}

export async function exportRun(run: { activityId: string; start: number; end: number; distanceM: number }): Promise<void> {
  if (!canExportRuns()) throw new Error('Workout export is not enabled. Turn it on in Health connections.');
  if (Platform.OS === 'ios') await exportRunToHealthKit(run);
  else await exportRunToHealthConnect(run);
}
