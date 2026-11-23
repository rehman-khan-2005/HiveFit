// Keyword visibility — whether a recruiter's search box can find you.
//
// The gap analysis answers "what does this posting want that you do not have".
// This answers a different question that the gap analysis cannot see: you have
// the skill, you named it on the resume, and the search still misses you,
// because you and the employer spell it differently.
//
// It matters because screening is often literal before it is human. A
// recruiter filtering a stack of applications types "Kubernetes" into a box;
// a resume that says "k8s" is not in the result set, and nobody involved ever
// finds out why. Stemming cannot fix this — "k8s" and "Kubernetes" are not
// inflections of one word — so the equivalences come from an explicit table.
//
// The advice here is always additive. It never suggests replacing the user's
// spelling, because both spellings on the page is strictly better than either
// alone: the formal one for the search, the shorthand for the human reading it.

import { preprocess } from './tokenize.js';
import { aliasGroupFor } from './aliases.js';

/**
 * @param {string[]} resumeTokens        stemmed resume tokens
 * @param {Map}      resumeSurface       stem -> the resume's own spelling
 * @param {Array<{tokens: string[], surface: Map}>} jobDocs  compared postings
 * @returns {{missingSpellings: object[], searchable: object[], postingsCompared: number}}
 */
export function keywordVisibility({ resumeTokens = [], resumeSurface = new Map(), jobDocs = [] }) {
  const resumeStems = new Set(resumeTokens);

  // How many of the compared postings use each stem, and how they spell it.
  const postingCount = new Map();
  const postingSpelling = new Map();
  for (const doc of jobDocs) {
    for (const stem of new Set(doc.tokens)) {
      postingCount.set(stem, (postingCount.get(stem) ?? 0) + 1);
      if (!postingSpelling.has(stem) && doc.surface?.has(stem)) {
        postingSpelling.set(stem, doc.surface.get(stem));
      }
    }
  }

  // Group every stem either side knows about by its alias group.
  const groups = new Map();
  for (const stem of new Set([...resumeStems, ...postingCount.keys()])) {
    const group = aliasGroupFor(stem, preprocess);
    if (!group) continue;

    const entry = groups.get(group.canonical) ?? {
      canonical: group.canonical,
      mine: [],
      theirs: [],
    };

    if (resumeStems.has(stem)) {
      entry.mine.push({ stem, spelling: resumeSurface.get(stem) ?? stem });
    }
    if (postingCount.has(stem)) {
      entry.theirs.push({
        stem,
        // The alias table's own spelling, not the posting's. Postings are
        // lowercased by preprocessing, and the capitalization is the point:
        // the advice is to write what a recruiter types, which is
        // "Kubernetes", not "kubernetes".
        spelling: group.spelling,
        postings: postingCount.get(stem),
      });
    }
    groups.set(group.canonical, entry);
  }

  const missingSpellings = [];
  const searchable = [];

  for (const entry of groups.values()) {
    // Nothing on the resume: this is a gap, not a spelling problem, and the
    // gap analysis already covers it. Saying "also write it as Kubernetes"
    // to someone who has never used it would be advice to lie.
    if (entry.mine.length === 0) continue;

    // Nothing in the postings: the skill is real but nobody here searched for
    // it, so there is no spelling to match.
    if (entry.theirs.length === 0) continue;

    const mineStems = new Set(entry.mine.map((m) => m.stem));
    const wanted = entry.theirs
      .filter((t) => !mineStems.has(t.stem))
      .sort((a, b) => b.postings - a.postings);

    const matched = entry.theirs.filter((t) => mineStems.has(t.stem));

    if (matched.length > 0) {
      searchable.push({
        skill: entry.canonical,
        spelling: matched[0].spelling,
        postings: Math.max(...matched.map((m) => m.postings)),
      });
    }

    // A spelling these postings use that the resume does not. Only the most
    // common one: listing three variants of the same skill is the information
    // overload this feature is supposed to reduce.
    if (wanted.length > 0) {
      const top = wanted[0];
      missingSpellings.push({
        skill: entry.canonical,
        yours: entry.mine[0].spelling,
        theirs: top.spelling,
        postings: top.postings,
        // Phrased as an addition, never a replacement.
        action: `Write it as "${top.spelling}" as well as "${entry.mine[0].spelling}".`,
      });
    }
  }

  return {
    // Most-searched first: the spelling the most postings use is the one worth
    // adding if the user only adds one.
    missingSpellings: missingSpellings.sort((a, b) => b.postings - a.postings),
    searchable: searchable.sort((a, b) => b.postings - a.postings),
    postingsCompared: jobDocs.length,
  };
}

/**
 * One line for the user, or null when there is nothing to say.
 *
 * Null rather than "no issues found": a section that always renders is a
 * section the user learns to skip.
 */
export function summarizeKeywordVisibility({ missingSpellings, postingsCompared }) {
  if (missingSpellings.length === 0) return null;

  const [first] = missingSpellings;
  const others = missingSpellings.length - 1;
  const where = `${first.postings} of the ${postingsCompared} postings`;

  const tail = others > 0
    ? ` ${others} other skill${others === 1 ? '' : 's'} ${others === 1 ? 'has' : 'have'} the same problem.`
    : '';

  return `${where} write ${first.skill} as "${first.theirs}". Your resume says `
    + `"${first.yours}", so a recruiter searching the formal spelling does not find you.${tail}`;
}
