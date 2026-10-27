// Process 2.0 — Resume Analysis pipeline.
//
// Runs 2.1 -> 2.5 and returns a per-posting result plus a cross-posting
// summary. The summary is what makes HiveFit's multi-job comparison different
// from one-to-one tools: the same resume scored against a pool of postings
// tells you how competitive you are in the field, and which gaps recur.

import { preprocess } from './tokenize.js';
import { TfidfVectorizer } from './tfidf.js';
import { compatibilityScore, requirementCoverage } from './similarity.js';
import { bm25Score } from './bm25.js';
import { isKnownSkill } from './categories.js';
import { analyzeKeywordGap } from './keywordGap.js';
import { findUnderhighlighted, summarizeUnderhighlighted } from './highlight.js';
import { parseResume } from './parse.js';

// Bands calibrated against reference pairs (see tests/scoring.test.js): a
// resume scored against a posting rewritten from it lands ~90, a genuine but
// imperfect match ~46, an adjacent role ~26, an unrelated field 0.
function verdictFor(score) {
  if (score >= 75) return { band: 'strong', message: 'Strong match. Your resume already covers most of what this posting asks for.' };
  if (score >= 45) return { band: 'moderate', message: 'Moderate match. You cover the core requirements; the gaps below are what stand between you and a strong match.' };
  if (score >= 25) return { band: 'weak', message: 'Weak match. You share some ground with this posting, but several required skills are missing.' };
  return { band: 'poor', message: 'Poor match. This posting asks for substantially different experience than your resume shows.' };
}

/**
 * Score one resume against one or more job postings.
 *
 * @param {object} args
 * @param {string}   args.resumeText
 * @param {Array<{id?: number|string, title?: string, company?: string, description: string}>} args.jobs
 * @param {string[]} [args.backgroundCorpus] extra posting texts used only to
 *   fit IDF. More postings means better-calibrated term weights.
 */
export function analyzeResume({ resumeText, jobs, backgroundCorpus = [] }) {
  if (!resumeText || !String(resumeText).trim()) {
    throw Object.assign(new Error('Resume text is empty'), { status: 400 });
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw Object.assign(new Error('At least one job posting is required'), { status: 400 });
  }

  const resume = preprocess(resumeText);
  const jobDocs = jobs.map((job) => preprocess(job.description ?? ''));
  const background = backgroundCorpus.map((text) => preprocess(text).tokens);

  // IDF is fitted across every posting available — the ones being compared
  // plus any background corpus — so term weights reflect the job market
  // rather than the two documents in front of us.
  const vectorizer = new TfidfVectorizer();
  const corpus = [...jobDocs.map((d) => d.tokens), ...background, resume.tokens];
  vectorizer.fit(corpus);

  // BM25 normalizes for document length, so it needs the corpus average to
  // normalize against.
  const averageDocumentLength = corpus.reduce((sum, doc) => sum + doc.length, 0) / (corpus.length || 1);

  const resumeVector = vectorizer.transform(resume.tokens);
  const resumeTermSet = new Set(resume.tokens);
  const parsed = parseResume(resumeText);
  const bullets = parsed.bullets
    .map((b) => b.text)
    .filter((t) => t.length >= 25 && t.length <= 600);

  const results = jobs.map((job, index) => {
    const jobDoc = jobDocs[index];
    const jobVector = vectorizer.transform(jobDoc.tokens);

    // Headline score: coverage of the posting's *recognized skills*. Filtering
    // to the taxonomy keeps filler vocabulary ("full", "stack", "you will")
    // out of a number the user is asked to act on. Overall coverage and raw
    // cosine are reported alongside it for the detail view and for the
    // report's Figure 4 pipeline, which specifies cosine at stage 2.4.
    const score = requirementCoverage(jobVector, resumeTermSet, isKnownSkill);
    const overallCoverage = requirementCoverage(jobVector, resumeTermSet);
    const similarity = compatibilityScore(resumeVector, jobVector);

    // Reported alongside, not instead of. BM25 is the standard retrieval
    // baseline and answers the fair objection that cosine over raw TF-IDF
    // treats the eighth mention of a term as worth as much as the second;
    // keeping all three visible is what lets the scoring be argued about
    // rather than taken on faith.
    const retrieval = bm25Score({
      documentTokens: resume.tokens,
      queryTokens: jobDoc.tokens,
      idfFor: (term) => vectorizer.idfFor(term),
      averageDocumentLength,
    });

    // Display spellings come from the posting first: we are naming terms the
    // posting used, and want the posting's own capitalization.
    const surface = new Map([...resume.surface, ...jobDoc.surface]);

    const gap = analyzeKeywordGap({
      jobVector,
      resumeTokens: resume.tokens,
      surface,
    });

    // Requirements this resume meets but does not demonstrate. Deliberately
    // separate from the gap above: a gap term needs the user to confirm real
    // experience before anything can be written, while everything here is
    // already evidenced somewhere on the page and only needs moving.
    const underhighlighted = findUnderhighlighted({
      jobVector,
      parsed,
      resumeSet: resumeTermSet,
      surface,
    });

    return {
      jobId: job.id ?? null,
      title: job.title ?? null,
      company: job.company ?? null,
      url: job.url ?? null,
      score,
      overallCoverage,
      similarity,
      retrieval,
      verdict: verdictFor(score),
      categories: gap.categories,
      prioritizedGap: gap.prioritized,
      underhighlighted,
      underhighlightedSummary: summarizeUnderhighlighted(underhighlighted),
      topJobTerms: vectorizer.topTerms(jobVector, 15),
    };
  });

  // Ordered before anything downstream sees it, so the ranking holds in the
  // API response, the persisted rows, and the UI without each one re-sorting.
  const ranked = rankResults(results);

  return {
    resume: {
      tokenCount: resume.tokens.length,
      uniqueTerms: new Set(resume.tokens).size,
      bulletCount: bullets.length,
      bullets,
      // Structure the UI can show: which sections were recognized, and the
      // skills the resume explicitly claims.
      name: parsed.name,
      sections: parsed.sections.map((sec) => ({
        title: sec.title,
        kind: sec.kind,
        entries: sec.entries.map((e) => ({
          title: e.title, org: e.org, location: e.location, tech: e.tech, dates: e.dates,
        })),
      })),
      skills: parsed.skills,
    },
    results: ranked,
    comparison: summarize(ranked),
  };
}

/**
 * Best match first.
 *
 * A pool of postings is only useful ordered — the top of the list is where the
 * user should spend the afternoon. Ties break on overall coverage and then
 * title so that identical inputs always produce an identical order, rather
 * than preserving whatever order the caller happened to pass postings in.
 */
function rankResults(results) {
  return [...results]
    .sort((a, b) => (
      b.score - a.score
      || b.overallCoverage - a.overallCoverage
      || String(a.title ?? '').localeCompare(String(b.title ?? ''))
    ))
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

/**
 * Cross-posting view: where you stand across the pool, and what recurs.
 * Takes the ranked list, so best and worst are just its ends.
 */
function summarize(results) {
  const scores = results.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // A term missing from many postings is a systemic gap worth fixing once,
  // rather than a quirk of a single posting.
  const missingCounts = new Map();
  for (const result of results) {
    for (const item of result.prioritizedGap) {
      const existing = missingCounts.get(item.stem) ?? {
        term: item.term, category: item.category, label: item.label, count: 0, totalWeight: 0,
      };
      existing.count += 1;
      existing.totalWeight += item.weight;
      missingCounts.set(item.stem, existing);
    }
  }

  // The same question for skills the user already has: a term buried across
  // most of the pool is one edit that lifts every application, and unlike a
  // recurring gap it needs no new experience to fix.
  const buriedCounts = new Map();
  for (const result of results) {
    for (const item of result.underhighlighted) {
      const existing = buriedCounts.get(item.stem) ?? {
        term: item.term, category: item.category, categoryLabel: item.categoryLabel,
        placement: item.placement, foundIn: item.foundIn, action: item.action,
        candidateBullets: item.candidateBullets, count: 0, totalWeight: 0,
      };
      existing.count += 1;
      existing.totalWeight += item.weight;
      buriedCounts.set(item.stem, existing);
    }
  }

  const recurringUnderhighlighted = [...buriedCounts.values()]
    .filter((b) => b.count > 1)
    .sort((a, b) => b.count - a.count || b.totalWeight - a.totalWeight)
    .slice(0, 10)
    .map((b) => ({
      ...b,
      totalWeight: Math.round(b.totalWeight * 10000) / 10000,
      appearsInPostings: b.count,
      coverage: `${b.count} of ${results.length} postings`,
    }));

  const recurringGaps = [...missingCounts.values()]
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || b.totalWeight - a.totalWeight)
    .slice(0, 15)
    .map((g) => ({
      ...g,
      totalWeight: Math.round(g.totalWeight * 10000) / 10000,
      appearsInPostings: g.count,
      coverage: `${g.count} of ${results.length} postings`,
    }));

  return {
    postingsCompared: results.length,
    averageScore: Math.round(mean * 100) / 100,
    bestScore: results[0]?.score ?? 0,
    worstScore: results[results.length - 1]?.score ?? 0,
    bestMatch: results[0]
      ? {
        jobId: results[0].jobId,
        title: results[0].title,
        company: results[0].company,
        url: results[0].url,
        score: results[0].score,
      }
      : null,
    recurringGaps,
    recurringUnderhighlighted,
    interpretation: interpret(mean, results.length),
  };
}

function interpret(mean, count) {
  if (count === 1) return 'Single posting analyzed. Compare against several postings to see how competitive you are across the field.';
  if (mean >= 70) return `Across ${count} postings you average ${mean.toFixed(1)}%. You are competitive in this field as written.`;
  if (mean >= 50) return `Across ${count} postings you average ${mean.toFixed(1)}%. Fixing the recurring gaps below would lift every one of these applications at once.`;
  return `Across ${count} postings you average ${mean.toFixed(1)}%. The recurring gaps below suggest your resume is not yet framed for this role type.`;
}
