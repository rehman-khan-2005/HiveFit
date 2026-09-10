// Process 2.0 — Resume Analysis, and the multi-job comparison built on it.

import { Router } from 'express';
import { query, execute, transaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { analyzeResume } from '../nlp/analyze.js';
import { backgroundCorpus } from '../jobs/index.js';
import { intParam } from '../utils/validate.js';

export const analysisRouter = Router();
analysisRouter.use(requireAuth);

/** Insert a posting supplied inline, or reuse one already stored. */
async function resolveJobPostings(conn, { jobPostingIds = [], postings = [] }) {
  const resolved = [];

  if (jobPostingIds.length > 0) {
    const placeholders = jobPostingIds.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT id, title, company, description FROM job_postings WHERE id IN (${placeholders})`,
      jobPostingIds
    );
    const found = new Set(rows.map((r) => r.id));
    const missing = jobPostingIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw notFound(`Unknown job posting id(s): ${missing.join(', ')}`);
    resolved.push(...rows);
  }

  for (const posting of postings) {
    if (!posting?.description?.trim()) {
      throw badRequest('Each posting needs a description');
    }
    const [result] = await conn.execute(
      `INSERT INTO job_postings (source, external_id, title, company, location, description, url)
       VALUES ('manual', NULL, ?, ?, ?, ?, ?)`,
      [
        posting.title?.slice(0, 255) ?? 'Pasted job description',
        posting.company?.slice(0, 255) ?? null,
        posting.location?.slice(0, 255) ?? null,
        posting.description,
        posting.url?.slice(0, 1000) ?? null,
      ]
    );
    resolved.push({
      id: result.insertId,
      title: posting.title ?? 'Pasted job description',
      company: posting.company ?? null,
      description: posting.description,
    });
  }

  return resolved;
}

/**
 * POST /api/analyses
 * body: { resumeId, jobPostingIds?: number[], postings?: [{title, company, description}] }
 *
 * Scores one resume against one or many postings in a single request — the
 * multi-job comparison the report positions against one-to-one competitors.
 */
analysisRouter.post('/', asyncRoute(async (req, res) => {
  const resumeId = intParam(req.body?.resumeId, 'resumeId');
  const jobPostingIds = Array.isArray(req.body?.jobPostingIds) ? req.body.jobPostingIds.map(Number) : [];
  const postings = Array.isArray(req.body?.postings) ? req.body.postings : [];

  if (jobPostingIds.length === 0 && postings.length === 0) {
    throw badRequest('Provide jobPostingIds, postings, or both');
  }
  if (jobPostingIds.length + postings.length > 20) {
    throw badRequest('Compare at most 20 postings at once');
  }

  const resumeRows = await query(
    'SELECT id, title, raw_text FROM resumes WHERE id = ? AND user_id = ?',
    [resumeId, req.user.id]
  );
  if (resumeRows.length === 0) throw notFound('Resume not found');
  const resume = resumeRows[0];

  const payload = await transaction(async (conn) => {
    const jobs = await resolveJobPostings(conn, { jobPostingIds, postings });

    const analysis = analyzeResume({
      resumeText: resume.raw_text,
      jobs,
      backgroundCorpus: backgroundCorpus(),
    });

    // Persist one ATSAnalysis row per posting so history and Suggestions have
    // something to hang off.
    const stored = [];
    for (const result of analysis.results) {
      const [inserted] = await conn.execute(
        `INSERT INTO ats_analyses (resume_id, job_posting_id, score, category_scores, keyword_gap)
         VALUES (?, ?, ?, ?, ?)`,
        [
          resume.id,
          result.jobId,
          result.score,
          JSON.stringify(result.categories),
          JSON.stringify(result.prioritizedGap),
        ]
      );
      stored.push({ ...result, analysisId: inserted.insertId });
    }

    return { ...analysis, results: stored };
  });

  res.status(201).json({
    resume: { id: resume.id, title: resume.title, ...payload.resume },
    results: payload.results,
    comparison: payload.comparison,
  });
}));

/** Analysis history for the signed-in user. */
analysisRouter.get('/', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT a.id, a.score, a.created_at,
            r.id AS resume_id, r.title AS resume_title,
            j.id AS job_id, j.title AS job_title, j.company
       FROM ats_analyses a
       JOIN resumes r      ON r.id = a.resume_id
       JOIN job_postings j ON j.id = a.job_posting_id
      WHERE r.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [req.user.id]
  );
  res.json({ analyses: rows });
}));

analysisRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const rows = await query(
    `SELECT a.*, r.title AS resume_title, r.raw_text,
            j.title AS job_title, j.company, j.description AS job_description
       FROM ats_analyses a
       JOIN resumes r      ON r.id = a.resume_id
       JOIN job_postings j ON j.id = a.job_posting_id
      WHERE a.id = ? AND r.user_id = ?`,
    [id, req.user.id]
  );
  if (rows.length === 0) throw notFound('Analysis not found');

  const row = rows[0];
  const suggestions = await query(
    'SELECT id, original_text, suggested_text, status, prompt_question, accepted, created_at FROM suggestions WHERE ats_analysis_id = ? ORDER BY created_at',
    [id]
  );

  res.json({
    analysis: {
      id: row.id,
      score: row.score,
      // mysql2 returns JSON columns already parsed; guard for string form.
      categories: typeof row.category_scores === 'string' ? JSON.parse(row.category_scores) : row.category_scores,
      keywordGap: typeof row.keyword_gap === 'string' ? JSON.parse(row.keyword_gap) : row.keyword_gap,
      createdAt: row.created_at,
      resume: { id: row.resume_id, title: row.resume_title },
      job: { id: row.job_posting_id, title: row.job_title, company: row.company },
    },
    suggestions,
  });
}));
