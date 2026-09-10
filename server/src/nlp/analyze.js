// Process 2.0 — Resume Analysis pipeline.
//
// Runs 2.1 -> 2.5 and returns a per-posting result plus a cross-posting
// summary. The summary is what makes HiveFit's multi-job comparison different
// from one-to-one tools: the same resume scored against a pool of postings
// tells you how competitive you are in the field, and which gaps recur.

import { preprocess } from './tokenize.js';
import { TfidfVectorizer } from './tfidf.js';
import { compatibilityScore, requirementCoverage } from './similarity.js';
import { isKnownSkill } from './categories.js';
import { analyzeKeywordGap } from './keywordGap.js';
import { extractBullets } from './parse.js';

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
  vectorizer.fit([...jobDocs.map((d) => d.tokens), ...background, resume.tokens]);

  const resumeVector = vectorizer.transform(resume.tokens);
  const resumeTermSet = new Set(resume.tokens);
  const bullets = extractBullets(resumeText);

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

    // Display spellings come from the posting first: we are naming terms the
    // posting used, and want the posting's own capitalization.
    const surface = new Map([...resume.surface, ...jobDoc.surface]);

    const gap = analyzeKeywordGap({
      jobVector,
      resumeTokens: resume.tokens,
      surface,
    });

    return {
      jobId: job.id ?? null,
      title: job.title ?? null,
      company: job.company ?? null,
      score,
      overallCoverage,
      similarity,
      verdict: verdictFor(score),
      categories: gap.categories,
      prioritizedGap: gap.prioritized,
      topJobTerms: vectorizer.topTerms(jobVector, 15),
    };
  });

  return {
    resume: {
      tokenCount: resume.tokens.length,
      uniqueTerms: new Set(resume.tokens).size,
      bulletCount: bullets.length,
      bullets,
    },
    results,
    comparison: summarize(results),
  };
}

/** Cross-posting view: where you stand across the pool, and what recurs. */
function summarize(results) {
  const scores = results.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sorted = [...results].sort((a, b) => b.score - a.score);

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
    bestScore: sorted[0]?.score ?? 0,
    worstScore: sorted[sorted.length - 1]?.score ?? 0,
    bestMatch: sorted[0] ? { jobId: sorted[0].jobId, title: sorted[0].title, score: sorted[0].score } : null,
    recurringGaps,
    interpretation: interpret(mean, results.length),
  };
}

function interpret(mean, count) {
  if (count === 1) return 'Single posting analyzed. Compare against several postings to see how competitive you are across the field.';
  if (mean >= 70) return `Across ${count} postings you average ${mean.toFixed(1)}%. You are competitive in this field as written.`;
  if (mean >= 50) return `Across ${count} postings you average ${mean.toFixed(1)}%. Fixing the recurring gaps below would lift every one of these applications at once.`;
  return `Across ${count} postings you average ${mean.toFixed(1)}%. The recurring gaps below suggest your resume is not yet framed for this role type.`;
}
