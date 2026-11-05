const mockCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
const mockRunSync = jest.fn();
const mockDb = { runSync: mockRunSync, withTransactionSync: (fn: () => void) => fn() };
let mockFailWith: Error | null = null;

jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: jest.fn(async (_a: string, t: string) => `sha:${t.length}`) }));
jest.mock('expo-device', () => ({ modelName: 'Test' }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '0.1.0' } }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), callFunction: jest.fn() }));
const mockSamples = Array.from({ length: 1300 }, (_, i) => ({ seq: i, t: 1_700_000_000_000 + i * 1000, lat: 24.9 + i * 1e-5, lng: 67.05, acc: 5, alt: null, altAcc: null, spd: null, hdg: null, mocked: false, mono: null }));
jest.mock('@/recording/db', () => ({
  recordingDb: () => mockDb,
  pendingUploads: jest.fn(() => [{ session_id: 's1', state: 'pending', next_chunk: 0, chunk_count: null, attempts: 0, last_error: null, receipt: null, next_attempt_at: 0, summary: null, updated_at: 0, mode: 'territory' }]),
  getSession: jest.fn(() => ({ id: 's1', started_at: 1_700_000_000_000, ended_at: 1_700_001_300_000, ticket: null })),
  samplesFor: jest.fn(() => mockSamples),
  eventsFor: jest.fn(() => [])
}));

import { ApiError, callFunction } from '@/lib/api';
import { processUploads } from '@/recording/uploader';

describe('upload queue', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockRunSync.mockClear();
    mockFailWith = null;
    (callFunction as jest.Mock).mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (mockFailWith) throw mockFailWith;
      mockCalls.push({ path, body });
      return path.endsWith('finalize') ? { activityId: body.activityId, receivedAt: 'now', status: 'received', territoryClaimId: null, speedAttemptId: null, competitive: { territory: null, speed: null } } : { ok: true };
    });
  });

  it('uploads digest-verified chunks, finalizes, and removes local raw samples only after the receipt', async () => {
    const n = await processUploads('u1');
    expect(n).toBe(1);
    const chunks = mockCalls.filter((c) => c.path === 'activity-upload/chunk');
    expect(chunks.map((c) => [c.body.idx, c.body.seqFrom, c.body.seqTo])).toEqual([[0, 0, 599], [1, 600, 1199], [2, 1200, 1299]]);
    expect(chunks.every((c) => String(c.body.digest).startsWith('sha:'))).toBe(true);
    const fin = mockCalls.find((c) => c.path === 'activity-upload/finalize')!;
    expect(fin.body).toMatchObject({ activityId: 's1', sampleCount: 1300, chunkCount: 3 });
    const sql = mockRunSync.mock.calls.map((c) => String(c[0]));
    const receivedIdx = sql.findIndex((q) => q.includes("state = 'received'"));
    const deleteIdx = sql.findIndex((q) => q.startsWith('delete from samples'));
    expect(receivedIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(receivedIdx);
  });

  it('keeps evidence and schedules a retry when offline', async () => {
    mockFailWith = new ApiError('network', 'offline');
    const n = await processUploads('u1');
    expect(n).toBe(0);
    const sql = mockRunSync.mock.calls.map((c) => String(c[0]));
    expect(sql.some((q) => q.startsWith('delete from samples'))).toBe(false);
    const retry = mockRunSync.mock.calls.find((c) => String(c[0]).includes('attempts = attempts + 1'))!;
    expect(retry[1][0]).toBe('pending');
    expect(retry[1][2]).toBeGreaterThan(Date.now());
  });

  it('marks permanent server rejections without deleting the local copy', async () => {
    mockFailWith = new ApiError('evidence_digest_mismatch', 'bad digest');
    await processUploads('u1');
    const retry = mockRunSync.mock.calls.find((c) => String(c[0]).includes('attempts = attempts + 1'))!;
    expect(retry[1][0]).toBe('failed_permanent');
  });
});
