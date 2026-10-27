// Which of a posting's terms are worth addressing in ONE specific bullet.
//
// The keyword gap is a property of the resume as a whole, so offering the same
// twelve terms under every bullet is both useless and misleading: it implies
// any bullet is an equally good home for "Kubernetes", when in fact the bullet
// describing the project whose stack lists Kubernetes is the only honest one.
// Picking a bullet has to change the answer, or picking a bullet is theatre.
//
// Four signals, in descending order of how much they should matter:
//
//   evidence   does THIS bullet's own entry already account for the term? A
//              term the entry's stack declares can be surfaced with no further
//              questions, which makes it the single most useful thing to offer.
//   context    does the posting talk about this term in the same breath as
//              what this bullet describes? Computed as overlap between the
//              bullet and the posting sentences that mention the term — the
//              cheap, inspectable stand-in for "are these about the same work".
//   category   is the bullet already technical/tooling/soft-skill flavoured?
//              A soft-skill term under a database-tuning bullet is noise.
//   weight     how heavily the posting leans on the term, as the tiebreak.
//
// Ahead of all four sits one filter: a term has to be a nameable skill. The
// gap list necessarily carries vocabulary lifted straight from the posting
// ("essential", "collaborate", "build"), which is fine in a list of words the
// resume is missing and useless as an instruction — nobody can act on "add
// essential to this bullet". Recognized skills therefore fill the slots first,
// and posting vocabulary only tops up what is left.

import { preprocess } from './tokenize.js';
import { stemSet, termStems, coveredBy } from './evidence.js';
import { categorize, isKnownSkill, CATEGORY_NAMES } from './categories.js';
import { parseResume } from './parse.js';

// Evidence tier dominates the ranking: the difference between "we can write
// this now" and "we have to ask you first" matters more to the user than any
// amount of topical similarity.
const TIER_SCORE = { entry: 1.0, resume: 0.45, new: 0 };

const TIER_REASON = {
  entry: (entryTitle) => entryTitle
    ? `${entryTitle} lists this in its stack, so this bullet can claim it directly.`
    : 'This entry already declares it, so this bullet can claim it directly.',
  resume: () => 'Your resume claims this. Picking it asks whether this particular work used it.',
  new: () => 'Not on your resume anywhere. Picking it asks whether you have the experience.',
};

/** Sentence-ish split; job postings are bullet lists as often as prose. */
function sentencesOf(text) {
  return String(text ?? '')
    .split(/(?<=[.!?;:])\s+|\n+|(?:^|\s)[•\-*•]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

/** What kind of skill this bullet is already about, as category shares. */
function categoryProfile(stems) {
  const counts = Object.fromEntries(CATEGORY_NAMES.map((name) => [name, 0]));
  let total = 0;

  for (const stem of stems) {
    if (!isKnownSkill(stem)) continue;
    counts[categorize(stem)] += 1;
    total += 1;
  }
  if (total === 0) return counts; // all zero: no signal, so no boost either

  for (const name of CATEGORY_NAMES) counts[name] /= total;
  return counts;
}

/**
 * Build the per-term context index once for the whole posting.
 * @returns {Map<string, Set<string>>} stem -> stems it keeps company with
 */
function contextIndex(jobDescription) {
  const index = new Map();

  for (const sentence of sentencesOf(jobDescription)) {
    const stems = preprocess(sentence).tokens;
    if (stems.length === 0) continue;
    const unique = new Set(stems);

    for (const stem of unique) {
      if (!index.has(stem)) index.set(stem, new Set());
      const bag = index.get(stem);
      for (const other of unique) if (other !== stem) bag.add(other);
    }
  }
  return index;
}

/**
 * Terms the posting wants that one of the resume's own entries declares.
 *
 * These reach no other list and are the most valuable target there is. A gap
 * term is absent from the resume entirely; an underhighlighted term is one no
 * entry accounts for. A term sitting in an entry's tech stack is neither — the
 * highlight analysis calls it visible, and page-wide it is. But the individual
 * bullet describing that work may still never mention it, and that bullet is
 * the one honest place to surface it: the project demonstrably used the thing,
 * so no confirmation is needed and nothing is invented.
 */
function entryOpportunities(parsed, jobDescription) {
  const { tokens, surface } = preprocess(jobDescription);
  const wanted = new Set(tokens);

  const declared = new Map();
  for (const section of parsed.sections ?? []) {
    for (const entry of section.entries ?? []) {
      for (const stem of stemSet([entry.title ?? '', ...(entry.tech ?? [])].join(' '))) {
        if (!wanted.has(stem) || !isKnownSkill(stem)) continue;
        declared.set(stem, {
          term: surface.get(stem) ?? stem,
          stem,
          category: categorize(stem),
          // No IDF weight: these never went through the vectorizer. The
          // evidence tier already ranks them above everything else.
          weight: 0,
          importance: 'important',
        });
      }
    }
  }
  return [...declared.values()];
}

/**
 * Rank a posting's outstanding terms for each bullet in the resume.
 *
 * @param {object} args
 * @param {string} args.resumeText
 * @param {string} args.jobDescription
 * @param {object[]} args.candidates  gap + underhighlighted items ({term, stem, category, weight, importance})
 * @param {number} [args.limit]       terms offered per bullet
 * @returns {object[]} bullets, each with its own ranked `targets`
 */
export function bulletsWithTargets({ resumeText, jobDescription, candidates = [], limit = 6 }) {
  const parsed = parseResume(resumeText);
  const context = contextIndex(jobDescription);
  const resumeSkillStems = stemSet([...(parsed.skills?.all ?? []), ...(parsed.coursework ?? [])].join(' '));

  candidates = [...candidates, ...entryOpportunities(parsed, jobDescription)];

  const maxWeight = Math.max(...candidates.map((c) => c.weight ?? 0), 0) || 1;

  // Precompute per-term data once rather than per bullet.
  const seen = new Set();
  const prepared = candidates
    .filter((candidate) => {
      if (seen.has(candidate.stem)) return false;
      seen.add(candidate.stem);
      return true;
    })
    .map((candidate) => ({
      ...candidate,
      tokens: termStems(candidate.term),
      companions: context.get(candidate.stem) ?? new Set(),
      normalizedWeight: (candidate.weight ?? 0) / maxWeight,
      // Recomputed rather than read off the candidate: gap items carry this
      // flag but underhighlighted items do not, and one source of truth beats
      // two shapes.
      isSkill: isKnownSkill(candidate.stem),
    }))
    .filter((candidate) => candidate.tokens.length > 0);

  return parsed.bullets
    .filter((bullet) => bullet.text && bullet.text.length >= 25 && bullet.text.length <= 600)
    .map((bullet) => {
      const bulletStems = stemSet(bullet.text);
      const entryStems = stemSet([bullet.entryTitle ?? '', ...(bullet.entryTech ?? [])].join(' '));
      const profile = categoryProfile(bulletStems);

      const targets = [];

      for (const candidate of prepared) {
        // Already in this sentence — there is nothing to add.
        if (coveredBy(candidate.tokens, bulletStems)) continue;

        const tier = coveredBy(candidate.tokens, entryStems) ? 'entry'
          : coveredBy(candidate.tokens, resumeSkillStems) ? 'resume'
            : 'new';

        // How much of the company this term keeps in the posting also appears
        // in this bullet. Normalized by the companion count so a term that
        // appears in one short sentence is not penalised against one that
        // appears in ten.
        let shared = 0;
        for (const companion of candidate.companions) {
          if (bulletStems.has(companion)) shared += 1;
        }
        const contextScore = candidate.companions.size > 0
          ? shared / Math.sqrt(candidate.companions.size)
          : 0;

        // Category affinity is weighted heavily on purpose. Posting weight
        // cannot separate "kubernetes" from "queries" here — on a corpus this
        // size both appear in a similar number of documents and land on nearly
        // identical IDF — so what a bullet is ABOUT is the signal that keeps
        // soft-skill terms off a database-tuning bullet and vice versa.
        const score = TIER_SCORE[tier]
          + 0.55 * Math.min(contextScore, 1)
          + 0.50 * (profile[candidate.category] ?? 0)
          + 0.20 * candidate.normalizedWeight;

        targets.push({
          term: candidate.term,
          stem: candidate.stem,
          category: candidate.category,
          importance: candidate.importance ?? 'minor',
          // `evidence` is what the UI colours on: green for "we can write this",
          // amber for "we will ask you where", grey for "we will ask if".
          evidence: tier,
          reason: TIER_REASON[tier](bullet.entryTitle),
          isSkill: candidate.isSkill,
          score: Math.round(score * 1000) / 1000,
        });
      }

      // Nameable skills first, each group ranked by the four signals above.
      targets.sort((a, b) => (b.isSkill - a.isSkill) || (b.score - a.score));

      return {
        text: bullet.text,
        entryTitle: bullet.entryTitle ?? null,
        entryTech: bullet.entryTech ?? [],
        section: bullet.sectionTitle ?? bullet.section ?? null,
        targets: targets.slice(0, limit),
      };
    });
}
