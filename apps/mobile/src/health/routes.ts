import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { HealthStore, CanonicalSession } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { deleteKeptRoutes, getImportedMapsFlag, getKeptRoute, keepRoute, setImportedMapsFlag } from './cache';
import { readExerciseRoute } from './healthconnect';

/**
 * Maps of imported runs (R3). A run another app saved to Health Connect can show its route on this phone, once the
 * runner turns on *Show maps for imported runs* and opens the run. Android asks the runner once for each route
 * another app recorded, so routes are read only while the runner is looking at that run, never in a background
 * sync. The points are kept in the phone's health cache with the run and removed when the runner turns maps off,
 * disconnects the health app, or the cache's retention ends. They are never uploaded or shared and never count for
 * anything. Apple Health routes come with the iPhone app.
 */
export const IMPORTED_ROUTES_CARD = 'imported_routes';

export type ImportedRoute =
  | { kind: 'route'; points: [number, number][] }
  | { kind: 'none' }
  | { kind: 'declined' }
  | { kind: 'unavailable' };

/** Maps of imported runs need Health Connect for now. */
export function importedMapsSupported(): boolean {
  return Platform.OS === 'android';
}

const listeners = new Set<() => void>();
let version = 0;
function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function importedMapsOn(): boolean {
  if (!importedMapsSupported()) return false;
  try {
    return getImportedMapsFlag();
  } catch {
    return false;
  }
}

/** Turning maps off deletes every route kept on the phone. */
export function setImportedMapsOn(on: boolean): void {
  setImportedMapsFlag(on);
  if (!on) deleteKeptRoutes();
  track('imported_map', { action: on ? 'turned_on' : 'turned_off' });
  emit();
}

export function useImportedMapsOn(): boolean {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  return importedMapsOn();
}

/** The session's own workout records, the primary source's first: the one whose route is asked for first. */
export function routeRecordIds(s: Pick<CanonicalSession, 'recordIds' | 'primarySourceId'>, store: HealthStore): string[] {
  const primary = (id: string) => store.workout.get(id)?.sourceId === s.primarySourceId;
  return [...s.recordIds.filter(primary), ...s.recordIds.filter((id) => !primary(id))];
}

/** A route already on the phone for any of the records ('none' when the run was saved without one), or null. */
export function keptRouteFor(recordIds: readonly string[]): ImportedRoute | null {
  let none = false;
  for (const id of recordIds) {
    let kept: [number, number][] | null | undefined;
    try {
      kept = getKeptRoute(id);
    } catch {
      kept = undefined;
    }
    if (kept && kept.length > 1) return { kind: 'route', points: kept };
    if (kept === null) none = true;
  }
  return none ? { kind: 'none' } : null;
}

/**
 * Reads a run's route from Health Connect, letting Android ask the runner where it must, and keeps the answer.
 * Only for the runner's tap on *Show map*.
 */
export async function showImportedRoute(recordIds: readonly string[], endAt: number): Promise<ImportedRoute> {
  if (!importedMapsOn()) return { kind: 'unavailable' };
  const kept = keptRouteFor(recordIds);
  if (kept?.kind === 'route') return kept;
  let declined = false;
  for (const id of recordIds) {
    try {
      const r = await readExerciseRoute(id);
      if (r.kind === 'declined') {
        declined = true;
        continue;
      }
      keepRoute(id, r.kind === 'route' ? r.points : null, endAt);
      if (r.kind === 'route') {
        track('imported_map', { action: 'shown' });
        emit();
        return r;
      }
    } catch (e) {
      log.warn(`imported route not read: ${e instanceof Error ? e.name : 'error'}`);
    }
  }
  emit();
  if (declined) {
    track('imported_map', { action: 'permission_declined' });
    return { kind: 'declined' };
  }
  track('imported_map', { action: 'no_route' });
  return { kind: 'none' };
}
