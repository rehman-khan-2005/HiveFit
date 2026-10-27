// DFD 2.1 — Document Parsing.
//
// Real resumes are structured documents, not prose, and the dominant CS-student
// format (the "Jake's Resume" LaTeX template and its descendants) has a shape
// worth parsing properly:
//
//   Name
//   Contact | Phone | Email | LinkedIn
//   Education                                    <- small-caps section header
//   Institution                     Location     <- right-aligned column
//   Degree; GPA                     Date
//   Technical Skills
//   Languages: Python, Java, ...                 <- labelled skill lines
//   Projects
//   Project Name | Tech, Stack      Date         <- entry header
//   • accomplishment bullet that wraps onto
//     a second line
//
// PDF extraction collapses the right-aligned column onto the title line, so
// "Institution   Location" arrives as one string. Treating every long line as a
// rewritable bullet — which a naive parser does — offers the user their own
// phone number and their "Languages:" list as things to improve.
//
// Parsing the structure also feeds the honest-AI check: a skill named in the
// Skills section or in a project's tech stack is evidence the user really has
// it, even when the specific bullet does not repeat the word.

const BULLET_GLYPHS = /^[\s]*[•▪◦‣·*\-–—]\s+/;

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const DATE_TOKEN = `(?:${MONTH}\\s+\\d{4}|Present|Current|\\d{4})`;
// A trailing date, optionally a range: "May 2026", "June 2026 - Present", "2024–2025".
const TRAILING_DATE = new RegExp(`${DATE_TOKEN}(?:\\s*[-–—]\\s*${DATE_TOKEN})?\\s*$`, 'i');

// Section headers, mapped to the kind of content they introduce.
const SECTION_KINDS = [
  [/^education$/i, 'education'],
  [/^(technical\s+)?skills?$/i, 'skills'],
  [/^(technologies|technical\s+proficiencies)$/i, 'skills'],
  [/^projects?$/i, 'projects'],
  [/^(experience|work\s+experience|employment|professional\s+experience)$/i, 'experience'],
  [/^(leadership|activities|leadership\s+(&|and)\s+activities)$/i, 'experience'],
  [/^(certifications?|awards?|honors?|publications?|interests?)$/i, 'other'],
];

// "Languages: Python, Java" — a labelled list of skills, not an accomplishment.
const SKILL_LINE = /^(languages?|frameworks?|developer\s+tools?|tools?|libraries|databases?|technologies|platforms?|skills?|certifications?)\s*:\s*(.+)$/i;

// "Relevant Coursework: ...", "Academic Acknowledgements: ..." — education detail.
const LABELLED_DETAIL = /^([A-Z][A-Za-z\s&]{2,40})\s*:\s*(.+)$/;

// Coursework is a legitimate (if weak) claim to knowing a subject. Awards and
// honours are not skills at all — counting "National Honor Society" as evidence
// would let an unrelated posting term match an award name.
const COURSEWORK_LABEL = /coursework|courses/i;

// "New York, NY", "Boston, MA", "Remote", "Online" — a place, not a technology.
// Misreading a location as a tech stack would feed the honest-AI check false
// evidence, letting it treat "New York" as a demonstrated skill.
const LOCATION = /^([A-Z][A-Za-z .'-]+,\s*[A-Z]{2}|Remote|Online|Hybrid)$/;

const CONTACT_MARKERS = /(@|\bhttps?:\/\/|linkedin\.com|github\.com|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)/i;

function detectSection(line) {
  const trimmed = line.trim();
  if (trimmed.length > 40 || /[.•]/.test(trimmed)) return null;
  for (const [pattern, kind] of SECTION_KINDS) {
    if (pattern.test(trimmed)) return { title: trimmed, kind };
  }
  // An ALL-CAPS short line is a section header even if we don't know the word.
  if (/^[A-Z][A-Z\s&/]{2,30}$/.test(trimmed) && trimmed.split(/\s+/).length <= 4) {
    return { title: trimmed, kind: 'other' };
  }
  return null;
}

/**
 * Does this line introduce a new entry (a job, a project, a degree)?
 * The reliable signals are a pipe-delimited header, or a trailing date.
 */
function looksLikeEntryHeader(line) {
  const t = line.trim();
  if (BULLET_GLYPHS.test(line)) return false;
  if (t.length > 160) return false;
  if (t.includes(' | ')) return true;
  if (TRAILING_DATE.test(t) && t.split(/\s+/).length <= 18) return true;
  return false;
}

/** Split "Title | Tech, Stack   May 2026" into its parts. */
function parseEntryHeader(line) {
  let rest = line.trim();
  let dates = null;

  const dateMatch = rest.match(TRAILING_DATE);
  if (dateMatch) {
    dates = dateMatch[0].trim();
    rest = rest.slice(0, dateMatch.index).trim();
  }

  const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
  const title = parts[0] ?? rest;

  // The middle segment is a tech list in a Projects section ("React, Node.js")
  // and an employer in an Experience section ("Con Edison").
  const middle = parts.slice(1);
  const tech = [];
  const orgParts = [];
  let location = null;

  for (const part of middle) {
    if (LOCATION.test(part)) {
      location = part;
    } else if (part.includes(',')) {
      // A comma-separated list in this position is a tech stack.
      tech.push(...part.split(',').map((t) => t.trim()).filter(Boolean));
    } else {
      orgParts.push(part);
    }
  }

  // A trailing "City, ST" often rides along on the title when the template
  // right-aligns it and PDF extraction collapses the column.
  const titleLocation = title.match(/\s{2,}([A-Z][A-Za-z .'-]+,\s*[A-Z]{2})\s*$/);

  return {
    raw: line.trim(),
    title: titleLocation ? title.slice(0, titleLocation.index).trim() : title,
    org: orgParts.join(' · ') || null,
    location: location ?? (titleLocation ? titleLocation[1] : null),
    tech,
    dates,
  };
}

/**
 * Parse a resume into sections, entries, skills, and accomplishment bullets.
 * @returns {{name: string|null, contact: string|null, sections: Array, skills: object, bullets: Array}}
 */
export function parseResume(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);

  const result = {
    name: null,
    contact: null,
    sections: [],
    skills: { groups: {}, all: [] },
    coursework: [],
    awards: [],
    bullets: [],
  };

  let section = null;   // current section
  let entry = null;     // current entry within the section
  let pending = null;   // bullet being accumulated across wrapped lines
  let detail = null;    // last labelled education detail, for wrapped lines

  const flushBullet = () => {
    if (!pending) return;
    const text = pending.replace(/\s+/g, ' ').trim();
    if (text.length >= 20) {
      result.bullets.push({
        text,
        section: section?.title ?? null,
        sectionKind: section?.kind ?? null,
        entryTitle: entry?.title ?? null,
        entryOrg: entry?.org ?? null,
        entryTech: entry?.tech ?? [],
        entryLocation: entry?.location ?? null,
        entryDates: entry?.dates ?? null,
      });
    }
    pending = null;
  };

  const startEntry = (line) => {
    flushBullet();
    entry = parseEntryHeader(line);
    if (section) section.entries.push(entry);
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Header block: the first non-empty lines before any section header.
    if (!section && index < 4) {
      if (result.name === null && !CONTACT_MARKERS.test(trimmed) && !detectSection(trimmed)) {
        result.name = trimmed;
        return;
      }
      if (CONTACT_MARKERS.test(trimmed)) {
        result.contact = trimmed;
        return;
      }
    }

    const found = detectSection(trimmed);
    if (found) {
      detail = null;
      flushBullet();
      entry = null;
      section = { title: found.title, kind: found.kind, entries: [] };
      result.sections.push(section);
      return;
    }

    // Labelled skill lines are keyword sources, never rewritable bullets.
    const skillMatch = trimmed.match(SKILL_LINE);
    if (skillMatch && (section?.kind === 'skills' || section === null)) {
      flushBullet();
      const label = skillMatch[1].replace(/\s+/g, ' ').trim();
      const items = skillMatch[2]
        .split(/[,;]/)
        .map((s) => s.trim().replace(/[.,;]+$/, ''))
        .filter(Boolean);
      result.skills.groups[label] = items;
      result.skills.all.push(...items);
      return;
    }

    if (BULLET_GLYPHS.test(line)) {
      detail = null;
      flushBullet();
      pending = trimmed.replace(BULLET_GLYPHS, '').trim();
      return;
    }

    if (looksLikeEntryHeader(trimmed)) {
      detail = null;
      startEntry(trimmed);
      return;
    }

    // Education detail lines. Coursework counts as (weak) evidence; awards and
    // acknowledgements are recorded but deliberately kept out of the evidence set.
    if (section?.kind === 'education' && LABELLED_DETAIL.test(trimmed)) {
      flushBullet();
      const [, rawLabel, value] = trimmed.match(LABELLED_DETAIL);
      const label = rawLabel.trim();
      const items = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);

      if (COURSEWORK_LABEL.test(label)) {
        result.coursework.push(...items);
        detail = { target: result.coursework };
      } else {
        result.awards.push(...items);
        detail = { target: result.awards };
      }
      return;
    }

    // Anything else continues the bullet above it, which is how a wrapped line
    // gets rejoined. Outside a bullet, in a content section, a bare line is
    // still prose worth keeping.
    // A wrapped list continues only if it still looks like a list: it carries a
    // separator, or resumes mid-phrase. Without this the next education entry
    // ("Google  Online") gets swallowed into the coursework above it.
    const continuesList = /[,;]/.test(trimmed) || /^[a-z&]/.test(trimmed);

    if (detail && continuesList) {
      // The first item completes the truncated last entry
      // ("Computer" + "Organization & Architecture").
      const items = trimmed.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
      if (items.length > 0 && detail.target.length > 0) {
        detail.target[detail.target.length - 1] += ` ${items.shift()}`;
      }
      detail.target.push(...items);
      return;
    }
    detail = null;

    if (pending) {
      pending = `${pending} ${trimmed}`;
    } else if (section && ['projects', 'experience'].includes(section.kind)) {
      pending = trimmed;
    }
  });

  flushBullet();

  // De-duplicate skills while preserving order.
  result.skills.all = [...new Set(result.skills.all)];

  return result;
}

/**
 * Accomplishment bullets only — what Select-a-Bullet offers the user.
 * Keeps the original string[] signature used across the app.
 */
export function extractBullets(text) {
  return parseResume(text)
    .bullets
    .map((b) => b.text)
    .filter((t) => t.length >= 25 && t.length <= 600 && /\s/.test(t));
}

/** Bullets with their section and entry context, for the suggestion engine. */
export function extractBulletsWithContext(text) {
  return parseResume(text).bullets.filter(
    (b) => b.text.length >= 25 && b.text.length <= 600
  );
}

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

/** Heuristic check that an uploaded document actually looks like a resume. */
export function looksLikeResume(text) {
  const t = String(text ?? '').toLowerCase();
  const markers = ['experience', 'education', 'skills', 'project', 'work', 'university', 'employment'];
  const hits = markers.filter((m) => t.includes(m)).length;
  return { ok: hits >= 2, markersFound: hits };
}
