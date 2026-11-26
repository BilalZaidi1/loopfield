import { parseSnapRequest, snapLeg } from '../_shared/api/routeSnap.ts';
import { requireUser } from '../_shared/clients.ts';
import { serve } from '../_shared/deno.ts';
import { json, readJson, requireMethod } from '../_shared/http.ts';

// POST /route-snap {from: {lat, lng}, to: {lat, lng}} -> {snapped: true, path, distance_m} or {snapped: false, reason}.
serve('route-snap', async (req, rt) => {
  requireMethod(req, 'POST');
  const { userId } = await requireUser(req, rt.env);
  const { body } = await readJson<unknown>(req, 2_000);
  return json(await snapLeg(rt.sql, rt.env.MAPBOX_DIRECTIONS_TOKEN, userId, parseSnapRequest(body)));
}, { browser: true });
