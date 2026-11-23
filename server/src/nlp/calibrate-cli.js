// npm run calibrate — prints the scoring calibration table.
//
// Exists so the methodology can be checked and argued about from a terminal
// rather than taken on trust from a paragraph in a report.

import { calibrate, formatCalibration } from './calibration.js';
import { REFERENCE_RESUME, REFERENCE_PAIRS } from './reference-pairs.js';
import { analyzeResume, scoreGuide } from './analyze.js';

console.log('\nHiveFit scoring calibration');
console.log('Resume scored against a labelled ladder of postings, best match first.\n');
console.log(formatCalibration(calibrate({ resume: REFERENCE_RESUME, pairs: REFERENCE_PAIRS })));
console.log('');
console.log('spread   = best score minus worst. A metric with no spread cannot rank.');
console.log('margin   = tightest gap between adjacent tiers. Thin margins make band');
console.log('           boundaries noise rather than signal.');
console.log('ordering = whether the metric ranked the ladder in the labelled order.');
console.log('');

// --live scores the same resume against real stored postings.
//
// The ladder above uses short, purpose-written postings, where a resume that
// covers the requirements scores near 90. Real postings run to 150+ terms and
// no resume covers most of them, so the distribution sits far lower. Band
// thresholds chosen against the ladder and applied to real listings is exactly
// how a scale ends up reporting "poor" for everything, so the two have to be
// measured separately.
const liveFlag = process.argv.indexOf('--live');
if (liveFlag !== -1) {
  const sampleSize = Number(process.argv[liveFlag + 1]) || 60;
  const { searchStored } = await import('../jobs/store.js');
  const { pool } = await import('../db/pool.js');

  const postings = await searchStored({ limit: sampleSize });

  if (postings.length === 0) {
    console.log('No stored postings to score against. Run npm run jobs:refresh first.\n');
  } else {
    const { results } = analyzeResume({
      resumeText: REFERENCE_RESUME,
      jobs: postings.map((p) => ({ id: p.id, title: p.title, description: p.description })),
    });

    const scores = results.map((r) => r.score).sort((a, b) => a - b);
    const at = (q) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
    const counts = new Map();
    for (const r of results) counts.set(r.verdict.band, (counts.get(r.verdict.band) ?? 0) + 1);

    console.log(`Against ${results.length} real postings from the stored pool`);
    console.log('(same resume, so the difference is the postings themselves)\n');
    console.log(`  min ${scores[0].toFixed(1)}   median ${at(0.5).toFixed(1)}   p90 ${at(0.9).toFixed(1)}   max ${scores[scores.length - 1].toFixed(1)}\n`);

    for (const tier of scoreGuide()) {
      const n = counts.get(tier.band) ?? 0;
      const share = Math.round((n / results.length) * 100);
      const bar = '#'.repeat(Math.round(share / 2.5));
      console.log(`  ${tier.label.padEnd(13)} ${tier.band.padEnd(9)} ${String(n).padStart(3)}  ${String(share).padStart(3)}%  ${bar}`);
    }
    console.log('');
    console.log('A band that catches nothing on real listings is a band the user never sees.');
    console.log('');
    await pool.end();
  }
}
