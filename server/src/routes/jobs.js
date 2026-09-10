// Process 4.0 — Job Search.

import { Router } from 'express';
import { query, execute } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, notFound } from '../middleware/error.js';
import { searchJobs } from '../jobs/index.js';
import { intParam, optionalString } from '../utils/validate.js';

export const jobRouter = Router();
jobRouter.use(requireAuth);

/**
 * GET /api/jobs/search?query=&location=&limit=
 *
 * Results are persisted to job_postings so an analysis can reference them by
 * id, and so a saved job survives the search that found it.
 */
jobRouter.get('/search', asyncRoute(async (req, res) => {
  const search = optionalString(req.query.query, 'query', 200) ?? '';
  const location = optionalString(req.query.location, 'location', 200) ?? '';
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  const { provider, jobs } = await searchJobs({ query: search, location, limit });

  const persisted = [];
  for (const job of jobs) {
    // Upsert on (source, external_id); LAST_INSERT_ID() in the UPDATE branch
    // makes insertId correct for both new and existing rows.
    const result = await execute(
      `INSERT INTO job_postings
         (source, external_id, title, company, location, description, salary_min, salary_max, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id), title = VALUES(title), description = VALUES(description)`,
      [
        job.source, job.external_id, job.title, job.company ?? null,
        job.location ?? null, job.description, job.salary_min ?? null,
        job.salary_max ?? null, job.url ?? null,
      ]
    );
    persisted.push({ ...job, id: result.insertId });
  }

  res.json({ provider, count: persisted.length, jobs: persisted });
}));

jobRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const rows = await query('SELECT * FROM job_postings WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound('Job posting not found');
  res.json({ job: rows[0] });
}));
