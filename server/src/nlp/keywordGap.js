// DFD 2.5 — Keyword Gap Analysis, and the transparent score breakdown.
//
// The report's central complaint about Jobscan and Rezi is that a single
// percentage tells you nothing about what to fix. So alongside the gap list
// this module produces a per-category coverage score with a plain-language
// explanation of how each number was arrived at.
//
// Coverage is weighted by IDF rather than counted: missing "kubernetes" is a
// bigger hole than missing "dashboard", and a raw count would treat them the
// same.

import { categorize, isKnownSkill, CATEGORY_NAMES, CATEGORY_LABELS } from './categories.js';

const IMPORTANCE_TIERS = [
  { min: 0.75, label: 'critical' },
  { min: 0.45, label: 'important' },
  { min: 0, label: 'minor' },
];

function importanceOf(relativeWeight) {
  return IMPORTANCE_TIERS.find((tier) => relativeWeight >= tier.min).label;
}

function explain(category, coverage, missingCount, totalCount) {
  const label = CATEGORY_LABELS[category];
  const matched = totalCount - missingCount;
  if (totalCount === 0) {
    return `This posting does not emphasize ${label.toLowerCase()}, so this category does not affect your score.`;
  }
  if (coverage >= 90) {
    return `Your resume covers ${matched} of the ${totalCount} ${label.toLowerCase()} this posting asks for. This is a strong area — no action needed.`;
  }
  if (coverage >= 60) {
    return `Your resume covers ${matched} of the ${totalCount} ${label.toLowerCase()} this posting asks for. Adding the ${missingCount} missing term${missingCount === 1 ? '' : 's'} below would raise this score.`;
  }
  return `Your resume covers only ${matched} of the ${totalCount} ${label.toLowerCase()} this posting asks for. This is the weakest kind of gap for an ATS — address the critical terms first.`;
}

/**
 * Compare a job posting against a resume and report what is missing.
 *
 * @param {object} args
 * @param {Map<string,number>} args.jobVector    L2-normalized TF-IDF of the posting
 * @param {string[]}           args.resumeTokens stemmed resume tokens
 * @param {Map<string,string>} args.surface      stem -> display spelling
 * @param {number}             args.limit        max gap terms to return
 */
export function analyzeKeywordGap({ jobVector, resumeTokens, surface, limit = 40 }) {
  const resumeSet = new Set(resumeTokens);

  // Bucket every posting term by category, tracking weight present vs missing.
  const buckets = new Map(
    CATEGORY_NAMES.map((name) => [
      name,
      { total: 0, covered: 0, missing: [], totalTerms: 0, missingTerms: 0 },
    ])
  );

  const maxWeight = Math.max(...jobVector.values(), 0) || 1;

  for (const [term, weight] of jobVector) {
    const category = categorize(term);
    const bucket = buckets.get(category);
    bucket.total += weight;
    bucket.totalTerms += 1;

    if (resumeSet.has(term)) {
      bucket.covered += weight;
    } else {
      bucket.missingTerms += 1;
      bucket.missing.push({
        term: surface.get(term) ?? term,
        stem: term,
        weight: Math.round(weight * 10000) / 10000,
        importance: importanceOf(weight / maxWeight),
        // A term from the curated taxonomy is a nameable skill; anything else
        // is vocabulary lifted from the posting. Both are worth showing, but
        // only the first kind belongs at the top of a "fix this" list.
        recognizedSkill: isKnownSkill(term),
      });
    }
  }

  // Per-category transparent breakdown. Category weight is expressed as a
  // share of the posting's total term weight, so the four numbers sum to 100.
  const totalWeight =
    [...buckets.values()].reduce((sum, b) => sum + b.total, 0) || 1;
  const categories = [];
  for (const name of CATEGORY_NAMES) {
    const bucket = buckets.get(name);
    const coverage = bucket.total > 0
      ? Math.round((bucket.covered / bucket.total) * 10000) / 100
      : 100;

    bucket.missing.sort(
      (a, b) => b.recognizedSkill - a.recognizedSkill || b.weight - a.weight
    );

    categories.push({
      category: name,
      label: CATEGORY_LABELS[name],
      coverage,
      termsRequired: bucket.totalTerms,
      termsMatched: bucket.totalTerms - bucket.missingTerms,
      termsMissing: bucket.missingTerms,
      // Weight this category carries in the posting overall, so the UI can
      // show that a 40% soft-skills score on a posting that barely mentions
      // them is not the thing to fix first.
      weightInPosting: Math.round((bucket.total / totalWeight) * 10000) / 100,
      explanation: explain(name, coverage, bucket.missingTerms, bucket.totalTerms),
      missing: bucket.missing.slice(0, limit),
    });
  }

  // Flat, ranked view for "fix these first".
  const prioritized = categories
    .flatMap((c) => c.missing.map((m) => ({ ...m, category: c.category, label: c.label })))
    .sort((a, b) => b.recognizedSkill - a.recognizedSkill || b.weight - a.weight)
    .slice(0, limit);

  return { categories, prioritized };
}
