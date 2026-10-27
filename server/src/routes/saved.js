// Process 5.0 — Application Tracker.

import { Router } from 'express';
import { query, execute } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { intParam, optionalString } from '../utils/validate.js';

// The five states the report specifies for the application lifecycle.
const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];

export const savedRouter = Router();
savedRouter.use(requireAuth);

savedRouter.post('/', asyncRoute(async (req, res) => {
  const jobPostingId = intParam(req.body?.jobPostingId, 'jobPostingId');
  const status = req.body?.status ?? 'Saved';
  if (!STATUSES.includes(status)) {
    throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);
  }
  const notes = optionalString(req.body?.notes, 'notes', 2000);

  const job = await query('SELECT id FROM job_postings WHERE id = ?', [jobPostingId]);
  if (job.length === 0) throw notFound('Job posting not found');

  // Saving an already-saved job updates it rather than failing on the unique key.
  const result = await execute(
    `INSERT INTO saved_jobs (user_id, job_posting_id, status, notes)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = VALUES(status), notes = VALUES(notes)`,
    [req.user.id, jobPostingId, status, notes]
  );

  res.status(201).json({ savedJob: { id: result.insertId, jobPostingId, status, notes } });
}));

savedRouter.get('/', asyncRoute(async (req, res) => {
  const filter = req.query.status;
  if (filter && !STATUSES.includes(filter)) {
    throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);
  }

  const rows = await query(
    `SELECT s.id, s.status, s.notes, s.created_at, s.updated_at,
            j.id AS job_posting_id, j.title, j.company, j.location, j.url,
            j.salary_min, j.salary_max,
            -- Deliberately not filtered out. A job the user is tracking that
            -- has since been pulled is information they want, not a row to
            -- silently drop out from under an application in progress.
            j.expired_at, j.closes_at
       FROM saved_jobs s
       JOIN job_postings j ON j.id = s.job_posting_id
      WHERE s.user_id = ? ${filter ? 'AND s.status = ?' : ''}
      ORDER BY s.updated_at DESC`,
    filter ? [req.user.id, filter] : [req.user.id]
  );

  // Counts per state drive the tracker's column headers.
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of rows) counts[row.status] += 1;

  res.json({ savedJobs: rows, counts, statuses: STATUSES });
}));

savedRouter.patch('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const updates = [];
  const params = [];

  if (req.body?.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) {
      throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);
    }
    updates.push('status = ?');
    params.push(req.body.status);
  }
  if (req.body?.notes !== undefined) {
    updates.push('notes = ?');
    params.push(optionalString(req.body.notes, 'notes', 2000));
  }
  if (updates.length === 0) throw badRequest('Provide status, notes, or both');

  params.push(id, req.user.id);
  const result = await execute(
    `UPDATE saved_jobs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params
  );
  if (result.affectedRows === 0) throw notFound('Saved job not found');

  const rows = await query('SELECT id, status, notes, updated_at FROM saved_jobs WHERE id = ?', [id]);
  res.json({ savedJob: rows[0] });
}));

savedRouter.delete('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const result = await execute('DELETE FROM saved_jobs WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (result.affectedRows === 0) throw notFound('Saved job not found');
  res.status(204).end();
}));
