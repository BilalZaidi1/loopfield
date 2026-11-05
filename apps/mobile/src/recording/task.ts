import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { activeSession, appendSamples } from './db';

/**
 * Background location task, defined at module scope (imported from index.ts before the app renders)
 * so the OS can deliver location events while the UI is not mounted. Location events — not JavaScript
 * timers — are the sampling source. Each delivered batch is committed to SQLite immediately.
 */
export const LOCATION_TASK = 'loopfield-run-recording';

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error) return; // permission revoked or provider failure: the gap stays a gap
    const session = activeSession();
    if (!session || session.state !== 'recording' || !data?.locations?.length) return;
    appendSamples(session.id, data.locations as never);
  });
}
