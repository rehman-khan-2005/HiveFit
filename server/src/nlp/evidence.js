// Where a resume evidences a term — one implementation, two readers.
//
// Process 3.0 asks this per bullet: "can this one sentence honestly claim
// Docker?" Process 2.0 asks it per resume: "the posting wants Docker, you
// have Docker, but no accomplishment shows you using it." Same lookup, two
// scopes. Keeping the rules here stops the two from drifting apart — if the
// analysis told you a skill was buried and the rewriter disagreed about where
// the evidence was, the feature would be worse than not having it.

import { preprocess } from './tokenize.js';

/** Stems present anywhere in a chunk of text. */
export function stemSet(value) {
  return new Set(preprocess(value).tokens);
}

/** Stems of a single term, in order. */
export function termStems(term) {
  return preprocess(term).tokens;
}

/**
 * Every stem of a multi-word term must be present: "machine" alone is not
 * evidence for "machine learning".
 */
export function coveredBy(termTokens, set) {
  return termTokens.length > 0 && termTokens.every((token) => set.has(token));
}

/**
 * Where a term sits in the resume, strongest evidence first.
 *
 *   bullet      an accomplishment demonstrates it — a recruiter reading the
 *               page sees you doing the thing
 *   entry       the project/job header declares the stack ("Ease-On | React,
 *               Node.js") — attached to real work, but not narrated
 *   skills      a Skills line claims it and nothing else mentions it
 *   coursework  a class covered it — real, but the weakest claim there is
 *   elsewhere   somewhere the parser did not classify (summary, objective)
 *
 * The first two are what "highlighted" means. The last three are the case
 * this app previously had no way to name: the ATS keyword-matches you fine,
 * and the human who reads the page next never learns you can do it.
 */
export const PLACEMENTS = ['bullet', 'entry', 'skills', 'coursework', 'elsewhere'];

const HIGHLIGHTED = new Set(['bullet', 'entry']);

/** True when the placement counts as demonstrated rather than merely claimed. */
export function isHighlighted(placement) {
  return HIGHLIGHTED.has(placement);
}

export const PLACEMENT_COPY = {
  bullet: 'Demonstrated in an accomplishment bullet.',
  entry: 'Declared in the tech stack of one of your entries.',
  skills: 'Listed on your Skills line only.',
  coursework: 'Only appears in your coursework.',
  elsewhere: 'Mentioned somewhere on the page, but not tied to any work.',
};

/**
 * Build the per-placement stem index for one parsed resume.
 *
 * @param {object} parsed output of parseResume()
 * @returns {{bullet: Set, entry: Set, skills: Set, coursework: Set}}
 */
export function indexResume(parsed) {
  const entryText = (parsed.sections ?? [])
    .flatMap((section) => section.entries ?? [])
    .flatMap((entry) => [entry.title ?? '', entry.org ?? '', ...(entry.tech ?? [])])
    .join(' ');

  return {
    bullet: stemSet((parsed.bullets ?? []).map((b) => b.text).join(' ')),
    entry: stemSet(entryText),
    skills: stemSet((parsed.skills?.all ?? []).join(' ')),
    coursework: stemSet((parsed.coursework ?? []).join(' ')),
  };
}

/**
 * Classify one already-stemmed term against a resume index.
 *
 * @param {string} stem
 * @param {object} index      from indexResume()
 * @param {Set}    resumeSet  every stem in the raw resume text, for the
 *                            `elsewhere` fallback — the parser labels some
 *                            sections "other", and a term found only there is
 *                            still present, just unplaced.
 * @returns {string|null} a PLACEMENTS value, or null when absent entirely
 */
export function placementOf(stem, index, resumeSet = null) {
  if (index.bullet.has(stem)) return 'bullet';
  if (index.entry.has(stem)) return 'entry';
  if (index.skills.has(stem)) return 'skills';
  if (index.coursework.has(stem)) return 'coursework';
  if (resumeSet?.has(stem)) return 'elsewhere';
  return null;
}
