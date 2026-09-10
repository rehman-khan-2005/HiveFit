// Resume storage and DFD 2.1 (Document Parsing).

import { Router } from 'express';
import multer from 'multer';
import { query, execute } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { extractText, extractBullets, looksLikeResume } from '../nlp/parse.js';
import { optionalString, intParam } from '../utils/validate.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|txt|md)$/i.test(file.originalname) ||
      ['application/pdf', 'text/plain', 'text/markdown'].includes(file.mimetype);
    cb(ok ? null : badRequest('Upload a PDF or plain-text resume'), ok);
  },
});

export const resumeRouter = Router();
resumeRouter.use(requireAuth);

/**
 * Accepts either a multipart file upload or a JSON body with `text`, so the
 * mobile client can paste a resume without a file picker.
 */
resumeRouter.post('/', upload.single('file'), asyncRoute(async (req, res) => {
  let rawText;
  let fileName = null;
  let fileType = 'txt';

  if (req.file) {
    rawText = await extractText(req.file.buffer, req.file.originalname);
    fileName = req.file.originalname;
    fileType = /\.pdf$/i.test(req.file.originalname) ? 'pdf' : 'txt';
  } else if (req.body?.text) {
    rawText = String(req.body.text);
  } else {
    throw badRequest('Provide a resume file (field "file") or a "text" field');
  }

  if (!rawText.trim()) throw badRequest('That file produced no readable text');

  const title = optionalString(req.body?.title, 'title', 200) ?? fileName ?? 'Untitled resume';
  const check = looksLikeResume(rawText);

  const result = await execute(
    'INSERT INTO resumes (user_id, title, file_name, file_type, raw_text) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, title, fileName, fileType, rawText]
  );

  res.status(201).json({
    resume: {
      id: result.insertId, title, fileName, fileType,
      characters: rawText.length,
      bullets: extractBullets(rawText),
    },
    // Advisory, never blocking: an unusual resume is still the user's to upload.
    warning: check.ok ? null : 'This does not look like a resume. Check you uploaded the right file.',
  });
}));

resumeRouter.get('/', asyncRoute(async (req, res) => {
  const rows = await query(
    `SELECT id, title, file_name, file_type, CHAR_LENGTH(raw_text) AS characters, created_at
       FROM resumes WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ resumes: rows });
}));

resumeRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const rows = await query(
    'SELECT id, title, file_name, file_type, raw_text, created_at FROM resumes WHERE id = ? AND user_id = ?',
    [id, req.user.id]
  );
  if (rows.length === 0) throw notFound('Resume not found');

  const resume = rows[0];
  res.json({ resume: { ...resume, bullets: extractBullets(resume.raw_text) } });
}));

resumeRouter.delete('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const result = await execute('DELETE FROM resumes WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (result.affectedRows === 0) throw notFound('Resume not found');
  res.status(204).end();
}));
