import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResume } from '../src/nlp/analyze.js';

const RESUME = `Software Engineering Intern
• Built REST APIs in Node.js and Express serving 10,000 daily requests
• Migrated legacy queries to indexed MySQL tables, cutting p95 latency by 40 percent
• Collaborated with designers to ship a React dashboard used by the support team
• Wrote unit tests and set up a CI/CD pipeline in GitHub Actions
Skills: JavaScript, Python, SQL, React, Node.js, Git, Linux`;

const POSTINGS = {
  mirror: `Developer to build REST APIs with Node.js and Express. Work with MySQL,
     ship React interfaces, write unit tests, maintain CI/CD pipelines with
     GitHub Actions. JavaScript and SQL required.`,
  adjacent: `Backend Engineer with strong Python and SQL. Design microservices,
     work with Docker and Kubernetes on AWS, optimize database queries,
     caching with Redis, distributed systems experience required.`,
  unrelated: `Registered Nurse for pediatric ward. Administer medication, monitor
     vitals, coordinate with physicians, maintain patient charts, BLS required.`,
};

function scoreAgainst(description) {
  const { results } = analyzeResume({
    resumeText: RESUME,
    jobs: [{ id: 1, description }],
    backgroundCorpus: Object.values(POSTINGS),
  });
  return results[0];
}

test('a posting rewritten from the resume scores as a strong match', () => {
  const r = scoreAgainst(POSTINGS.mirror);
  assert.ok(r.score >= 75, `expected >= 75, got ${r.score}`);
  assert.equal(r.verdict.band, 'strong');
});

test('an adjacent role scores materially lower than a matching one', () => {
  const mirror = scoreAgainst(POSTINGS.mirror);
  const adjacent = scoreAgainst(POSTINGS.adjacent);
  assert.ok(adjacent.score < mirror.score - 20,
    `adjacent (${adjacent.score}) should trail mirror (${mirror.score}) clearly`);
});

test('an unrelated field scores near zero', () => {
  const r = scoreAgainst(POSTINGS.unrelated);
  assert.ok(r.score < 15, `expected < 15, got ${r.score}`);
  assert.equal(r.verdict.band, 'poor');
});

test('scores and coverage stay inside 0-100', () => {
  for (const description of Object.values(POSTINGS)) {
    const r = scoreAgainst(description);
    for (const value of [r.score, r.overallCoverage, r.similarity]) {
      assert.ok(value >= 0 && value <= 100, `${value} out of range`);
    }
    for (const c of r.categories) {
      // null is the deliberate value for a category the posting never asks
      // about — see "an unmentioned category reports N/A" below.
      if (c.coverage === null) continue;
      assert.ok(c.coverage >= 0 && c.coverage <= 100, `coverage ${c.coverage} out of range`);
    }
  }
});

test('every category carries a plain-language explanation', () => {
  const r = scoreAgainst(POSTINGS.adjacent);
  assert.equal(r.categories.length, 4, 'the report specifies four categories');
  for (const c of r.categories) {
    assert.ok(c.explanation.length > 30, `${c.category} explanation is too thin`);
    assert.ok(c.label, 'category needs a human-readable label');
  }
});

test('multi-job comparison surfaces gaps that recur across the pool', () => {
  const out = analyzeResume({
    resumeText: RESUME,
    jobs: [
      { id: 1, title: 'A', description: POSTINGS.adjacent },
      { id: 2, title: 'B', description: POSTINGS.adjacent },
      { id: 3, title: 'C', description: POSTINGS.mirror },
    ],
  });

  assert.equal(out.comparison.postingsCompared, 3);
  assert.ok(out.comparison.bestScore >= out.comparison.worstScore);
  assert.ok(out.comparison.recurringGaps.length > 0, 'shared gaps should be detected');

  // Docker appears in both adjacent postings and in neither the resume nor
  // the mirror posting, so it must be reported as recurring.
  const recurring = out.comparison.recurringGaps.map((g) => g.term);
  assert.ok(recurring.some((t) => /docker/i.test(t)),
    `expected docker among recurring gaps, got: ${recurring.join(', ')}`);
});

test('best match is the highest-scoring posting', () => {
  const out = analyzeResume({
    resumeText: RESUME,
    jobs: [
      { id: 1, title: 'Unrelated', description: POSTINGS.unrelated },
      { id: 2, title: 'Mirror', description: POSTINGS.mirror },
    ],
  });
  assert.equal(out.comparison.bestMatch.jobId, 2);
  assert.equal(out.comparison.bestMatch.title, 'Mirror');
});

test('analyzeResume rejects empty input rather than scoring nothing', () => {
  assert.throws(() => analyzeResume({ resumeText: '', jobs: [{ description: 'x' }] }), /empty/i);
  assert.throws(() => analyzeResume({ resumeText: RESUME, jobs: [] }), /at least one/i);
});

test('resume bullets are extracted for Select-a-Bullet', () => {
  const out = analyzeResume({ resumeText: RESUME, jobs: [{ description: POSTINGS.mirror }] });
  assert.ok(out.resume.bulletCount >= 4, `expected >= 4 bullets, got ${out.resume.bulletCount}`);
  assert.ok(out.resume.bullets.every((b) => typeof b === 'string' && b.length > 0));
});
