// Process 2.0 — Resume Analysis, and the multi-job comparison built on it.

import { Router } from 'express';
import { query, execute, transaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { analyzeResume } from '../nlp/analyze.js';
import { bulletsWithTargets } from '../nlp/bulletTargets.js';
import { backgroundCorpus } from '../jobs/index.js';
import { intParam } from '../utils/validate.js';
import { MAX_POSTINGS_PER_ANALYSIS } from '../config/limits.js';

export const analysisRouter = Router();
analysisRouter.use(requireAuth);

/** mysql2 returns JSON columns already parsed; older rows may hold a string. */
function parseJson(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Insert a posting supplied inline, or reuse one already stored. */
async function resolveJobPostings(conn, { jobPostingIds = [], postings = [] }) {
  const resolved = [];

  if (jobPostingIds.length > 0) {
    const placeholders = jobPostingIds.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT id, title, company, url, description FROM job_postings WHERE id IN (${placeholders})`,
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
      url: posting.url ?? null,
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
  if (jobPostingIds.length + postings.length > MAX_POSTINGS_PER_ANALYSIS) {
    throw badRequest(`Compare at most ${MAX_POSTINGS_PER_ANALYSIS} postings at once`);
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
        `INSERT INTO ats_analyses
           (resume_id, job_posting_id, score, retrieval, similarity,
            category_scores, keyword_gap, underhighlighted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resume.id,
          result.jobId,
          result.score,
          result.retrieval ?? null,
          result.similarity ?? null,
          JSON.stringify(result.categories),
          JSON.stringify(result.prioritizedGap),
          JSON.stringify(result.underhighlighted),
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
            j.title AS job_title, j.company, j.url AS job_url,
            j.expired_at AS job_expired_at, j.description AS job_description
       FROM ats_analyses a
       JOIN resumes r      ON r.id = a.resume_id
       JOIN job_postings j ON j.id = a.job_posting_id
      WHERE a.id = ? AND r.user_id = ?`,
    [id, req.user.id]
  );
  if (rows.length === 0) throw notFound('Analysis not found');

  const row = rows[0];

  const keywordGap = parseJson(row.keyword_gap) ?? [];
  const underhighlighted = parseJson(row.underhighlighted) ?? [];

  // Per-bullet targets are computed here rather than persisted: they depend on
  // both the resume and the posting, and recomputing from two columns we
  // already loaded is cheaper than storing an n-bullets x m-terms matrix per
  // analysis and keeping it in step with the parser.
  const bullets = bulletsWithTargets({
    resumeText: row.raw_text,
    jobDescription: row.job_description,
    candidates: [...keywordGap, ...underhighlighted],
  });

  const suggestions = await query(
    'SELECT id, original_text, suggested_text, status, prompt_question, accepted, created_at FROM suggestions WHERE ats_analysis_id = ? ORDER BY created_at',
    [id]
  );

  res.json({
    analysis: {
      id: row.id,
      score: row.score,
      // Reported next to the headline so the scoring can be checked rather
      // than believed. Null for analyses stored before these columns existed.
      retrieval: row.retrieval,
      similarity: row.similarity,
      // mysql2 returns JSON columns already parsed; guard for string form.
      categories: parseJson(row.category_scores) ?? [],
      keywordGap,
      // Null for analyses stored before this column existed.
      underhighlighted,
      // Bullets carry their entry context and their own ranked target terms,
      // so Select-a-Bullet can show why each bullet differs.
      bullets,
      createdAt: row.created_at,
      resume: { id: row.resume_id, title: row.resume_title },
      job: {
        id: row.job_posting_id,
        title: row.job_title,
        company: row.company,
        // The point of a high score is applying to the thing, so the link has
        // to travel with the analysis rather than making the user go back to
        // the search to find it again.
        url: row.job_url,
        expiredAt: row.job_expired_at,
      },
    },
    suggestions,
  });
}));
