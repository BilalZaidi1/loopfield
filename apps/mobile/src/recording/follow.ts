import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  FOLLOW_START,
  decodePolyline,
  encodePolyline,
  followSteps,
  remainingM,
  routeGeometry,
  type FollowSnapshot,
  type LatLng,
  type RouteGeometry
} from '@loopfield/core';
import { emitCue } from '@/lib/cues';
import { log } from '@/lib/log';
import { recordingDb, samplesSince } from './db';

/**
 * Following a route during a run (R1): the line the runner chose before GO (a planned route or the speed
 * route they race) is kept with the run on the phone, and after each batch of fixes the off-route check
 * runs over the new fixes. It runs from the background location task too, so the snapshot is saved in
 * SQLite after every check and survives the app being restarted. Following is guidance only: nothing here
 * is uploaded or changes how the run is judged.
 */

export type FollowKind = 'planned' | 'speed_route';

export interface FollowChoice {
  kind: FollowKind;
  /** The planned route or speed route it came from. */
  refId: string | null;
  name: string;
  path: LatLng[];
}

export interface FollowRow {
  session_id: string;
  kind: FollowKind;
  ref_id: string | null;
  name: string;
  path: string;
  off_route_m: number;
  off_route_s: number;
  snapshot: string | null;
  updated_at: number;
}

export interface FollowStatus {
  kind: FollowKind;
  name: string;
  path: LatLng[];
  snap: FollowSnapshot;
  totalM: number;
  remainingM: number;
}

/** Messages spoken and shown for the alerts (every cue also has a visual banner). */
export const OFF_ROUTE_TEXT = 'You are off the route. Head back to the dashed line.';
export const BACK_ON_ROUTE_TEXT = 'Back on route.';

// The followed line, decoded once per run (the recorder reads the status every second).
const lines = new Map<string, { encoded: string; path: LatLng[]; geom: RouteGeometry }>();
function lineFor(row: FollowRow): { path: LatLng[]; geom: RouteGeometry } {
  const cached = lines.get(row.session_id);
  if (cached && cached.encoded === row.path) return cached;
  const path = decodePolyline(row.path);
  const entry = { encoded: row.path, path, geom: routeGeometry(path) };
  lines.set(row.session_id, entry);
  return entry;
}

/** Called once the run has started: keeps the chosen line with this run. */
export function attachFollow(sessionId: string, choice: FollowChoice, settings: { offRouteM: number; offRouteSeconds: number }): void {
  if (choice.path.length < 2) return;
  lines.delete(sessionId);
  try {
    recordingDb().runSync(
      'insert or replace into follows (session_id, kind, ref_id, name, path, off_route_m, off_route_s, snapshot, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sessionId, choice.kind, choice.refId, choice.name, encodePolyline(choice.path), settings.offRouteM, settings.offRouteSeconds, JSON.stringify(FOLLOW_START), Date.now()]
    );
  } catch (e) {
    log.warn(`could not keep the followed route: ${String(e)}`);
  }
}

export function getFollow(sessionId: string): FollowRow | null {
  return recordingDb().getFirstSync<FollowRow>('select * from follows where session_id = ?', [sessionId]);
}

export function followStatus(sessionId: string): FollowStatus | null {
  const row = getFollow(sessionId);
  if (!row) return null;
  const { path, geom } = lineFor(row);
  const snap = row.snapshot ? (JSON.parse(row.snapshot) as FollowSnapshot) : FOLLOW_START;
  return { kind: row.kind, name: row.name, path, snap, totalM: geom.total, remainingM: remainingM(geom, snap) };
}

/** What analytics may say about following in this run: the kind and how many alerts (bucketed by the caller). */
export function followSummary(sessionId: string): { followed: 'none' | FollowKind; alerts: number } {
  try {
    const row = getFollow(sessionId);
    if (!row) return { followed: 'none', alerts: 0 };
    const snap = row.snapshot ? (JSON.parse(row.snapshot) as FollowSnapshot) : FOLLOW_START;
    return { followed: row.kind, alerts: snap.alerts };
  } catch {
    return { followed: 'none', alerts: 0 };
  }
}

async function notify(title: string, body: string): Promise<void> {
  if (AppState.currentState === 'active') return; // the screen shows it
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url: '/run/active' } }, trigger: null });
  } catch {
    // a missed notification must never break recording
  }
}

let lastCheck = 0;
let checking = false;

/** After new fixes are saved (at most every few seconds). Safe to call from the background task. */
export async function checkFollow(sessionId: string, now = Date.now()): Promise<void> {
  if (checking || now - lastCheck < 3000) return;
  checking = true;
  lastCheck = now;
  try {
    const row = getFollow(sessionId);
    if (!row) return;
    const snap = row.snapshot ? (JSON.parse(row.snapshot) as FollowSnapshot) : FOLLOW_START;
    const fixes = samplesSince(sessionId, snap.lastT + 1);
    if (!fixes.length) return;
    const r = followSteps(lineFor(row).geom, snap, fixes, { offRouteM: row.off_route_m, offRouteSeconds: row.off_route_s });
    recordingDb().runSync('update follows set snapshot = ?, updated_at = ? where session_id = ?', [JSON.stringify(r.snap), now, sessionId]);
    for (const e of r.events) {
      if (e === 'off_route') {
        emitCue('off_route', OFF_ROUTE_TEXT);
        await notify('Off the route', OFF_ROUTE_TEXT);
      } else emitCue('back_on_route', BACK_ON_ROUTE_TEXT);
    }
  } catch (e) {
    log.warn(`route check failed: ${String(e)}`);
  } finally {
    checking = false;
  }
}

/** Test-only reset of module state. */
export function _resetFollowForTests(): void {
  lastCheck = 0;
  checking = false;
  lines.clear();
}
