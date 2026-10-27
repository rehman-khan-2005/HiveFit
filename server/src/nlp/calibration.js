// Scoring calibration: does the number actually separate a good match from a
// bad one, and does it do so better than the alternatives?
//
// The fair criticism of a keyword-matching score is that information
// retrieval and information extraction are different problems, and a term
// overlap metric can hand a near-identical number to a resume that genuinely
// fits and one that merely shares vocabulary. The answer to that is not a
// better-sounding formula, it is a measurement: score known-good and
// known-bad pairs with every candidate metric and look at the separation.
//
// This runs the three metrics the pipeline already computes over a labelled
// set of reference pairs and reports, per metric:
//
//   spread      best-match score minus worst-match score. Bigger is better:
//               a metric with no spread cannot rank anything.
//   ordering    whether the metric ranks the pairs in the labelled order. A
//               metric that is well spread but mis-ordered is worse than
//               useless, because it is confidently wrong.
//   margin      smallest gap between adjacent labelled tiers. This is the one
//               that matters for verdict bands: a thin margin means the
//               boundary between "strong" and "moderate" is noise.

import { analyzeResume } from './analyze.js';

export const METRICS = [
  { key: 'score', label: 'Requirement coverage (headline)' },
  { key: 'retrieval', label: 'BM25 retrieval' },
  { key: 'similarity', label: 'TF-IDF cosine' },
];

/**
 * Score one resume against each labelled posting with every metric.
 *
 * @param {object} args
 * @param {string} args.resume
 * @param {Array<{label: string, expected: number, description: string}>} args.pairs
 *   `expected` is the rank the pair should land in, 0 = best match.
 * @returns {object} per-metric readings and a verdict on each
 */
export function calibrate({ resume, pairs }) {
  const corpus = pairs.map((p) => p.description);

  const rows = pairs.map((pair) => {
    const { results } = analyzeResume({
      resumeText: resume,
      jobs: [{ id: 1, description: pair.description }],
      backgroundCorpus: corpus,
    });
    const result = results[0];

    return {
      label: pair.label,
      expected: pair.expected,
      band: result.verdict.band,
      ...Object.fromEntries(METRICS.map((m) => [m.key, result[m.key]])),
    };
  });

  const metrics = METRICS.map(({ key, label }) => {
    const values = rows.map((r) => r[key]);
    const spread = Math.max(...values) - Math.min(...values);

    // Rank the rows by this metric, best first, and compare to the labels.
    const ranked = [...rows].sort((a, b) => b[key] - a[key]);
    const ordering = ranked.every((row, index) => row.expected === index);

    // Tightest gap between consecutive labelled tiers.
    const byExpected = [...rows].sort((a, b) => a.expected - b.expected);
    let margin = Infinity;
    for (let i = 1; i < byExpected.length; i += 1) {
      margin = Math.min(margin, byExpected[i - 1][key] - byExpected[i][key]);
    }

    return {
      key,
      label,
      spread: Math.round(spread * 100) / 100,
      ordering,
      // Negative means the metric put a worse pair above a better one.
      margin: Number.isFinite(margin) ? Math.round(margin * 100) / 100 : null,
    };
  });

  return { rows, metrics };
}

/** Fixed-width table, for pasting into a report or a meeting. */
export function formatCalibration({ rows, metrics }) {
  const lines = [];
  const width = Math.max(...rows.map((r) => r.label.length), 10);

  lines.push(`${'pair'.padEnd(width)}  ${METRICS.map((m) => m.key.padStart(11)).join('')}   band`);
  lines.push('-'.repeat(width + METRICS.length * 11 + 12));
  for (const row of [...rows].sort((a, b) => a.expected - b.expected)) {
    lines.push(
      `${row.label.padEnd(width)}  `
      + METRICS.map((m) => String(row[m.key]).padStart(11)).join('')
      + `   ${row.band}`
    );
  }

  lines.push('');
  lines.push(`${'metric'.padEnd(34)}  spread   margin   ordering`);
  lines.push('-'.repeat(62));
  for (const m of metrics) {
    lines.push(
      `${m.label.padEnd(34)}  ${String(m.spread).padStart(6)}   ${String(m.margin).padStart(6)}   `
      + (m.ordering ? 'correct' : 'WRONG ORDER')
    );
  }
  return lines.join('\n');
}
