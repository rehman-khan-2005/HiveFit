import test from 'node:test';
import assert from 'node:assert/strict';

import { calibrate, formatCalibration } from '../src/nlp/calibration.js';
import { analyzeResume } from '../src/nlp/analyze.js';
import { REFERENCE_RESUME as RESUME, REFERENCE_PAIRS as PAIRS } from '../src/nlp/reference-pairs.js';

test('the headline score ranks the reference ladder correctly', () => {
  const { metrics } = calibrate({ resume: RESUME, pairs: PAIRS });
  const headline = metrics.find((m) => m.key === 'score');

  assert.ok(headline.ordering, 'the headline score must not rank a worse match above a better one');
  assert.ok(headline.margin > 0, `every tier must be separated, tightest margin was ${headline.margin}`);
});

test('the headline score separates the ladder more widely than cosine', () => {
  // This is the measured answer to "is a keyword score naive?" — cosine is
  // the textbook document-similarity metric and it compresses everything into
  // a narrow band, which is why it is not the number the user is shown.
  const { metrics } = calibrate({ resume: RESUME, pairs: PAIRS });
  const headline = metrics.find((m) => m.key === 'score');
  const cosine = metrics.find((m) => m.key === 'similarity');

  assert.ok(
    headline.spread > cosine.spread,
    `headline spread ${headline.spread} should exceed cosine ${cosine.spread}`
  );
});

test('BM25 is computed and ranks the ladder as sanely as the headline', () => {
  const { metrics, rows } = calibrate({ resume: RESUME, pairs: PAIRS });
  const bm25 = metrics.find((m) => m.key === 'retrieval');

  assert.ok(rows.every((r) => typeof r.retrieval === 'number'), 'every pair needs a BM25 reading');
  assert.ok(bm25.ordering, `BM25 mis-ranked the ladder (margin ${bm25.margin})`);
});

test('every metric stays on 0-100 so the three can be compared', () => {
  const { rows } = calibrate({ resume: RESUME, pairs: PAIRS });
  for (const row of rows) {
    for (const key of ['score', 'retrieval', 'similarity']) {
      assert.ok(row[key] >= 0 && row[key] <= 100, `${row.label} ${key} = ${row[key]}`);
    }
  }
});

test('an unmentioned category reports N/A rather than a perfect score', () => {
  // Li's point: a resume shown "Soft Skills 100%" on a posting that asked for
  // none reads as a result, when it is the absence of one.
  const { results } = analyzeResume({
    resumeText: 'Engineer\n• Wrote Python services handling 40,000 requests per day',
    jobs: [{ id: 1, description: 'Python, SQL, Docker, Kubernetes, Terraform, Redis, Kafka.' }],
  });

  const empty = results[0].categories.filter((c) => c.termsRequired === 0);
  assert.ok(empty.length > 0, 'this posting should leave at least one category unmentioned');
  for (const category of empty) {
    assert.equal(category.coverage, null, `${category.label} should report null, not a number`);
    assert.equal(category.applicable, false);
    assert.match(category.explanation, /not applicable rather than perfect/i);
  }
});

test('the calibration table renders for pasting into a report', () => {
  const report = formatCalibration(calibrate({ resume: RESUME, pairs: PAIRS }));
  assert.match(report, /rewritten from resume/);
  assert.match(report, /BM25 retrieval/);
  assert.match(report, /ordering/);
});
