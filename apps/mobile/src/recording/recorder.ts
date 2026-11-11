import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { summarizeActivity , durationBucket, distanceBucket } from '@loopfield/core';
import { callFunction } from '@/lib/api';
import { emitCue } from '@/lib/cues';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { isExpoGo } from '@/lib/runtime';
import { activeSession, addEvent, appendSamples, eventsFor, getSession, recordingDb, samplesFor, setSessionState, type RunMode } from './db';
import { LOCATION_TASK } from './task';
import { checkIntegrity, setAutoPauseHandler, setIntegrityOverrides, startSteps, stopSteps } from './integrity';
import { supabase } from '@/lib/supabase';

// The live movement check pauses through the same path as the Pause button.
setAutoPauseHandler((id) => pauseRun(id));

/** Backend-tuned integrity thresholds for this run; the defaults apply when offline. */
async function loadIntegrityOverrides(): Promise<void> {
  try {
    const { data } = await supabase().from('app_config').select('value').eq('key', 'integrity_overrides').maybeSingle();
    setIntegrityOverrides(data?.value ?? null);
  } catch {
    setIntegrityOverrides(null);
  }
}

export interface TicketResponse {
  claims: { ticketId: string; modes: { territory: boolean; speed: boolean }; competitionId: string; seasonId: string; courseVersionId: string | null; startBy: number; issuedAt: number };
  signature: string;
  season: { id: string; startsAt: string; endsAt: string };
}

export type PermissionResult = 'granted' | 'foreground_only' | 'denied' | 'services_disabled';

/**
 * Location permission in context: foreground first, then background for screen-locked recording.
 * Expo Go cannot record in the background at all, so there the "Always" prompt is not shown.
 */
export async function ensureLocationPermission(): Promise<PermissionResult> {
  if (!(await Location.hasServicesEnabledAsync())) return 'services_disabled';
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  if (isExpoGo) return 'foreground_only';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
  return bg.status === 'granted' ? 'granted' : 'foreground_only';
}

/**
 * Create a session. Competitive modes require an online signed ticket before recording starts; if it
 * cannot be obtained the caller must offer a private run instead (fully offline starts stay private).
 */
export async function createSession(opts: { userId: string; mode: RunMode; competitionId: string | null; courseVersionId: string | null }): Promise<{ sessionId: string; ticket: TicketResponse | null }> {
  const existing = activeSession();
  if (existing) throw new Error('A run is already in progress.');
  let ticket: TicketResponse | null = null;
  if (opts.mode !== 'private') {
    ticket = await callFunction<TicketResponse>('session-ticket', { mode: opts.mode, competitionId: opts.competitionId, courseVersionId: opts.courseVersionId });
  }
  const id = Crypto.randomUUID();
  recordingDb().runSync(
    'insert into sessions (id, user_id, state, mode, competition_id, course_version_id, ticket, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, opts.userId, 'ready', opts.mode, opts.competitionId, opts.courseVersionId, ticket ? JSON.stringify({ claims: ticket.claims, signature: ticket.signature }) : null, Date.now()]
  );
  return { sessionId: id, ticket };
}

let foregroundWatch: Location.LocationSubscription | null = null;
const KEEP_AWAKE_TAG = 'loopfield-recording';

/**
 * True while the current run records only while the app is on screen: in Expo Go, or when the phone refused
 * background location updates. Leaving the app stops location delivery; that time stays a gap (FR07).
 */
export function recordingInForegroundOnly(): boolean {
  return foregroundWatch !== null;
}

async function startUpdates(sessionId: string): Promise<void> {
  if (!isExpoGo) {
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Recording your run',
          notificationBody: 'Location is recorded until you finish this run.',
          killServiceOnDestroy: false
        }
      });
      return;
    } catch (e) {
      log.warn(`background location updates unavailable; recording while the app is open: ${String(e)}`);
    }
  }
  await startForegroundUpdates(sessionId);
}

/** Foreground fallback: the same samples, delivered only while the app is open; the screen is kept on. */
async function startForegroundUpdates(sessionId: string): Promise<void> {
  stopForegroundUpdates();
  foregroundWatch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (loc) => {
    appendSamples(sessionId, [loc]);
    void checkIntegrity(sessionId);
  });
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
}

function stopForegroundUpdates(): void {
  if (!foregroundWatch) return;
  foregroundWatch.remove();
  foregroundWatch = null;
  void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

async function stopUpdates(): Promise<void> {
  stopForegroundUpdates();
  await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
}

export async function startRun(sessionId: string, opts: { startCaptureNow: boolean; startSpeedNow: boolean }): Promise<void> {
  const s = getSession(sessionId);
  if (!s || s.state !== 'ready') throw new Error('Session is not ready');
  setSessionState(sessionId, { state: 'recording', started_at: Date.now() });
  addEvent(sessionId, 'start');
  void loadIntegrityOverrides();
  void startSteps();
  await startUpdates(sessionId);
  emitCue('started', 'Run started');
  if (opts.startCaptureNow && (s.mode === 'territory' || s.mode === 'territory_speed')) startCapture(sessionId);
  if (opts.startSpeedNow && (s.mode === 'speed' || s.mode === 'territory_speed')) startSpeedAttempt(sessionId);
  track('run_started', { activity_id: sessionId.replace(/-/g, '').slice(0, 32), mode: s.mode, competition_kind: 'public', device_class: 'unknown' });
}

/** Explicit capture interval start: travel before this point stays private (PRD §6). */
export function startCapture(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s || s.capture_state !== 'none') return;
  addEvent(sessionId, 'capture_start');
  setSessionState(sessionId, { capture_state: 'open' });
  emitCue('capture_started', 'Loop started. Return near this point to close it.');
}

export function endCapture(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s || s.capture_state !== 'open') return;
  addEvent(sessionId, 'capture_end');
  setSessionState(sessionId, { capture_state: 'closed' });
}

export function startSpeedAttempt(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s || s.speed_state !== 'none') return;
  addEvent(sessionId, 'speed_start');
  setSessionState(sessionId, { speed_state: 'open' });
  emitCue('speed_started', 'Speed attempt armed. Timing starts at the start gate.');
}

/** Pausing stops location updates; for competitive intervals a pause makes that interval ineligible. */
export async function pauseRun(sessionId: string): Promise<void> {
  addEvent(sessionId, 'pause');
  setSessionState(sessionId, { state: 'paused' });
  await stopUpdates();
  stopSteps();
  emitCue('paused', 'Paused');
}

export async function resumeRun(sessionId: string): Promise<void> {
  setSessionState(sessionId, { state: 'recording' });
  addEvent(sessionId, 'resume');
  void startSteps();
  await startUpdates(sessionId);
  emitCue('resumed', 'Resumed');
}

/** Finish: commit locally first, then queue the upload. Returns the local summary. */
export async function finishRun(sessionId: string): Promise<ReturnType<typeof summarizeActivity>> {
  const s = getSession(sessionId);
  if (!s) throw new Error('Unknown session');
  if (s.capture_state === 'open') endCapture(sessionId);
  if (s.speed_state === 'open') {
    addEvent(sessionId, 'speed_end');
    setSessionState(sessionId, { speed_state: 'closed' });
  }
  addEvent(sessionId, 'finish');
  setSessionState(sessionId, { state: 'finished', ended_at: Date.now() });
  await stopUpdates();
  stopSteps();
  const summary = summarizeActivity(samplesFor(sessionId), eventsFor(sessionId));
  recordingDb().runSync(
    'insert or replace into uploads (session_id, state, next_chunk, attempts, next_attempt_at, summary, updated_at) values (?, ?, 0, 0, 0, ?, ?)',
    [sessionId, 'pending', JSON.stringify(summary), Date.now()]
  );
  emitCue('finished', 'Run saved on this phone');
  track('run_saved', {
    activity_id: sessionId.replace(/-/g, '').slice(0, 32),
    mode: s.mode,
    duration_bucket: durationBucket(summary.elapsedMs),
    distance_bucket: distanceBucket(summary.distanceM),
    had_gap: summary.gaps.length > 0
  });
  return summary;
}

export async function discardRun(sessionId: string): Promise<void> {
  await stopUpdates();
  stopSteps();
  const d = recordingDb();
  d.withTransactionSync(() => {
    d.runSync('delete from samples where session_id = ?', [sessionId]);
    d.runSync('delete from events where session_id = ?', [sessionId]);
    d.runSync("update sessions set state = 'discarded' where id = ?", [sessionId]);
  });
}

export type RecoveryState = { kind: 'none' } | { kind: 'running'; sessionId: string } | { kind: 'interrupted'; sessionId: string; lastFixAt: number | null };

/**
 * On launch: if a run was recording but the OS stopped location updates (process killed, force-stop,
 * reboot), mark the interruption explicitly. The gap is never reconstructed (FR07).
 */
export async function checkRecovery(): Promise<RecoveryState> {
  const s = activeSession();
  if (!s || s.state === 'ready') return { kind: 'none' };
  if (s.state === 'paused' || recordingInForegroundOnly()) return { kind: 'running', sessionId: s.id };
  const running = isExpoGo ? false : await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) return { kind: 'running', sessionId: s.id };
  const already = eventsFor(s.id).slice(-1)[0];
  if (already?.kind !== 'interrupted') addEvent(s.id, 'interrupted', null as never, s.last_fix_at ?? Date.now());
  setSessionState(s.id, { state: 'paused' });
  return { kind: 'interrupted', sessionId: s.id, lastFixAt: s.last_fix_at };
}

export async function resumeAfterInterruption(sessionId: string): Promise<void> {
  addEvent(sessionId, 'recovered');
  await resumeRun(sessionId);
  track('run_recovered', { activity_id: sessionId.replace(/-/g, '').slice(0, 32), outcome: 'resumed' });
}
