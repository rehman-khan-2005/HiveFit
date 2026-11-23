// Display preferences — what the user wants to see, not what we computed.
//
// Stored server-side rather than on the device because the same account is
// used from a laptop and a phone, and a choice that only applies on one of
// them is not a preference, it is a setting you have to make twice.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/error.js';
import { getPreferences, savePreferences } from '../preferences/store.js';
import { preferenceSchema } from '../preferences/options.js';

export const preferenceRouter = Router();
preferenceRouter.use(requireAuth);

/**
 * GET /api/preferences
 *
 * The user's choices, and the options they were chosen from. Both, in one
 * response: the client builds its dropdown from `schema`, so adding a choice
 * server-side reaches every client without a release.
 */
preferenceRouter.get('/', asyncRoute(async (req, res) => {
  res.json({
    preferences: await getPreferences(req.user.id),
    schema: preferenceSchema(),
  });
}));

/**
 * PATCH /api/preferences
 *
 * Partial: send only what changed. Unknown keys and values this server does
 * not offer are reported in `ignored` rather than failing the request, so a
 * client built against an older option list still saves what it understands.
 */
preferenceRouter.patch('/', asyncRoute(async (req, res) => {
  const { preferences, ignored } = await savePreferences(req.user.id, req.body ?? {});
  res.json({ preferences, ignored, schema: preferenceSchema() });
}));
