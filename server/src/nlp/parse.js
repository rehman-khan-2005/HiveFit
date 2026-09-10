// DFD 2.1 — Document Parsing.
//
// Extracts raw text from an uploaded resume (PDF or plain text) and splits it
// into individual bullet points, which is the unit the Select-a-Bullet feature
// operates on.

const BULLET_GLYPHS = /^[\s]*[•▪◦‣·*\-–—]\s+/;

/**
 * Extract text from an uploaded file buffer.
 * @param {Buffer} buffer
 * @param {string} fileName used to detect type when mimetype is unreliable
 */
export async function extractText(buffer, fileName = '') {
  const isPdf =
    fileName.toLowerCase().endsWith('.pdf') ||
    (buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF');

  if (!isPdf) return buffer.toString('utf8');

  // Imported lazily so the server still starts (and plain-text upload still
  // works) if the optional pdf-parse dependency is not installed.
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(buffer);
    return parsed.text;
  } catch (err) {
    throw Object.assign(
      new Error(
        'Could not read this PDF. Install the pdf-parse dependency, or paste the resume as plain text.'
      ),
      { status: 415, cause: err }
    );
  }
}

/**
 * Split resume text into candidate bullet points.
 *
 * Real resumes are inconsistent: some use glyph bullets, some use plain
 * newlines, and PDF extraction often wraps a single bullet across lines. The
 * approach is to treat a glyph as a hard boundary, then fall back to
 * sentence-like lines of a plausible length.
 */
export function extractBullets(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets = [];
  let current = null;

  for (const line of lines) {
    if (BULLET_GLYPHS.test(line)) {
      if (current) bullets.push(current);
      current = line.replace(BULLET_GLYPHS, '').trim();
      continue;
    }

    // Distinguish a section header ("EXPERIENCE", a job title) from the second
    // line of a bullet that PDF extraction wrapped. The reliable signal is the
    // first character: a wrapped continuation resumes mid-sentence and starts
    // lowercase, whereas a header is capitalized or set in full caps.
    const startsLowercase = /^[a-z]/.test(line);
    const isAllCaps = /[A-Z]/.test(line) && line === line.toUpperCase();
    const wordCount = line.split(/\s+/).length;
    const looksLikeHeader =
      !startsLowercase && (isAllCaps || (line.length < 45 && wordCount <= 5));

    if (current && !looksLikeHeader) {
      current = `${current} ${line}`.trim();     // continuation of a wrapped bullet
    } else {
      if (current) bullets.push(current);
      current = looksLikeHeader ? null : line;
    }
  }
  if (current) bullets.push(current);

  return bullets
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => b.length >= 25 && b.length <= 600)
    .filter((b) => /\s/.test(b));
}

/** Heuristic check that an uploaded document actually looks like a resume. */
export function looksLikeResume(text) {
  const t = String(text ?? '').toLowerCase();
  const markers = ['experience', 'education', 'skills', 'project', 'work', 'university', 'employment'];
  const hits = markers.filter((m) => t.includes(m)).length;
  return { ok: hits >= 2, markersFound: hits };
}
