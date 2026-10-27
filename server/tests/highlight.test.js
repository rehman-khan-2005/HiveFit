import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeResume } from '../src/nlp/analyze.js';
import { parseResume } from '../src/nlp/parse.js';
import { indexResume, placementOf, isHighlighted } from '../src/nlp/evidence.js';

// Kubernetes is claimed on the Skills line and nowhere else.
// Docker is declared in a project's tech stack, so that work demonstrably used it.
// Python is demonstrated in an accomplishment bullet.
// Terraform appears nowhere at all.
const RESUME = `Jane Doe

SKILLS
Languages: Python, SQL
Developer Tools: Docker, Kubernetes, Git

EXPERIENCE
Backend Engineer | Acme | 2023 - Present
- Built Python services handling 40,000 requests per day

PROJECTS
Ease-On | React, Node.js, Docker
- Developed a scheduling web app used by 300 students each semester
`;

const POSTING = {
  id: 1,
  title: 'Platform Engineer',
  description: `We need Kubernetes and Docker experience. You will write Python
    automation, manage Terraform infrastructure, and operate CI/CD pipelines.`,
};

function analyze() {
  return analyzeResume({ resumeText: RESUME, jobs: [POSTING] }).results[0];
}

test('a skill claimed only on the Skills line is reported as not highlighted', () => {
  const buried = analyze().underhighlighted.map((u) => u.term);
  assert.ok(buried.includes('kubernetes'), `expected kubernetes, got: ${buried.join(', ')}`);
});

test('a skill the entry stack declares is treated as already visible', () => {
  const buried = analyze().underhighlighted.map((u) => u.term);
  assert.ok(
    !buried.includes('docker'),
    'Docker sits in a project tech stack, which a recruiter reads — it is not buried'
  );
});

test('a skill demonstrated in a bullet is not reported', () => {
  const buried = analyze().underhighlighted.map((u) => u.term);
  assert.ok(!buried.includes('python'), 'Python is demonstrated in an accomplishment');
});

test('a skill the resume never claims is a gap, never a highlighting problem', () => {
  const result = analyze();
  const buried = result.underhighlighted.map((u) => u.term);
  const missing = result.prioritizedGap.map((g) => g.term);

  assert.ok(!buried.includes('terraform'), 'telling the user to surface a skill they lack would be fabrication');
  assert.ok(missing.includes('terraform'), 'it belongs in the keyword gap instead');
});

test('a buried skill says where it currently lives and what to do', () => {
  const item = analyze().underhighlighted.find((u) => u.term === 'kubernetes');

  assert.equal(item.placement, 'skills');
  assert.match(item.foundIn, /Skills line/i);
  assert.ok(item.action.length > 0, 'an item with no action is just another number');
  assert.ok(['critical', 'important', 'minor'].includes(item.importance));
});

test('candidate bullets prefer the entry whose stack already declares the term', () => {
  // Node.js is declared on the Ease-On project only, so a posting wanting it
  // should point at that project's bullet rather than the Acme one.
  const nodePosting = {
    id: 2,
    title: 'Node Developer',
    description: 'Node.js backend work, Express APIs, scheduling systems and REST endpoints.',
  };
  const result = analyzeResume({ resumeText: RESUME, jobs: [nodePosting] }).results[0];
  const item = result.underhighlighted.find((u) => u.term === 'node.js');

  if (item) {
    const confident = item.candidateBullets.filter((c) => c.confident);
    for (const candidate of confident) {
      assert.match(candidate.text, /scheduling web app/, 'confident candidates must come from the declaring entry');
    }
  }
});

test('a resume with everything demonstrated reports nothing to highlight', () => {
  const strong = `Jane Doe

EXPERIENCE
Engineer | Acme | 2023 - Present
- Built Python services on Kubernetes handling 40,000 requests per day
`;
  const result = analyzeResume({ resumeText: strong, jobs: [POSTING] }).results[0];
  const buried = result.underhighlighted.map((u) => u.term);

  assert.ok(!buried.includes('kubernetes'));
  assert.ok(!buried.includes('python'));
});

test('summary is null when there is nothing to say', () => {
  const clean = analyzeResume({
    resumeText: 'Jane Doe\n\nEXPERIENCE\nEngineer | Acme\n- Wrote Python code for data pipelines daily\n',
    jobs: [{ id: 9, title: 'X', description: 'Python data pipelines.' }],
  }).results[0];

  assert.equal(clean.underhighlighted.length, 0);
  assert.equal(clean.underhighlightedSummary, null);
});

test('recurring buried skills are surfaced across the pool', () => {
  const postings = [
    { id: 1, title: 'A', description: 'Kubernetes orchestration and container scheduling.' },
    { id: 2, title: 'B', description: 'Kubernetes clusters, deployments and service meshes.' },
    { id: 3, title: 'C', description: 'Kubernetes operations and cluster autoscaling.' },
  ];
  const { comparison } = analyzeResume({ resumeText: RESUME, jobs: postings });
  const recurring = comparison.recurringUnderhighlighted.find((r) => r.term === 'kubernetes');

  assert.ok(recurring, 'a skill buried across the whole pool is the highest-value fix there is');
  assert.equal(recurring.appearsInPostings, 3);
  assert.match(recurring.coverage, /3 of 3/);
});

test('placement tiers rank bullet evidence above a skills-line claim', () => {
  const parsed = parseResume(RESUME);
  const index = indexResume(parsed);

  assert.equal(placementOf('python', index), 'bullet');
  assert.equal(placementOf('kubernet', index), 'skills');
  assert.equal(placementOf('terraform', index), null);

  assert.ok(isHighlighted('bullet'));
  assert.ok(isHighlighted('entry'));
  assert.ok(!isHighlighted('skills'), 'a Skills line is a claim, not a demonstration');
});
