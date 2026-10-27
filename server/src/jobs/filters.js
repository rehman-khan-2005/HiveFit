// Narrowing a job pool before it reaches the user — or the model.
//
// Two problems at once. The user-facing one is information overload: fifty
// postings of mixed relevance is a wall nobody reads. The quieter one is that
// an LLM fed that wall spends its budget on postings the user was never going
// to apply to, so filtering is a cost control as much as a UI feature.
//
// Skill filtering runs through the same preprocessing as the scoring, which
// matters more than it sounds: a naive substring match on "react" also hits
// "reactive" and "reaction", and misses "ReactJS". Stemming both sides is what
// makes "node.js", "Node", and "NodeJS" one filter rather than three.

import { preprocess } from '../nlp/tokenize.js';
import { stemSet, termStems, coveredBy } from '../nlp/evidence.js';
import { isFilterableSkill, categorize, CATEGORY_LABELS } from '../nlp/categories.js';

/**
 * Keep postings that require the given skills.
 *
 * @param {object[]} jobs
 * @param {string[]} skills    terms the posting must mention
 * @param {'any'|'all'} mode   'all' is the strict reading of "must have"
 */
export function filterBySkills(jobs, skills, mode = 'any') {
  const wanted = skills.map((skill) => termStems(skill)).filter((tokens) => tokens.length > 0);
  if (wanted.length === 0) return jobs;

  return jobs.filter((job) => {
    // Title as well as description: a posting naming the skill in its title
    // weights it heavily, and some boards truncate descriptions.
    const present = stemSet(`${job.title ?? ''} ${job.description ?? ''}`);
    const hits = wanted.filter((tokens) => coveredBy(tokens, present));
    return mode === 'all' ? hits.length === wanted.length : hits.length > 0;
  });
}

/**
 * Keep postings whose location matches, with remote handled as its own case.
 *
 * Providers write location a dozen ways — "Remote", "Remote - US", "New York,
 * NY", "Greater New York Area" — so this is deliberately a loose contains
 * match on normalized text, plus one special case: asking for remote should
 * find remote work however the board chose to phrase it, and should not be
 * defeated by a posting that says "New York (Remote)".
 */
export function filterByLocation(jobs, location) {
  const needle = String(location ?? '').trim().toLowerCase();
  if (!needle) return jobs;

  const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const REMOTE = /\b(remote|work from home|wfh|telecommute|distributed)\b/;

  if (REMOTE.test(needle)) {
    return jobs.filter((job) => REMOTE.test(normalize(job.location)) || REMOTE.test(normalize(job.title)));
  }

  const target = normalize(needle);
  return jobs.filter((job) => normalize(job.location).includes(target));
}

// A term in nearly every posting cannot narrow anything. Filtering by a skill
// 76 of 80 postings mention returns 76 postings, which is not a filter.
const UBIQUITY_CEILING = 0.6;

/**
 * The skills a pool actually asks for, most-demanded first.
 *
 * Offered as filter options so the user picks from what is really there
 * instead of guessing into an empty list. Two restrictions earn their place:
 * only technology-naming categories, and nothing so ubiquitous in this pool
 * that selecting it would change nothing.
 */
export function skillsInPool(jobs, { limit = 24 } = {}) {
  const counts = new Map();

  for (const job of jobs) {
    const { tokens, surface } = preprocess(`${job.title ?? ''} ${job.description ?? ''}`);
    // Per posting, not per mention: a posting repeating "Python" eight times
    // is still one job asking for Python.
    for (const stem of new Set(tokens)) {
      const entry = counts.get(stem) ?? { stem, term: surface.get(stem) ?? stem, count: 0 };
      entry.count += 1;
      counts.set(stem, entry);
    }
  }

  const total = jobs.length || 1;

  return [...counts.values()]
    .filter((entry) => isFilterableSkill(entry.stem))
    .map((entry) => ({
      ...entry,
      category: categorize(entry.stem),
      categoryLabel: CATEGORY_LABELS[categorize(entry.stem)],
      // "asked for by 14 of 50 postings" is the number that tells a user
      // whether a filter is worth applying.
      postings: entry.count,
      share: entry.count / total,
    }))
    .filter((entry) => entry.share <= UBIQUITY_CEILING)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}
