import { useSyncExternalStore } from 'react';
import { parseHeartRateMeasurement, strapSample, STRAP_RULES, usableBpm, type QuantitySample } from '@loopfield/core';
import { track } from '@/lib/analytics';
import { fetchAppConfig } from '@/lib/appConfig';
import { log } from '@/lib/log';
import { deleteOwnHeartRate, persistChanges } from '@/health/cache';
import { notifyHealthChanged } from '@/health/changes';
import { bluetoothInBuild, connectStrap, disconnectStrap, listenToStrap } from './ble';
import { loadPairedStrap } from './strap';

/**
 * The paired strap during a run (R3). When a run starts, the phone connects to the strap by itself and shows live
 * heart rate; after a drop it says so and keeps trying, and the run carries on either way. Readings go into the
 * phone's health cache as the app's own source every 15 seconds and when the run ends. Nothing here is sent
 * anywhere: no reading, strap name or strap id leaves the phone.
 */
export type StrapStatus = 'idle' | 'connecting' | 'connected' | 'lost';

export interface StrapLive {
  status: StrapStatus;
  bpm: number | null;
  /** When the last usable reading came. */
  at: number | null;
}

export const STRAP_TIMING = {
  /** Wait between reconnection attempts. */
  retryMs: 5000,
  /** Readings are written to the health cache this often during a run. */
  flushMs: 15_000,
  /** A reading older than this is no longer shown as live. */
  staleMs: 10_000
} as const;

const IDLE: StrapLive = { status: 'idle', bpm: null, at: null };
let live: StrapLive = IDLE;
const listeners = new Set<() => void>();
function set(patch: Partial<StrapLive>): void {
  live = { ...live, ...patch };
  for (const l of listeners) l();
}

interface Current {
  sessionId: string;
  strapId: string;
  startedAt: number;
  readings: number;
  dropped: boolean;
  failedOnce: boolean;
  stopListening: () => void;
  retry: ReturnType<typeof setTimeout> | null;
  flush: ReturnType<typeof setInterval> | null;
}

let current: Current | null = null;
let buffer: QuantitySample[] = [];
let lastKept = 0;

function writeBuffer(): void {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  try {
    persistChanges(batch.map((record) => ({ kind: 'upsert' as const, table: 'quantity' as const, record })));
  } catch (e) {
    log.warn(`strap readings not kept: ${e instanceof Error ? e.name : 'error'}`);
  }
}

function onPacket(bytes: number[], at: number): void {
  const c = current;
  if (!c) return;
  const bpm = usableBpm(parseHeartRateMeasurement(bytes));
  if (bpm == null) return;
  set({ bpm, at, status: 'connected' });
  if (at - lastKept < STRAP_RULES.keepEveryMs) return;
  lastKept = at;
  c.readings++;
  buffer.push(strapSample(at, bpm));
}

function onLost(): void {
  const c = current;
  if (!c) return;
  set({ status: 'lost' });
  if (!c.dropped) track('sensor', { action: 'dropped' });
  c.dropped = true;
  scheduleRetry(c);
}

function scheduleRetry(c: Current): void {
  if (current !== c || c.retry) return;
  c.retry = setTimeout(() => {
    c.retry = null;
    if (current === c) void attempt(c);
  }, STRAP_TIMING.retryMs);
}

async function attempt(c: Current): Promise<void> {
  try {
    await connectStrap(c.strapId);
    if (current !== c) {
      void disconnectStrap(c.strapId);
      return;
    }
    set({ status: 'connected' });
    if (c.dropped) {
      track('sensor', { action: 'reconnected' });
      c.dropped = false;
    }
  } catch {
    if (current !== c) return;
    if (!c.failedOnce && !c.dropped) track('sensor', { action: 'connection_failed' });
    c.failedOnce = true;
    set({ status: c.dropped || c.readings ? 'lost' : 'connecting' });
    scheduleRetry(c);
  }
}

let starting: { sessionId: string; p: Promise<boolean> } | null = null;
/** Moves on whenever a run's strap is stopped, so a connection still being set up for it is abandoned. */
let epoch = 0;

/** Connects the paired strap for this run when there is one and straps are switched on. */
export function startStrapForRun(sessionId: string, enabled: boolean): Promise<boolean> {
  if (current?.sessionId === sessionId) return Promise.resolve(true);
  if (starting?.sessionId === sessionId) return starting.p;
  const p = begin(sessionId, enabled).finally(() => {
    if (starting?.p === p) starting = null;
  });
  starting = { sessionId, p };
  return p;
}

async function begin(sessionId: string, enabled: boolean): Promise<boolean> {
  const mine = epoch;
  if (!enabled) return false;
  const strap = await loadPairedStrap();
  if (mine !== epoch || !strap || !bluetoothInBuild()) return false;
  if (current) await stopStrapForRun();
  const c: Current = { sessionId, strapId: strap.id, startedAt: Date.now(), readings: 0, dropped: false, failedOnce: false, stopListening: () => {}, retry: null, flush: null };
  current = c;
  lastKept = 0;
  c.stopListening = listenToStrap(strap.id, onPacket, onLost);
  c.flush = setInterval(writeBuffer, STRAP_TIMING.flushMs);
  set({ status: 'connecting', bpm: null, at: null });
  await attempt(c);
  return true;
}

function release(c: Current): void {
  current = null;
  if (c.retry) clearTimeout(c.retry);
  if (c.flush) clearInterval(c.flush);
  c.stopListening();
  set(IDLE);
}

/**
 * For a run the app picks up again (after the app was closed, or reopened during a run): connects the strap when
 * it isn't connected yet, following the switch of the moment.
 */
export async function ensureStrapForRun(sessionId: string): Promise<void> {
  if (current?.sessionId === sessionId) return;
  const mine = epoch;
  try {
    const cfg = await fetchAppConfig();
    if (mine !== epoch) return;
    await startStrapForRun(sessionId, cfg.enabled.ble_sensors_enabled);
  } catch (e) {
    log.warn(`strap not reconnected: ${e instanceof Error ? e.name : 'error'}`);
  }
}

/** The run finished: the last readings are kept and the strap is let go. Returns how many readings the run kept. */
export async function stopStrapForRun(): Promise<number> {
  epoch++;
  const c = current;
  if (!c) return 0;
  release(c);
  writeBuffer();
  if (c.readings) notifyHealthChanged();
  await disconnectStrap(c.strapId);
  return c.readings;
}

/** The run was discarded: its strap readings are deleted from the phone too. */
export async function discardStrapForRun(): Promise<void> {
  epoch++;
  const c = current;
  if (!c) return;
  release(c);
  buffer = [];
  try {
    deleteOwnHeartRate(c.startedAt, Date.now());
  } catch (e) {
    log.warn(`strap readings not removed: ${e instanceof Error ? e.name : 'error'}`);
  }
  if (c.readings) notifyHealthChanged();
  await disconnectStrap(c.strapId);
}

export function useStrapLive(): StrapLive {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => live
  );
}

/** Test-only reset. */
export function _resetRunStrapForTests(): void {
  if (current) release(current);
  starting = null;
  buffer = [];
  lastKept = 0;
  live = IDLE;
}
