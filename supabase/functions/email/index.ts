import { unsubscribe } from '../_shared/api/email.ts';
import { serve } from '../_shared/deno.ts';
import { HttpError, json, readJson, requireMethod } from '../_shared/http.ts';

// POST /email/unsubscribe?t=<token>&c=<category>
//   - one-click unsubscribe from mail apps (RFC 8058: form body "List-Unsubscribe=One-Click"), or
//   - the confirmation button on the web page /unsubscribe (JSON body {token, category}).
// GET never changes anything, so link scanners cannot unsubscribe people.
serve('email', async (req, rt) => {
  const url = new URL(req.url);
  if (!url.pathname.endsWith('/unsubscribe')) throw new HttpError(404, 'not_found');
  requireMethod(req, 'POST');
  let token = url.searchParams.get('t');
  let category = url.searchParams.get('c');
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const { body } = await readJson<{ token?: string; category?: string }>(req, 2_000);
    token = body.token ?? token;
    category = body.category ?? category;
  }
  if (!(await unsubscribe(rt.sql, token, category))) throw new HttpError(400, 'invalid_link');
  return json({ ok: true, category });
}, { browser: true });
