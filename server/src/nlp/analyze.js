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
import { analyzeKeywordGap, LEANED_ON } from './keywordGap.js';
import { bandByFit, fitSummary } from './fit.js';
import { keywordVisibility, summarizeKeywordVisibility } from './keywords.js';
import { findUnderhighlighted, summarizeUnderhighlighted } from './highlight.js';
import { parseResume } from './parse.js';

// Band thresholds, set with the advisor on 12 November: 80 and above is a
// strong match, 60 to 80 is decent with gaps worth preparing for. A perfect
// 100 stays reachable — a resume that genuinely covers every requirement has
// earned it — but it should be rare, and the bands are placed so that "strong"
// means strong rather than merely above average.
//
// Calibrated against the reference pairs in tests/scoring.test.js: a posting
// rewritten from the resume lands ~90, the same field with gaps ~50, an
// adjacent role ~25, an unrelated field 0.
const BANDS = [
  {
    floor: 80,
    band: 'strong',
    message: 'Strong match. Your resume already covers most of what this posting asks for.',
    guidance: 'Worth applying to as it stands. Read the gaps below for interview preparation rather than rewriting.',
  },
  {
    floor: 60,
    band: 'moderate',
    message: 'Decent match. You cover the core requirements, with gaps worth reviewing before you apply.',
    guidance: 'Apply, but tailor first. Work the terms below into your bullets and be ready to talk about what is missing.',
  },
  {
    floor: 40,
    band: 'weak',
    message: 'Partial match. You share real ground with this posting, but several required skills are missing.',
    guidance: 'Tailoring will help and will not close it alone. Check the gaps for what you could honestly add.',
  },
  {
    floor: 0,
    band: 'poor',
    message: 'Weak match. This posting asks for substantially different experience than your resume shows.',
    guidance: 'Your time is better spent on the stronger matches in this comparison.',
  },
];

function verdictFor(score) {
  const { band, message, guidance } = BANDS.find((tier) => score >= tier.floor);
  return { band, message, guidance };
}

/**
 * What the score ranges mean, returned with every analysis.
 *
 * Shipped as data rather than written into the interface so one definition
 * drives the bands, the colours and the explanation the user reads — a legend
 * that drifts from the thresholds is worse than no legend.
 */
export function scoreGuide() {
  return BANDS.map((tier, index) => ({
    band: tier.band,
    floor: tier.floor,
    ceiling: index === 0 ? 100 : BANDS[index - 1].floor,
    label: index === 0
      ? `${tier.floor} and above`
      : `${tier.floor}\u2013${BANDS[index - 1].floor}`,
    message: tier.message,
    guidance: tier.guidance,
  }));
}

/**
 * Coverage of the terms a posting leans on, rather than every term it names.
 *
 * This exists because the headline score reads far lower on real listings than
 * on the short reference postings it was calibrated against, and for a
 * structural reason rather than a bug: a real posting names forty-odd
 * recognized skills — the team's whole stack, the nice-to-haves, the things
 * the other team uses — and no single resume covers most of them. Dividing by
 * all forty means a genuinely strong candidate reads as a third of a match.
 *
 * So the denominator here is the terms the posting actually emphasises, which
 * the gap analysis already identifies by relative weight for its critical and
 * important tiers. Same weighting, same threshold, smaller denominator.
 */
function coreCoverage(jobVector, resumeTermSet) {
  let heaviest = 0;
  for (const [term, weight] of jobVector) {
    if (isKnownSkill(term) && weight > heaviest) heaviest = weight;
  }
  if (heaviest === 0) return 0;

  const floor = heaviest * LEANED_ON;
  return requirementCoverage(
    jobVector,
    resumeTermSet,
    (term) => isKnownSkill(term) && jobVector.get(term) >= floor
  );
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
    const core = coreCoverage(jobVector, resumeTermSet);
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
      core,
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
  // Banded after ranking, because a fit band is a statement about this set and
  // cannot be computed one posting at a time.
  const ranked = bandByFit(rankResults(results));

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
    // Whether a literal keyword search can find this resume at all. Computed
    // across the whole compared set rather than per posting: "most of these
    // employers write it this way" is the finding, and one posting cannot
    // support it.
    keywords: (() => {
      const visibility = keywordVisibility({
        resumeTokens: resume.tokens,
        resumeSurface: resume.surface,
        jobDocs,
      });
      return { ...visibility, summary: summarizeKeywordVisibility(visibility) };
    })(),
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
    // How this comparison split across the relative bands, so the interface
    // can offer "hide the weakest" against real counts.
    fitBands: fitSummary(results),
  };
}

function interpret(mean, count) {
  if (count === 1) return 'Single posting analyzed. Compare against several postings to see how competitive you are across the field.';
  if (mean >= 70) return `Across ${count} postings you average ${mean.toFixed(1)}%. You are competitive in this field as written.`;
  if (mean >= 50) return `Across ${count} postings you average ${mean.toFixed(1)}%. Fixing the recurring gaps below would lift every one of these applications at once.`;
  return `Across ${count} postings you average ${mean.toFixed(1)}%. The recurring gaps below suggest your resume is not yet framed for this role type.`;
}
