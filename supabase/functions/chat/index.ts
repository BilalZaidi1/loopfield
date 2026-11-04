import { chatToken, reportMessage, startConversation, streamChatServer } from '../_shared/api/chat.ts';
import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { HttpError, json, readJson, requireMethod } from '../_shared/http.ts';
import { DM_CHANNEL_TYPE, streamServer } from '../_shared/stream.ts';

// POST /chat/token          — expiring Stream user token after verifying the Supabase session
// POST /chat/conversations  — server-side DM channel creation enforcing the recipient policy
// POST /chat/report         — report a received message with minimal restricted context
serve('chat', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  const chat = streamChatServer(rt.env, streamServer(rt.env), DM_CHANNEL_TYPE);
  const action = new URL(req.url).pathname.split('/').pop();
  if (action === 'token') return json(await chatToken(rt.sql, chat, userId));
  if (action === 'conversations') {
    const { body } = await readJson<{ targetId: string }>(req, 2_000);
    return json(await startConversation(rt.sql, chat, userId, body.targetId));
  }
  if (action === 'report') {
    const { body } = await readJson<{ channelId: string; messageId: string; category: string; details?: string }>(req, 5_000);
    return json(await reportMessage(rt.sql, chat, userId, body));
  }
  throw new HttpError(404, 'not_found');
});
