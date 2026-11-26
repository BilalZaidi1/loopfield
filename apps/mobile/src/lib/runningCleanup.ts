import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from './log';

/**
 * Phone copies the running tools keep (R1): planned routes (for following with no signal), their offline maps
 * and the round picture used as the position dot. All are removed at sign-out so the next account on this
 * phone starts clean. The heavier modules are loaded only when this runs.
 */
export const PLANNED_ROUTES_CACHE_KEY = 'planned-routes-v1';

export async function clearRunningToolsOnPhone(): Promise<void> {
  await AsyncStorage.removeItem(PLANNED_ROUTES_CACHE_KEY).catch(() => {});
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only at sign-out, keeps the session module light
    const offline = require('@/features/plan/offline') as typeof import('@/features/plan/offline');
    await offline.removeAllOffline();
  } catch (e) {
    log.warn(`offline maps not removed: ${e instanceof Error ? e.name : 'error'}`);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
    const marker = require('@/features/map/AvatarMarker') as typeof import('@/features/map/AvatarMarker');
    marker.clearMarkerFiles();
  } catch {
    // nothing kept
  }
}
