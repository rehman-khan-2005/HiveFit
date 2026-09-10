import test from 'node:test';
import assert from 'node:assert/strict';

import { preprocess, termFrequency, bigrams } from '../src/nlp/tokenize.js';
import { stem } from '../src/nlp/stemmer.js';
import { TfidfVectorizer } from '../src/nlp/tfidf.js';
import { cosineSimilarity, compatibilityScore, requirementCoverage } from '../src/nlp/similarity.js';
import { categorize, isKnownSkill } from '../src/nlp/categories.js';
import { analyzeKeywordGap } from '../src/nlp/keywordGap.js';
import { extractBullets, looksLikeResume } from '../src/nlp/parse.js';

test('stemmer collapses an inflection family to one stem', () => {
  const forms = ['develop', 'develops', 'developed', 'developing', 'developer'];
  const stems = new Set(forms.map(stem));
  assert.equal(stems.size, 1, `expected one stem, got ${[...stems].join(', ')}`);
});

test('stemmer leaves short and irregular tokens alone', () => {
  assert.equal(stem('go'), 'go');
  assert.equal(stem('python'), 'python');
});

test('preprocess protects punctuated technical terms', () => {
  const { tokens, surface } = preprocess('Experienced in C++, Node.js and CI/CD.');
  assert.ok(tokens.includes('cplusplus'), 'C++ should survive tokenizing');
  assert.ok(tokens.includes('nodejs'), 'Node.js should survive tokenizing');
  assert.ok(tokens.includes('cicd'), 'CI/CD should survive tokenizing');
  // And map back to something a human can read.
  assert.equal(surface.get('cplusplus'), 'c++');
  assert.equal(surface.get('cicd'), 'ci/cd');
});

test('preprocess removes stop words and bare numbers', () => {
  const { tokens } = preprocess('The candidate will be responsible for 12345 things');
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('will'));
  assert.ok(!tokens.includes('candid'), 'resume boilerplate should be filtered');
  assert.ok(!tokens.some((t) => /^\d+$/.test(t)), 'bare numbers carry no skill signal');
});

test('preprocess is stable on empty and null input', () => {
  for (const input of ['', null, undefined, '   ']) {
    const { tokens } = preprocess(input);
    assert.deepEqual(tokens, []);
  }
});

test('termFrequency and bigrams behave', () => {
  const tf = termFrequency(['a', 'b', 'a']);
  assert.equal(tf.get('a'), 2);
  assert.deepEqual(bigrams(['machine', 'learning', 'model']), ['machine learning', 'learning model']);
});

test('idf weights a rare term above a common one', () => {
  const v = new TfidfVectorizer();
  v.fit([['sql', 'python'], ['sql', 'java'], ['sql', 'ruby'], ['sql', 'kubernetes']]);
  assert.ok(v.idfFor('kubernetes') > v.idfFor('sql'), 'rarer term must carry more weight');
});

test('tfidf vectors are L2-normalized', () => {
  const v = new TfidfVectorizer().fit([['a', 'b'], ['b', 'c'], ['c', 'd']]);
  const vec = v.transform(['a', 'b', 'b']);
  let norm = 0;
  for (const w of vec.values()) norm += w * w;
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-9, 'vector should have unit length');
});

test('cosine similarity respects its boundary cases', () => {
  const v = new TfidfVectorizer().fit([['a', 'b'], ['c', 'd'], ['a', 'c']]);
  const a = v.transform(['a', 'b']);
  const c = v.transform(['c', 'd']);
  assert.equal(compatibilityScore(a, a), 100, 'identical documents score 100');
  assert.equal(compatibilityScore(a, c), 0, 'disjoint documents score 0');
  assert.equal(cosineSimilarity(new Map(), a), 0, 'empty vector scores 0');
});

test('requirementCoverage measures recall over the posting, not symmetry', () => {
  const v = new TfidfVectorizer().fit([['python', 'sql', 'docker'], ['java'], ['ruby']]);
  const job = v.transform(['python', 'sql', 'docker']);

  // A resume containing every posting term plus unrelated extras still covers
  // the posting completely -- this is the asymmetry cosine cannot express.
  const full = new Set(['python', 'sql', 'docker', 'guitar', 'baking', 'latin']);
  assert.equal(requirementCoverage(job, full), 100);

  assert.equal(requirementCoverage(job, new Set()), 0);
});

test('requirementCoverage honours a term filter', () => {
  const v = new TfidfVectorizer().fit([['python', 'zzzjargon'], ['java']]);
  const job = v.transform(['python', 'zzzjargon']);
  const resume = new Set(['python']);
  // Filtered to recognized skills, the unknown jargon term is not counted.
  assert.equal(requirementCoverage(job, resume, isKnownSkill), 100);
  assert.ok(requirementCoverage(job, resume) < 100, 'unfiltered coverage counts the jargon term');
});

test('taxonomy classifies terms into the report\'s four categories', () => {
  const expected = {
    python: 'technical', kubernetes: 'tools',
    communication: 'soft', sprint: 'role',
  };
  for (const [word, category] of Object.entries(expected)) {
    const { tokens } = preprocess(word);
    assert.equal(categorize(tokens[0]), category, `${word} should be ${category}`);
  }
});

test('unknown terms fall back to role-specific rather than being dropped', () => {
  assert.equal(categorize('zzzunknownterm'), 'role');
  assert.equal(isKnownSkill('zzzunknownterm'), false);
});

test('keyword gap category weights sum to 100 percent', () => {
  const v = new TfidfVectorizer().fit([
    ['python', 'docker', 'communication', 'sprint'],
    ['java', 'aws'], ['ruby', 'agile'],
  ]);
  const job = v.transform(['python', 'docker', 'communication', 'sprint']);
  const { categories } = analyzeKeywordGap({
    jobVector: job, resumeTokens: ['python'], surface: new Map(),
  });
  const total = categories.reduce((sum, c) => sum + c.weightInPosting, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `category weights summed to ${total}, expected 100`);
});

test('keyword gap reports covered terms as covered and missing as missing', () => {
  const v = new TfidfVectorizer().fit([['python', 'docker'], ['java'], ['ruby']]);
  const job = v.transform(['python', 'docker']);
  const { prioritized } = analyzeKeywordGap({
    jobVector: job, resumeTokens: ['python'], surface: new Map([['docker', 'Docker']]),
  });
  const terms = prioritized.map((p) => p.stem);
  assert.ok(terms.includes('docker'), 'missing term should be reported');
  assert.ok(!terms.includes('python'), 'covered term must not be reported as a gap');
  assert.equal(prioritized.find((p) => p.stem === 'docker').term, 'Docker', 'display spelling is used');
});

test('bullet extraction handles glyphs, wrapping, and headers', () => {
  const bullets = extractBullets(`EXPERIENCE
• Built a REST API in Node.js and Express serving many
  thousands of daily requests
- Migrated legacy queries to indexed MySQL tables
SKILLS`);
  assert.equal(bullets.length, 2);
  assert.ok(bullets[0].includes('thousands of daily requests'), 'wrapped line should rejoin');
  assert.ok(!bullets.some((b) => b === 'EXPERIENCE' || b === 'SKILLS'), 'headers are not bullets');
});

test('looksLikeResume distinguishes a resume from arbitrary prose', () => {
  assert.equal(looksLikeResume('Experience: built things. Education: a degree.').ok, true);
  assert.equal(looksLikeResume('The quick brown fox jumps over the lazy dog.').ok, false);
});
