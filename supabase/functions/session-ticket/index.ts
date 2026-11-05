import { issueTicket, type TicketRequest } from '../_shared/api/sessions.ts';
import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { json, readJson, requireMethod } from '../_shared/http.ts';

// POST /session-ticket {mode, competitionId, courseVersionId?} -> signed competitive-session ticket.
serve('session-ticket', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  const { body } = await readJson<TicketRequest>(req, 10_000);
  return json(await issueTicket(rt.sql, rt.env, userId, body));
}, { browser: true });
