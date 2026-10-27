import test from 'node:test';
import assert from 'node:assert/strict';

import { bm25, bm25Score } from '../src/nlp/bm25.js';
import { filterBySkills, filterByLocation, skillsInPool } from '../src/jobs/filters.js';

const idfFor = (term) => ({ python: 3, sql: 2, the: 0.1 }[term] ?? 1);
const base = { idfFor, averageDocumentLength: 10 };

test('BM25 saturates term frequency instead of counting linearly', () => {
  // The objection BM25 exists to answer: the eighth mention of a term is
  // worth far less than the second, which plain TF-IDF does not model.
  const two = bm25({ documentTokens: ['python', 'python'], queryTokens: ['python'], ...base });
  const eight = bm25({ documentTokens: Array(8).fill('python'), queryTokens: ['python'], ...base });

  assert.ok(eight > two, 'more mentions should still score higher');
  assert.ok(eight < two * 2, `saturation failed: 2x=${two}, 8x=${eight}`);
});

test('BM25 penalizes padding a resume with irrelevant text', () => {
  const tight = bm25({ documentTokens: ['python', 'sql'], queryTokens: ['python', 'sql'], ...base });
  const padded = bm25({
    documentTokens: ['python', 'sql', ...Array(60).fill('filler')],
    queryTokens: ['python', 'sql'],
    ...base,
  });
  assert.ok(padded < tight, `length normalization failed: tight=${tight}, padded=${padded}`);
});

test('a repeated requirement is still one requirement', () => {
  const once = bm25({ documentTokens: ['python'], queryTokens: ['python'], ...base });
  const thrice = bm25({ documentTokens: ['python'], queryTokens: ['python', 'python', 'python'], ...base });
  assert.equal(once, thrice, 'a posting repeating a term must not triple its weight');
});

test('BM25 weights a rare requirement above a common one', () => {
  const rare = bm25({ documentTokens: ['python'], queryTokens: ['python'], ...base });
  const common = bm25({ documentTokens: ['the'], queryTokens: ['the'], ...base });
  assert.ok(rare > common);
});

test('bm25Score is bounded 0-100 and reaches 100 only on a full match', () => {
  const perfect = bm25Score({ documentTokens: ['python', 'sql'], queryTokens: ['python', 'sql'], ...base });
  const partial = bm25Score({ documentTokens: ['python'], queryTokens: ['python', 'sql'], ...base });
  const none = bm25Score({ documentTokens: ['java'], queryTokens: ['python', 'sql'], ...base });

  assert.equal(perfect, 100);
  assert.ok(partial > 0 && partial < 100, `partial was ${partial}`);
  assert.equal(none, 0);
});

test('empty input scores zero rather than throwing', () => {
  assert.equal(bm25({ documentTokens: [], queryTokens: ['python'], ...base }), 0);
  assert.equal(bm25({ documentTokens: ['python'], queryTokens: [], ...base }), 0);
  assert.equal(bm25Score({ documentTokens: [], queryTokens: [], ...base }), 0);
});

// --- filtering, which is the other half of Li's overload concern ---

const JOBS = [
  { title: 'Backend Engineer', description: 'Python, PostgreSQL, Docker on AWS.', location: 'New York, NY' },
  { title: 'Frontend Engineer', description: 'React and TypeScript, CSS.', location: 'Remote - US' },
  { title: 'ML Engineer', description: 'PyTorch, Python, machine learning.', location: 'New York (Remote)' },
  { title: 'Reactive Systems Dev', description: 'Reactive streams in Scala.', location: 'Austin, TX' },
];

test('skill filtering stems both sides rather than matching substrings', () => {
  // "react" must not match "Reactive"/"reactive streams", and must match
  // whatever spelling the posting used.
  const react = filterBySkills(JOBS, ['react']).map((j) => j.title);
  assert.deepEqual(react, ['Frontend Engineer']);
});

test('skill filtering supports any and all', () => {
  assert.equal(filterBySkills(JOBS, ['python']).length, 2);
  assert.equal(filterBySkills(JOBS, ['python', 'docker'], 'all').length, 1);
  assert.equal(filterBySkills(JOBS, ['python', 'docker'], 'any').length, 2);
});

test('no skills given leaves the pool untouched', () => {
  assert.equal(filterBySkills(JOBS, []).length, JOBS.length);
  assert.equal(filterBySkills(JOBS, ['   ']).length, JOBS.length);
});

test('asking for remote finds it however the board phrased it', () => {
  const remote = filterByLocation(JOBS, 'remote').map((j) => j.title);
  assert.deepEqual(remote.sort(), ['Frontend Engineer', 'ML Engineer']);
});

test('a city match is a loose contains, so metro phrasings survive', () => {
  assert.equal(filterByLocation(JOBS, 'New York').length, 2);
  assert.equal(
    filterByLocation([{ title: 'X', description: '', location: 'Greater New York Area' }], 'new york').length,
    1
  );
});

test('the pool advertises only skills it actually asks for', () => {
  const skills = skillsInPool(JOBS);
  const terms = skills.map((s) => s.term);

  assert.ok(terms.includes('python'), `expected python in ${terms.join(', ')}`);
  assert.ok(skills.every((s) => s.postings > 0 && s.categoryLabel));
  // Posting vocabulary is not a skill anyone would filter on.
  assert.ok(!terms.includes('and'));
});

test('a skill is counted once per posting, not once per mention', () => {
  // Three postings, only one of which mentions Python — eight times. The
  // count has to read 1, not 8. (Three postings also keeps it under the
  // ubiquity ceiling, which would otherwise drop it from the menu.)
  const counted = skillsInPool([
    { title: 'Python Python', description: 'Python python python python python python.', location: '' },
    { title: 'Frontend Engineer', description: 'React and TypeScript.', location: '' },
    { title: 'Platform Engineer', description: 'Kubernetes and Terraform.', location: '' },
  ]).find((s) => s.term === 'python');

  assert.ok(counted, 'python should still be offered');
  assert.equal(counted.postings, 1);
});

test('filter options are recognizable technologies, not taxonomy fragments', () => {
  // The scoring taxonomy stores "machine learning" and "unit testing" as
  // space-separated words, so a naive slice of it offers "learn", "units" and
  // "excellence" as skills to filter by. A filter menu is curated instead.
  const pool = Array.from({ length: 10 }, (_, i) => ({
    title: i < 5 ? 'Backend Engineer' : 'ML Engineer',
    description: i < 5
      ? 'Python and Docker, unit testing, distributed systems, operational excellence.'
      : 'Machine learning with PyTorch, data science, computer vision programs.',
    location: '',
  }));

  const terms = skillsInPool(pool).map((s) => s.term);
  for (const fragment of ['learn', 'units', 'excellence', 'operational', 'vision', 'science', 'programs']) {
    assert.ok(!terms.includes(fragment), `"${fragment}" is not a skill anyone filters by`);
  }
  assert.ok(terms.includes('python') || terms.includes('pytorch'), `expected real tools, got ${terms.join(', ')}`);
});

test('a skill in nearly every posting is not offered as a filter', () => {
  // Narrowing by a term 10 of 10 postings mention returns 10 postings.
  const pool = Array.from({ length: 10 }, () => ({
    title: 'Engineer', description: 'Python required. Docker a plus.', location: '',
  }));
  pool[0].description = 'Python required. Docker a plus. Kubernetes too.';

  const terms = skillsInPool(pool).map((s) => s.term);
  assert.ok(!terms.includes('python'), 'python is in every posting and cannot discriminate');
  assert.ok(terms.includes('kubernetes'), `kubernetes narrows to 1 of 10; got ${terms.join(', ')}`);
});
