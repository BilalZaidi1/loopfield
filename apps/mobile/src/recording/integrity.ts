import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  INTEGRITY_RULES,
  integrityRulesWith,
  liveIntegrity,
  liveIntegrityText,
  trailingRunningStretch,
  type IntegrityRules,
  type LiveIntegrity,
  type RecordingEvent,
  type StepWindow
} from '@loopfield/core';
import { emitCue } from '@/lib/cues';
import { log } from '@/lib/log';
import { isExpoGo } from '@/lib/runtime';
import { addEvent, getSession, samplesSince } from './db';

/**
 * The phone's live movement check while recording (11 Nov request): warns when the movement stops
 * looking like running, pauses the recording when it stays clearly impossible, and flags running speed
 * without running steps (a bicycle). Step counts never leave the phone: only a `steps_check` flag with
 * the time window is saved in the run's events. Runs from the background location task too.
 */

type Pedometer = typeof import('expo-sensors').Pedometer;
let pedometer: Pedometer | null = null;
if (Platform.OS !== 'web' && !isExpoGo) {
  try {
    pedometer = require('expo-sensors').Pedometer as Pedometer; // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    pedometer = null;
  }
}

let rules: IntegrityRules = INTEGRITY_RULES;
/** Backend overrides fetched before the run (falls back to the defaults offline). */
export function setIntegrityOverrides(overrides: unknown): void {
  rules = integrityRulesWith(overrides);
}

let pauseHandler: ((sessionId: string) => Promise<void>) | null = null;
/** The recorder registers its pause so this module never imports it (no import cycle with the task). */
export function setAutoPauseHandler(fn: (sessionId: string) => Promise<void>): void {
  pauseHandler = fn;
}

// ---- Step counter -------------------------------------------------------------------------------
let stepSub: { remove: () => void } | null = null;
let stepLog: StepWindow[] = [];
let stepBase: { t: number; steps: number } | null = null;
let stepsAvailable: boolean | null = null;

/** Starts counting steps for the step check. Asks for the motion permission once; denial just turns the check off. */
export async function startSteps(): Promise<void> {
  if (!pedometer || stepSub) return;
  try {
    if (stepsAvailable === null) stepsAvailable = await pedometer.isAvailableAsync();
    if (!stepsAvailable) return;
    const perm = await pedometer.requestPermissionsAsync().catch(() => null);
    if (perm && !perm.granted) {
      stepsAvailable = false;
      return;
    }
    stepBase = { t: Date.now(), steps: 0 };
    stepSub = pedometer.watchStepCount((r) => {
      const now = Date.now();
      if (stepBase) stepLog.push({ from: stepBase.t, to: now, steps: Math.max(0, r.steps - stepBase.steps) });
      stepBase = { t: now, steps: r.steps };
      const cutoff = now - 15 * 60_000;
      if (stepLog.length > 400) stepLog = stepLog.filter((w) => w.to >= cutoff);
    });
  } catch (e) {
    log.warn(`step counter unavailable: ${String(e)}`);
  }
}

export function stopSteps(): void {
  stepSub?.remove();
  stepSub = null;
  stepBase = null;
  stepLog = [];
}

/** Step windows covering [from, to]; null when the phone cannot say (no counter, no permission). */
async function stepsFor(from: number, to: number): Promise<StepWindow[] | null> {
  if (!pedometer || !stepsAvailable) return null;
  if (Platform.OS === 'ios') {
    // iOS keeps its own step history, so ask for exactly this window.
    const r = await pedometer.getStepCountAsync(new Date(from), new Date(to)).catch(() => null);
    return r ? [{ from, to, steps: r.steps }] : null;
  }
  // Android: only what was counted while this run's watch was active. A stretch with no step events at all
  // still counts as covered (zero steps) once the watch has been running for the whole window.
  if (!stepSub || !stepBase) return null;
  const windows = stepLog.filter((w) => w.to >= from && w.from <= to);
  const watchedSince = windows.length ? Math.min(...windows.map((w) => w.from)) : stepBase.t;
  if (watchedSince > from) return null;
  return [...windows, { from: stepBase.t, to, steps: 0 }];
}

// ---- The check ----------------------------------------------------------------------------------
let lastCheck = 0;
let checking = false;
const lastWarned: Record<string, number> = {};
let flaggedUntil = 0;
const WARN_EVERY_MS = 90_000;

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

/** Runs after new fixes are saved (at most every few seconds). Safe to call from the background task. */
export async function checkIntegrity(sessionId: string): Promise<LiveIntegrity | null> {
  const now = Date.now();
  if (checking || now - lastCheck < 5000) return null;
  checking = true;
  lastCheck = now;
  try {
    const session = getSession(sessionId);
    if (!session || session.state !== 'recording') return null;
    const recent = samplesSince(sessionId, now - rules.liveWindowSeconds.value * 1000);
    let r = liveIntegrity(recent, null, undefined, rules);
    if (r.state === 'ok') {
      const moving = trailingRunningStretch(recent, rules);
      if (moving && (moving.to - moving.from) / 1000 >= rules.stepsFlagSeconds.value) {
        const steps = await stepsFor(moving.from, moving.to);
        if (steps) r = liveIntegrity(recent, steps, undefined, rules);
      }
    }
    if (r.state === 'ok' || !r.reason) return r;
    const text = liveIntegrityText(r);
    const kmh = r.speed === null ? null : Math.round(r.speed * 3.6);
    if (r.reason === 'no_steps' && r.window && r.window.to > flaggedUntil) {
      // The only step information that leaves the phone: this window had no running steps.
      addEvent(sessionId, 'steps_check', { result: 'no_running_steps', from: Math.max(r.window.from, flaggedUntil), to: r.window.to });
      flaggedUntil = r.window.to;
    }
    if (r.state === 'pause' && pauseHandler) {
      addEvent(sessionId, 'auto_pause', { reason: r.reason, kmh, text });
      await pauseHandler(sessionId);
      emitCue('auto_paused', text);
      await notify('Recording paused', text);
      return r;
    }
    if (now - (lastWarned[r.reason] ?? 0) >= WARN_EVERY_MS) {
      lastWarned[r.reason] = now;
      addEvent(sessionId, 'speed_warning', { reason: r.reason, kmh, text });
      emitCue('speed_warning', text);
      await notify('This does not look like running', text);
    }
    return r;
  } catch (e) {
    log.warn(`integrity check failed: ${String(e)}`);
    return null;
  } finally {
    checking = false;
  }
}

/** The latest warning or automatic pause in this run, for the live screen (newest first). */
export function latestIntegrityNotice(events: readonly RecordingEvent[], now = Date.now()): { kind: 'warning' | 'paused'; text: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'resume') return null; // a resume clears an automatic pause
    if (e.kind === 'auto_pause') return { kind: 'paused', text: String(e.data?.text ?? 'Recording paused: this did not look like running.') };
    if (e.kind === 'speed_warning' && now - e.t < 60_000) return { kind: 'warning', text: String(e.data?.text ?? 'This does not look like running.') };
  }
  return null;
}

/** Test-only reset of module state. */
export function _resetIntegrityForTests(): void {
  lastCheck = 0;
  checking = false;
  flaggedUntil = 0;
  for (const k of Object.keys(lastWarned)) delete lastWarned[k];
  stopSteps();
  rules = INTEGRITY_RULES;
}
