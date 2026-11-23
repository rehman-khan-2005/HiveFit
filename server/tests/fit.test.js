// Relative fit bands exist because the absolute ones were measured and found
// unreachable. These tests pin the properties that made them necessary.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bandByFit, fitSummary, FIT_BANDS, SCORE_REALITY } from '../src/nlp/fit.js';

const scored = (...scores) => scores.map((score, i) => ({ score, title: `Job ${i}` }));

test('a set is banded against its own best, not against 100', () => {
  // Every score here is in the bottom absolute band, which is where real
  // listings live. The set still separates into something useful.
  const banded = bandByFit(scored(34, 30, 20, 12, 4));

  assert.equal(banded[0].fit.tone, 'green', 'the best of the set is green');
  assert.equal(banded[1].fit.tone, 'green', '88% of the best is still close');
  assert.equal(banded[2].fit.tone, 'amber');
  assert.equal(banded[4].fit.tone, 'grey');
});

test('one posting gets no band', () => {
  // Calling a single posting the closest match of one is a tautology, and
  // rendering it as a green badge would read as an endorsement.
  const [only] = bandByFit(scored(34));
  assert.equal(only.fit, null);
});

test('a set of zeroes does not invent a winner', () => {
  const banded = bandByFit(scored(0, 0, 0));
  for (const result of banded) {
    assert.equal(result.fit.tone, 'grey');
    assert.match(result.fit.message, /share meaningful vocabulary/);
  }
});

test('the band says what it is relative to', () => {
  const banded = bandByFit(scored(40, 10));
  // Without this the user reads a green badge as "this job is a good match"
  // rather than "this is the best of the twelve you picked".
  assert.equal(banded[0].fit.comparedWith, 2);
  assert.equal(banded[0].fit.ratio, 100);
  assert.equal(banded[1].fit.ratio, 25);
});

test('identical scores all band the same way', () => {
  const banded = bandByFit(scored(20, 20, 20));
  const tones = new Set(banded.map((r) => r.fit.tone));
  assert.deepEqual([...tones], ['green'], 'a tie is not broken by the banding');
});

test('the summary counts what the interface offers to hide', () => {
  const summary = fitSummary(bandByFit(scored(34, 30, 20, 12, 4)));
  assert.deepEqual(
    summary.map((b) => [b.band, b.count]),
    [['close', 2], ['near', 1], ['far', 2]]
  );
});

test('a single posting contributes to no band count', () => {
  const summary = fitSummary(bandByFit(scored(34)));
  assert.deepEqual(summary.map((b) => b.count), [0, 0, 0]);
});

test('every band has a tone and a message the UI can render', () => {
  for (const band of FIT_BANDS) {
    assert.ok(['green', 'amber', 'grey'].includes(band.tone), `${band.band} has a known tone`);
    assert.ok(band.label.length > 0);
    assert.ok(band.message.length > 0);
  }
});

test('the measured reality of the percentage ships with the analysis', () => {
  // The caveat travels with the number so the two cannot drift apart, and it
  // names the command that reproduces it rather than asserting a figure.
  assert.match(SCORE_REALITY.measured, /median/);
  assert.match(SCORE_REALITY.reproduce, /npm run calibrate/);
});
