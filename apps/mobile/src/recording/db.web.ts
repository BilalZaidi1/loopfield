import type { SQLiteDatabase } from 'expo-sqlite';
import type { LocationSample, RecordingEvent } from '@loopfield/core';
import type * as PhoneDb from './db';

export type { RunMode, SessionRow, SessionState, UploadRow } from './db';

/**
 * Browser version of the local recording store. Runs are recorded only in the phone app, so the browser has
 * no local sessions: reads are empty and any attempt to write a recording fails with a clear message instead
 * of pretending to record.
 */
const UNAVAILABLE = 'Recording runs needs the Loopfield phone app; the browser version cannot record.';
const unavailable = (): never => {
  throw new Error(UNAVAILABLE);
};

const emptyDb = {
  getFirstSync: () => null,
  getAllSync: () => [],
  runSync: unavailable,
  execSync: unavailable,
  withTransactionSync: unavailable
} as unknown as SQLiteDatabase;

export function recordingDb(): SQLiteDatabase {
  return emptyDb;
}
export function activeSession(): PhoneDb.SessionRow | null {
  return null;
}
export function getSession(_id: string): PhoneDb.SessionRow | null {
  return null;
}
export function samplesFor(_sessionId: string): LocationSample[] {
  return [];
}
export function samplesAfter(_sessionId: string, _afterSeq: number): LocationSample[] {
  return [];
}
export function samplesSince(_sessionId: string, _sinceT: number): LocationSample[] {
  return [];
}
export function eventsFor(_sessionId: string): RecordingEvent[] {
  return [];
}
export function addEvent(): void {
  unavailable();
}
export function appendSamples(): number {
  return 0;
}
export function setSessionState(): void {
  unavailable();
}
export function pendingUploads(_userId: string): (PhoneDb.UploadRow & { mode: PhoneDb.RunMode })[] {
  return [];
}
export function recentLocalRuns(_userId: string, _limit?: number): (PhoneDb.SessionRow & { upload_state: string | null; summary: string | null; receipt: string | null })[] {
  return [];
}

// Compile-time check that this file offers every function the phone version does, with compatible types.
const sameShape = { recordingDb, activeSession, getSession, samplesFor, samplesAfter, samplesSince, eventsFor, addEvent, appendSamples, setSessionState, pendingUploads, recentLocalRuns } satisfies {
  [K in keyof typeof PhoneDb]: (...args: never[]) => ReturnType<(typeof PhoneDb)[K]>;
};
void sameShape;
