import { describe, expect, it, vi } from 'vitest';
import { buildIntegrations } from '../../../supabase/functions/_shared/integrations.ts';
import { deleteGroupChannel, isStreamNotFound } from '../../../supabase/functions/_shared/stream.ts';
import { testEnv } from './helpers.ts';

// The real integrations, with only the network call to Stream replaced.
vi.mock('../../../supabase/functions/_shared/stream.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../supabase/functions/_shared/stream.ts')>()),
  deleteGroupChannel: vi.fn()
}));

/** Shaped like stream-chat's ErrorFromResponse: the message plus Stream's `code` and the HTTP `status`. */
const streamError = (code: number | null, status: number, message: string) =>
  Object.assign(new Error(code == null ? `StreamChat error HTTP code: ${status}` : `StreamChat error code ${code}: ${message}`), { code, status });

// What Stream answered on loopfield-dev when close_club deleted a chat the membership sync had already removed.
const missingChannel = () => streamError(16, 404, 'DeleteChannel failed with error: "Can\'t find channel with id loopfield_group:grp-e5ef7c5c-afeb-4cba-9d31-0ea1f04110db"');

describe('Stream "does not exist"', () => {
  it('is recognised by its code and status, whatever the wording', () => {
    expect(isStreamNotFound(missingChannel())).toBe(true);
    expect(isStreamNotFound(streamError(16, 404, 'GetChannelType failed with error: "channel type x does not exist"'))).toBe(true);
    expect(isStreamNotFound(new Error('StreamChat error code 16: DeleteChannel failed with error: "Can\'t find channel with id x"'))).toBe(true);
  });

  it('leaves real failures as failures, so jobs retry them', () => {
    expect(isStreamNotFound(streamError(9, 429, 'Too many requests'))).toBe(false);
    expect(isStreamNotFound(streamError(5, 401, 'api_key not valid'))).toBe(false);
    expect(isStreamNotFound(streamError(null, 500, ''))).toBe(false);
    expect(isStreamNotFound(new Error('fetch failed'))).toBe(false);
  });

  it("closing a group whose chat is already gone succeeds; other errors still fail the job", async () => {
    const chat = buildIntegrations({ ...testEnv(), STREAM_API_KEY: 'test-key', STREAM_API_SECRET: 'test-secret' }).chat!;
    vi.mocked(deleteGroupChannel).mockRejectedValueOnce(missingChannel());
    await expect(chat.deleteGroup('grp-e5ef7c5c-afeb-4cba-9d31-0ea1f04110db')).resolves.toBeUndefined();
    vi.mocked(deleteGroupChannel).mockRejectedValueOnce(streamError(9, 429, 'Too many requests'));
    await expect(chat.deleteGroup('grp-x')).rejects.toThrow('Too many requests');
  });
});
