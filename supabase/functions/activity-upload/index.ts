import { finalizeActivity, storeChunk, type ChunkRequest, type FinalizeRequest } from '../_shared/api/upload.ts';
import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { HttpError, json, readJson, requireMethod } from '../_shared/http.ts';

// POST /activity-upload/chunk    — store one immutable evidence chunk (idempotent)
// POST /activity-upload/finalize — verify the complete sequence and return a durable receipt
serve('activity-upload', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  const action = new URL(req.url).pathname.split('/').pop();
  if (action === 'chunk') {
    const { body } = await readJson<ChunkRequest>(req, 2_500_000);
    return json(await storeChunk(rt.sql, rt.blobs, userId, body));
  }
  if (action === 'finalize') {
    const { body } = await readJson<FinalizeRequest>(req, 300_000);
    return json(await finalizeActivity(rt.sql, rt.blobs, rt.env, userId, body));
  }
  throw new HttpError(404, 'not_found');
}, { browser: true });
