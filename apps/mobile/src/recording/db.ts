import * as SQLite from 'expo-sqlite';
import type { LocationSample, RecordingEvent, RecordingEventKind } from '@loopfield/core';

/**
 * Durable local store for recording sessions. Location events append samples here directly from the
 * background task; the UI only reads. A run is "saved" as soon as its finish event is committed here,
 * before any network activity (PRD §8 "save locally first").
 */
export type SessionState = 'ready' | 'recording' | 'paused' | 'finished' | 'discarded';
export type RunMode = 'private' | 'territory' | 'speed' | 'territory_speed';

export interface SessionRow {
  id: string;
  user_id: string;
  state: SessionState;
  mode: RunMode;
  competition_id: string | null;
  course_version_id: string | null;
  ticket: string | null;
  started_at: number | null;
  ended_at: number | null;
  next_seq: number;
  last_fix_at: number | null;
  capture_state: 'none' | 'open' | 'closed';
  speed_state: 'none' | 'open' | 'closed';
  created_at: number;
}

export interface UploadRow {
  session_id: string;
  state: 'pending' | 'uploading' | 'received' | 'failed_permanent';
  next_chunk: number;
  chunk_count: number | null;
  attempts: number;
  last_error: string | null;
  receipt: string | null;
  next_attempt_at: number;
  summary: string | null;
  updated_at: number;
}

let db: SQLite.SQLiteDatabase | null = null;

export function recordingDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync('recording.db');
  db.execSync(`
    pragma journal_mode = wal;
    pragma synchronous = normal;
    create table if not exists sessions (
      id text primary key, user_id text not null, state text not null, mode text not null,
      competition_id text, course_version_id text, ticket text,
      started_at integer, ended_at integer, next_seq integer not null default 0, last_fix_at integer,
      capture_state text not null default 'none', speed_state text not null default 'none', created_at integer not null
    );
    create table if not exists samples (
      session_id text not null, seq integer not null, t integer not null, mono integer,
      lat real not null, lng real not null, acc real, alt real, alt_acc real, spd real, hdg real, mocked integer not null default 0,
      primary key (session_id, seq)
    );
    create table if not exists events (
      id integer primary key autoincrement, session_id text not null, t integer not null, mono integer,
      kind text not null, after_seq integer not null, data text
    );
    create table if not exists uploads (
      session_id text primary key, state text not null, next_chunk integer not null default 0, chunk_count integer,
      attempts integer not null default 0, last_error text, receipt text, next_attempt_at integer not null default 0,
      summary text, updated_at integer not null
    );
  `);
  return db;
}

export function activeSession(): SessionRow | null {
  return recordingDb().getFirstSync<SessionRow>(`select * from sessions where state in ('ready', 'recording', 'paused') order by created_at desc limit 1`);
}

export function getSession(id: string): SessionRow | null {
  return recordingDb().getFirstSync<SessionRow>('select * from sessions where id = ?', [id]);
}

export function samplesFor(sessionId: string): LocationSample[] {
  return recordingDb()
    .getAllSync<{ seq: number; t: number; mono: number | null; lat: number; lng: number; acc: number | null; alt: number | null; alt_acc: number | null; spd: number | null; hdg: number | null; mocked: number }>(
      'select * from samples where session_id = ? order by seq',
      [sessionId]
    )
    .map((r) => ({ seq: r.seq, t: r.t, mono: r.mono, lat: r.lat, lng: r.lng, acc: r.acc, alt: r.alt, altAcc: r.alt_acc, spd: r.spd, hdg: r.hdg, mocked: r.mocked === 1 }));
}

export function eventsFor(sessionId: string): RecordingEvent[] {
  return recordingDb()
    .getAllSync<{ t: number; mono: number | null; kind: RecordingEventKind; after_seq: number; data: string | null }>('select * from events where session_id = ? order by id', [sessionId])
    .map((e) => ({ t: e.t, mono: e.mono, kind: e.kind, afterSeq: e.after_seq, ...(e.data ? { data: JSON.parse(e.data) } : {}) }));
}

export function addEvent(sessionId: string, kind: RecordingEventKind, data?: Record<string, string | number | boolean | null>, at = Date.now()): void {
  const d = recordingDb();
  const s = getSession(sessionId);
  d.runSync('insert into events (session_id, t, mono, kind, after_seq, data) values (?, ?, ?, ?, ?, ?)', [
    sessionId,
    at,
    Math.round(performance.now()),
    kind,
    (s?.next_seq ?? 0) - 1,
    data ? JSON.stringify(data) : null
  ]);
}

/** Called from the background location task; one transaction per delivered batch. */
export function appendSamples(sessionId: string, locations: { timestamp: number; mocked?: boolean; coords: { latitude: number; longitude: number; accuracy: number | null; altitude: number | null; altitudeAccuracy: number | null; speed: number | null; heading: number | null } }[]): number {
  const d = recordingDb();
  let appended = 0;
  d.withTransactionSync(() => {
    const s = getSession(sessionId);
    if (!s || s.state !== 'recording') return;
    let seq = s.next_seq;
    let lastT = s.last_fix_at ?? 0;
    for (const loc of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      if (loc.timestamp <= lastT) continue; // duplicate or out-of-order delivery
      const c = loc.coords;
      d.runSync(
        'insert or ignore into samples (session_id, seq, t, mono, lat, lng, acc, alt, alt_acc, spd, hdg, mocked) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sessionId, seq, Math.round(loc.timestamp), Math.round(performance.now()), c.latitude, c.longitude, c.accuracy, c.altitude, c.altitudeAccuracy, c.speed != null && c.speed >= 0 ? c.speed : null, c.heading != null && c.heading >= 0 ? c.heading : null, loc.mocked ? 1 : 0]
      );
      seq++;
      lastT = loc.timestamp;
      appended++;
    }
    d.runSync('update sessions set next_seq = ?, last_fix_at = ? where id = ?', [seq, lastT || null, sessionId]);
  });
  return appended;
}

export function setSessionState(id: string, patch: Partial<Pick<SessionRow, 'state' | 'started_at' | 'ended_at' | 'capture_state' | 'speed_state' | 'ticket'>>): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  recordingDb().runSync(`update sessions set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`, [...keys.map((k) => (patch[k] ?? null) as never), id]);
}

export function pendingUploads(userId: string): (UploadRow & { mode: RunMode })[] {
  return recordingDb().getAllSync('select u.*, s.mode from uploads u join sessions s on s.id = u.session_id where s.user_id = ? and u.state in (\'pending\', \'uploading\') order by u.updated_at', [userId]);
}

export function recentLocalRuns(userId: string, limit = 20): (SessionRow & { upload_state: string | null; summary: string | null; receipt: string | null })[] {
  return recordingDb().getAllSync(
    `select s.*, u.state as upload_state, u.summary, u.receipt from sessions s left join uploads u on u.session_id = s.id
      where s.user_id = ? and s.state = 'finished' order by s.started_at desc limit ?`,
    [userId, limit]
  );
}
