// "You have this, but a recruiter cannot see it."
//
// The keyword gap (2.5) answers "what does this posting want that you do not
// have?". This module answers the question next to it: what does this posting
// want that you DO have, but have not put anywhere a human would notice?
//
// It is a distinct problem with a distinct fix. A missing skill needs a
// conversation about whether the experience is real. A buried skill needs no
// new claim at all — the evidence already exists on the page, in the wrong
// place. That makes this the cheapest possible win for the user, and the one
// an ATS score alone actively hides: keyword matching counts a Skills line the
// same as a demonstrated accomplishment, so the score says you are fine while
// the recruiter reading the page never learns you can do it.

import { categorize, CATEGORY_LABELS } from './categories.js';
import { indexResume, placementOf, isHighlighted, PLACEMENT_COPY, stemSet } from './evidence.js';
import { importanceOf } from './keywordGap.js';

/** What to do about a term, given where it currently sits. */
const ACTIONS = {
  skills: 'Work it into a bullet describing where you used it — a Skills line proves nothing on its own.',
  coursework: 'If you built something with it, say so in a bullet. Coursework alone reads as theory.',
  elsewhere: 'Move it into an accomplishment bullet so it sits next to what you did with it.',
};

/**
 * Bullets this term could plausibly be surfaced in, best candidate first.
 *
 * A bullet from an entry whose stack already declares the term is the strong
 * case: that work demonstrably used it, so surfacing it there is honest and
 * needs no confirmation from the user. Anything else is a guess, and is
 * labelled as one — the user still has to confirm the work actually used it,
 * which is the placement question Process 3.0 already asks.
 */
function candidateBullets(stem, parsed, limit = 3) {
  const scored = (parsed.bullets ?? [])
    .filter((b) => b.text && b.text.length >= 25 && b.text.length <= 600)
    .map((bullet) => {
      const declaredHere = stemSet([
        bullet.entryTitle ?? '',
        ...(bullet.entryTech ?? []),
      ].join(' ')).has(stem);

      return {
        text: bullet.text,
        entryTitle: bullet.entryTitle ?? null,
        // A bullet in the entry that declares this term is where it belongs.
        confident: declaredHere,
        reason: declaredHere
          ? `This entry's stack already lists it, so this is where it was used.`
          : 'Possible home — only if this work actually used it.',
      };
    })
    .sort((a, b) => Number(b.confident) - Number(a.confident));

  return scored.slice(0, limit);
}

/**
 * Posting requirements the resume covers but does not demonstrate.
 *
 * @param {object} args
 * @param {Map<string,number>} args.jobVector  L2-normalized TF-IDF of the posting
 * @param {object}             args.parsed     parseResume() output
 * @param {Set<string>}        args.resumeSet  every stem in the raw resume text
 * @param {Map<string,string>} args.surface    stem -> display spelling
 * @param {number}             [args.limit]
 */
export function findUnderhighlighted({ jobVector, parsed, resumeSet, surface, limit = 12 }) {
  const index = indexResume(parsed);
  const maxWeight = Math.max(...jobVector.values(), 0) || 1;

  const items = [];

  for (const [stem, weight] of jobVector) {
    // Only terms the resume actually covers. Anything absent is a keyword gap,
    // handled by 2.5 — telling the user to "highlight" something they never
    // claimed is exactly the fabrication this app refuses to do.
    if (!resumeSet.has(stem)) continue;

    const placement = placementOf(stem, index, resumeSet);
    if (!placement || isHighlighted(placement)) continue;

    const category = categorize(stem);
    items.push({
      term: surface.get(stem) ?? stem,
      stem,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      weight: Math.round(weight * 10000) / 10000,
      importance: importanceOf(weight / maxWeight),
      placement,
      foundIn: PLACEMENT_COPY[placement],
      action: ACTIONS[placement] ?? ACTIONS.elsewhere,
      candidateBullets: candidateBullets(stem, parsed),
    });
  }

  // Heaviest first: a buried term the posting leans on costs more than a
  // buried term it mentions once in passing.
  items.sort((a, b) => b.weight - a.weight);
  return items.slice(0, limit);
}

/** One sentence for the section header, so the list arrives with a reason. */
export function summarizeUnderhighlighted(items) {
  if (items.length === 0) return null;

  const critical = items.filter((i) => i.importance === 'critical');
  const lead = items.slice(0, 3).map((i) => i.term).join(', ');

  if (critical.length > 0) {
    const emphasis = items.length === 1
      ? 'It is'
      : critical.length === 1 ? 'One of them is' : `${critical.length} of them are`;

    return `You already have ${items.length} skill${items.length === 1 ? '' : 's'} this posting asks for ` +
      `(${lead}${items.length > 3 ? ', and more' : ''}) that no accomplishment on your resume demonstrates. ` +
      `${emphasis} among the posting's most important terms. ` +
      `Nothing here needs a new claim — the experience is already on the page, in a place a recruiter skims past.`;
  }

  return `You already have ${items.length} skill${items.length === 1 ? '' : 's'} this posting asks for ` +
    `(${lead}${items.length > 3 ? ', and more' : ''}) that no accomplishment demonstrates. ` +
    `Surfacing them costs you nothing — you are not adding a claim, you are moving one.`;
}
