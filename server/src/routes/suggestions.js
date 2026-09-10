// Process 3.0 — AI Recommendations (Select-a-Bullet).

import { Router } from 'express';
import { query, execute } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { suggestForBullet } from '../ai/suggest.js';
import { getProvider } from '../ai/provider.js';
import { intParam, optionalString } from '../utils/validate.js';

export const suggestionRouter = Router();
suggestionRouter.use(requireAuth);

/** Confirm the analysis belongs to the signed-in user. */
async function ownedAnalysis(analysisId, userId) {
  const rows = await query(
    `SELECT a.id, j.title AS job_title
       FROM ats_analyses a
       JOIN resumes r ON r.id = a.resume_id
       JOIN job_postings j ON j.id = a.job_posting_id
      WHERE a.id = ? AND r.user_id = ?`,
    [analysisId, userId]
  );
  if (rows.length === 0) throw notFound('Analysis not found');
  return rows[0];
}

/**
 * POST /api/suggestions
 * body: { analysisId, bullet, targetTerms?: string[], userEvidence?: string }
 *
 * Returns either a rewritten bullet or, when the requested terms are not
 * evidenced by the bullet, a question. It never returns invented experience.
 */
suggestionRouter.post('/', asyncRoute(async (req, res) => {
  const analysisId = intParam(req.body?.analysisId, 'analysisId');
  const bullet = optionalString(req.body?.bullet, 'bullet', 2000);
  if (!bullet) throw badRequest('bullet is required');

  const targetTerms = Array.isArray(req.body?.targetTerms)
    ? req.body.targetTerms.map(String).slice(0, 15)
    : [];
  const userEvidence = optionalString(req.body?.userEvidence, 'userEvidence', 2000);

  const analysis = await ownedAnalysis(analysisId, req.user.id);

  const result = await suggestForBullet({
    bullet,
    targetTerms,
    jobTitle: analysis.job_title,
    userEvidence,
    provider: getProvider(),
  });

  const inserted = await execute(
    `INSERT INTO suggestions (ats_analysis_id, original_text, suggested_text, status, prompt_question)
     VALUES (?, ?, ?, ?, ?)`,
    [analysisId, result.original, result.suggested, result.status, result.question]
  );

  res.status(201).json({ suggestion: { id: inserted.insertId, ...result } });
}));

/**
 * PATCH /api/suggestions/:id  body: { accepted: boolean }
 *
 * The user decides. Nothing is applied to a resume automatically — this only
 * records the decision, which is the Select-a-Bullet contract from the report.
 */
suggestionRouter.patch('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  if (typeof req.body?.accepted !== 'boolean') {
    throw badRequest('accepted must be true or false');
  }

  const rows = await query(
    `SELECT s.id, s.status
       FROM suggestions s
       JOIN ats_analyses a ON a.id = s.ats_analysis_id
       JOIN resumes r      ON r.id = a.resume_id
      WHERE s.id = ? AND r.user_id = ?`,
    [id, req.user.id]
  );
  if (rows.length === 0) throw notFound('Suggestion not found');
  if (rows[0].status === 'needs_input') {
    throw badRequest('This suggestion is still waiting on your answer, so there is nothing to accept yet');
  }

  const accepted = req.body.accepted;
  await execute(
    'UPDATE suggestions SET accepted = ?, status = ? WHERE id = ?',
    [accepted, accepted ? 'accepted' : 'discarded', id]
  );

  res.json({ suggestion: { id, accepted, status: accepted ? 'accepted' : 'discarded' } });
}));

suggestionRouter.get('/analysis/:analysisId', asyncRoute(async (req, res) => {
  const analysisId = intParam(req.params.analysisId, 'analysisId');
  await ownedAnalysis(analysisId, req.user.id);
  const suggestions = await query(
    'SELECT id, original_text, suggested_text, status, prompt_question, accepted, created_at FROM suggestions WHERE ats_analysis_id = ? ORDER BY created_at',
    [analysisId]
  );
  res.json({ suggestions });
}));
