// Keyword visibility: the skill is on the resume, spelled so that a literal
// recruiter search misses it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { preprocess } from '../src/nlp/tokenize.js';
import { keywordVisibility, summarizeKeywordVisibility } from '../src/nlp/keywords.js';
import { aliasGroupFor, aliasGroups } from '../src/nlp/aliases.js';

const doc = (text) => preprocess(text);

function run(resumeText, postingTexts) {
  const resume = doc(resumeText);
  return keywordVisibility({
    resumeTokens: resume.tokens,
    resumeSurface: resume.surface,
    jobDocs: postingTexts.map(doc),
  });
}

test('shorthand on the resume against the formal spelling in the postings', () => {
  const found = run('Deployed with k8s and stored data in Postgres.', [
    'Kubernetes and PostgreSQL required.',
    'Experience with Kubernetes.',
    'Kubernetes, PostgreSQL, Go.',
  ]);

  const kubernetes = found.missingSpellings.find((m) => m.skill === 'Kubernetes');
  assert.equal(kubernetes.yours, 'k8s');
  assert.equal(kubernetes.theirs, 'Kubernetes', 'the formal spelling, capitalized as typed');
  assert.equal(kubernetes.postings, 3);
});

test('the advice adds a spelling, never replaces one', () => {
  const found = run('Built with k8s.', ['Kubernetes required.']);
  // Both belong on the page: the formal one for the search, the shorthand for
  // the engineer reading it. Telling the user to drop "k8s" would be worse.
  assert.match(found.missingSpellings[0].action, /as well as/);
  assert.match(found.missingSpellings[0].action, /k8s/);
});

test('a skill the resume does not claim is left alone', () => {
  const found = run('I write Python.', ['Kubernetes required.', 'Kubernetes and Go.']);
  // This is a gap, not a spelling problem. Suggesting "also write Kubernetes"
  // to someone who has never used it is advice to lie.
  assert.equal(found.missingSpellings.length, 0);
});

test('a skill no posting searched for raises nothing', () => {
  const found = run('Expert in k8s.', ['We need strong Python.']);
  assert.equal(found.missingSpellings.length, 0, 'no employer here typed either spelling');
});

test('a resume already using the formal spelling is reported as searchable', () => {
  const found = run('Kubernetes in production.', ['Kubernetes required.', 'Kubernetes.']);
  assert.equal(found.missingSpellings.length, 0);
  assert.equal(found.searchable[0].skill, 'Kubernetes');
  assert.equal(found.searchable[0].postings, 2);
});

test('most-searched spelling comes first', () => {
  const found = run('k8s, Postgres, JS', [
    'JavaScript, PostgreSQL, Kubernetes',
    'JavaScript and PostgreSQL',
    'JavaScript only',
  ]);
  assert.equal(found.missingSpellings[0].skill, 'JavaScript', '3 postings beat 2 and 1');
  assert.ok(
    found.missingSpellings.every((m, i, all) => i === 0 || all[i - 1].postings >= m.postings),
    'sorted by how many postings use the spelling'
  );
});

test('one line per skill, not one per variant', () => {
  // "postgres", "psql" and "postgre" are all the same skill. Three rows about
  // PostgreSQL is the information overload this is meant to reduce.
  const found = run('Used postgres and psql daily.', [
    'PostgreSQL required.', 'PostgreSQL and Redis.',
  ]);
  assert.equal(found.missingSpellings.filter((m) => m.skill === 'PostgreSQL').length, 1);
});

test('nothing to say returns null rather than a reassuring sentence', () => {
  const clean = run('Kubernetes and PostgreSQL.', ['Kubernetes and PostgreSQL.']);
  assert.equal(summarizeKeywordVisibility(clean), null,
    'a section that always renders is a section the user learns to skip');
});

test('the summary names the count, the spelling and the consequence', () => {
  const found = run('k8s', ['Kubernetes', 'Kubernetes']);
  const line = summarizeKeywordVisibility(found);
  assert.match(line, /2 of the 2 postings/);
  assert.match(line, /"Kubernetes"/);
  assert.match(line, /"k8s"/);
  assert.match(line, /does not find you/);
});

test('shorthand and formal spellings resolve to the same group', () => {
  for (const [short, formal] of [['k8s', 'kubernetes'], ['js', 'javascript'], ['postgres', 'postgresql']]) {
    const a = aliasGroupFor(preprocess(short).tokens[0], preprocess);
    const b = aliasGroupFor(preprocess(formal).tokens[0], preprocess);
    assert.ok(a && b, `${short}/${formal} are both known`);
    assert.equal(a.canonical, b.canonical, `${short} and ${formal} are the same skill`);
  }
});

test('an unknown term belongs to no group', () => {
  assert.equal(aliasGroupFor(preprocess('widget').tokens[0], preprocess), null);
});

test('no alias group claims two different skills are the same', () => {
  // A wrong grouping would tell the user to write a skill they do not have.
  const seen = new Map();
  for (const { canonical, shorthand } of aliasGroups()) {
    for (const spelling of [canonical, ...shorthand]) {
      const key = spelling.toLowerCase();
      assert.ok(!seen.has(key), `"${spelling}" is claimed by both ${seen.get(key)} and ${canonical}`);
      seen.set(key, canonical);
    }
  }
});
