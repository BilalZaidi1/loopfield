import { BUCKETS } from '../_shared/blobs.ts';
import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { HttpError, json, readJson, requireMethod } from '../_shared/http.ts';

// POST /account/export-url {exportId} — short-lived download link for the caller's own ready export.
serve('account', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  const { body } = await readJson<{ exportId: string }>(req, 2_000);
  const [row] = await rt.sql`select storage_path from public.data_exports where id = ${body.exportId} and user_id = ${userId} and status = 'ready' and expires_at > now()`;
  if (!row) throw new HttpError(404, 'export_not_ready');
  return json({ url: await rt.blobs.signedUrl(BUCKETS.exports, row.storage_path, 300), expiresInSeconds: 300 });
});
