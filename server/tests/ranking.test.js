import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeResume } from '../src/nlp/analyze.js';

const RESUME = `Jane Doe

SKILLS
Languages: Python, SQL
Developer Tools: Docker, Git

EXPERIENCE
Backend Engineer | Acme | 2023 - Present
- Built Python services handling 40,000 requests per day on AWS
- Optimized PostgreSQL queries and cut p95 latency by 60%
`;

const JOBS = [
  { id: 1, title: 'Graphic Designer', description: 'Illustrator, Photoshop, typography, branding, print layout and colour theory.' },
  { id: 2, title: 'Backend Engineer', description: 'Python backend services, PostgreSQL, AWS, REST APIs, latency optimization.' },
  { id: 3, title: 'Data Analyst', description: 'SQL reporting, dashboards, stakeholder communication, Excel and forecasting.' },
];

test('results come back ranked best match first', () => {
  const { results } = analyzeResume({ resumeText: RESUME, jobs: JOBS });

  const scores = results.map((r) => r.score);
  const descending = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, descending, `expected descending scores, got ${scores.join(', ')}`);

  // The posting the resume actually matches should not be buried mid-list
  // just because the caller passed it second.
  assert.equal(results[0].title, 'Backend Engineer');
});

test('every result carries its rank', () => {
  const { results } = analyzeResume({ resumeText: RESUME, jobs: JOBS });
  assert.deepEqual(results.map((r) => r.rank), [1, 2, 3]);
});

test('ranking is stable regardless of the order postings are supplied in', () => {
  const forward = analyzeResume({ resumeText: RESUME, jobs: JOBS });
  const reversed = analyzeResume({ resumeText: RESUME, jobs: [...JOBS].reverse() });

  assert.deepEqual(
    forward.results.map((r) => r.title),
    reversed.results.map((r) => r.title),
    'the same pool should rank the same way whichever order it arrives in'
  );
});

test('identically scoring postings do not shuffle between runs', () => {
  const twins = [
    { id: 1, title: 'B Posting', description: 'Python PostgreSQL AWS latency optimization.' },
    { id: 2, title: 'A Posting', description: 'Python PostgreSQL AWS latency optimization.' },
  ];
  const first = analyzeResume({ resumeText: RESUME, jobs: twins }).results.map((r) => r.title);
  const second = analyzeResume({ resumeText: RESUME, jobs: [...twins].reverse() }).results.map((r) => r.title);

  assert.deepEqual(first, second);
  assert.equal(first[0], 'A Posting', 'ties should break on title, not input order');
});

test('the comparison block agrees with the ranking', () => {
  const { results, comparison } = analyzeResume({ resumeText: RESUME, jobs: JOBS });

  assert.equal(comparison.bestScore, results[0].score);
  assert.equal(comparison.worstScore, results[results.length - 1].score);
  assert.equal(comparison.bestMatch.title, results[0].title);
});
