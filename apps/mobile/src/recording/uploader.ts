import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { bytesBucket, serializeSamples } from '@loopfield/core';
import { ApiError, callFunction } from '@/lib/api';
import { track } from '@/lib/analytics';
import { log } from '@/lib/log';
import { eventsFor, getSession, pendingUploads, recordingDb, samplesFor } from './db';

const CHUNK = 600;
let running = false;

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

export interface ReceiptResponse {
  activityId: string;
  receivedAt: string;
  status: string;
  territoryClaimId: string | null;
  speedAttemptId: string | null;
  competitive: { territory: string[] | 'queued' | null; speed: string[] | 'queued' | null };
}

function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 2 ** attempts * 5_000);
}

/**
 * Upload queue: chunked, digest-verified, resumable and idempotent. A completed upload yields a
 * durable server receipt; only then is the local raw evidence removed. Safe to call repeatedly
 * (app foreground, reconnect, after finish).
 */
export async function processUploads(userId: string): Promise<number> {
  if (running) return 0;
  running = true;
  let completed = 0;
  try {
    for (const up of pendingUploads(userId)) {
      if (up.next_attempt_at > Date.now()) continue;
      const startedAt = Date.now();
      try {
        const session = getSession(up.session_id)!;
        const samples = samplesFor(up.session_id);
        const events = eventsFor(up.session_id);
        const chunkCount = Math.max(1, Math.ceil(samples.length / CHUNK));
        recordingDb().runSync("update uploads set state = 'uploading', chunk_count = ?, updated_at = ? where session_id = ?", [chunkCount, Date.now(), up.session_id]);
        let bytes = 0;
        for (let idx = up.next_chunk; idx < chunkCount && samples.length; idx++) {
          const part = samples.slice(idx * CHUNK, (idx + 1) * CHUNK);
          const data = serializeSamples(part);
          bytes += data.length;
          await callFunction('activity-upload/chunk', {
            activityId: up.session_id,
            idx,
            seqFrom: part[0]!.seq,
            seqTo: part[part.length - 1]!.seq,
            digest: await sha256(data),
            data,
            startedAt: session.started_at
          }, { timeoutMs: 60_000 });
          recordingDb().runSync('update uploads set next_chunk = ?, updated_at = ? where session_id = ?', [idx + 1, Date.now(), up.session_id]);
        }
        const ticket = session.ticket ? JSON.parse(session.ticket) : null;
        const receipt = await callFunction<ReceiptResponse>('activity-upload/finalize', {
          activityId: up.session_id,
          startedAt: session.started_at,
          endedAt: session.ended_at,
          events,
          sampleCount: samples.length,
          chunkCount: samples.length ? chunkCount : 0,
          evidenceDigest: await sha256(serializeSamples(samples)),
          device: { platform: Platform.OS === 'ios' ? 'ios' : 'android', osVersion: String(Platform.Version), model: Device.modelName ?? null, appVersion: Constants.expoConfig?.version ?? '0.0.0' },
          ticket
        });
        recordingDb().withTransactionSync(() => {
          recordingDb().runSync("update uploads set state = 'received', receipt = ?, last_error = null, updated_at = ? where session_id = ?", [JSON.stringify(receipt), Date.now(), up.session_id]);
          // Evidence is now stored server-side; remove the raw local copy.
          recordingDb().runSync('delete from samples where session_id = ?', [up.session_id]);
        });
        completed++;
        const secs = (Date.now() - startedAt) / 1000;
        track('upload_completed', {
          activity_id: up.session_id.replace(/-/g, '').slice(0, 32),
          size_bucket: bytesBucket(bytes),
          retry_count: up.attempts,
          elapsed_bucket: secs < 5 ? '<5s' : secs < 30 ? '5-30s' : secs < 300 ? '30-300s' : '>300s'
        });
      } catch (e) {
        const permanent = e instanceof ApiError && ['activity_not_found', 'duplicate_activity', 'evidence_digest_mismatch', 'forbidden'].includes(e.code);
        recordingDb().runSync('update uploads set state = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? where session_id = ?', [
          permanent ? 'failed_permanent' : 'pending',
          e instanceof Error ? e.message.slice(0, 200) : 'error',
          Date.now() + backoffMs(up.attempts + 1),
          Date.now(),
          up.session_id
        ]);
        log.warn(`upload deferred: ${e instanceof Error ? e.message : 'error'}`);
        if (e instanceof ApiError && e.code === 'network') break;
      }
    }
  } finally {
    running = false;
  }
  return completed;
}
