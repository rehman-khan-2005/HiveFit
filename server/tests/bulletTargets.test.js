import test from 'node:test';
import assert from 'node:assert/strict';

import { bulletsWithTargets } from '../src/nlp/bulletTargets.js';
import { analyzeResume } from '../src/nlp/analyze.js';

const RESUME = `Jane Doe

SKILLS
Languages: Python, SQL
Developer Tools: Docker, Kubernetes, Git

EXPERIENCE
Data Engineer | Acme | 2023 - Present
- Built reporting pipelines that process 40,000 records per day
- Wrote SQL transformations and tuned warehouse query performance

PROJECTS
Ease-On | React, Node.js, PostgreSQL
- Developed a scheduling web app used by 300 students each semester
- Implemented session handling and role-based access for staff accounts
`;

const JOB = {
  id: 1,
  title: 'Full Stack Engineer',
  description: `Build React frontends and Node.js services backed by PostgreSQL.
    You will design REST APIs, tune database queries, and ship reporting features.
    Containerized deploys with Docker and Kubernetes. Strong communication and
    collaboration with product managers required.`,
};

function targetsFor() {
  const result = analyzeResume({ resumeText: RESUME, jobs: [JOB] }).results[0];
  return bulletsWithTargets({
    resumeText: RESUME,
    jobDescription: JOB.description,
    candidates: [...result.prioritizedGap, ...result.underhighlighted],
  });
}

test('each bullet gets its own set of terms', () => {
  const bullets = targetsFor();
  const sets = bullets.map((b) => b.targets.map((t) => t.term).sort().join(','));

  assert.ok(bullets.length >= 4, `expected several bullets, got ${bullets.length}`);
  assert.ok(
    new Set(sets).size > 1,
    'if every bullet offers the same terms there is no reason to pick one'
  );
});

test('a term the bullet already contains is never offered', () => {
  for (const bullet of targetsFor()) {
    const text = bullet.text.toLowerCase();
    for (const target of bullet.targets) {
      assert.ok(
        !text.includes(target.term.toLowerCase()),
        `"${target.term}" is already in: ${bullet.text}`
      );
    }
  }
});

test("a term the bullet's own entry declares outranks everything else", () => {
  const easeOn = targetsFor().filter((b) => b.entryTitle === 'Ease-On');
  assert.ok(easeOn.length > 0, 'the Ease-On entry should have bullets');

  for (const bullet of easeOn) {
    const entryTargets = bullet.targets.filter((t) => t.evidence === 'entry');
    if (entryTargets.length === 0) continue;
    // Whatever the entry declares must sort above anything it does not.
    const firstOther = bullet.targets.findIndex((t) => t.evidence !== 'entry');
    const lastEntry = bullet.targets.map((t) => t.evidence).lastIndexOf('entry');
    if (firstOther !== -1) assert.ok(lastEntry < firstOther, bullet.targets.map((t) => `${t.term}:${t.evidence}`).join(' '));
  }
});

test('the Ease-On bullets are offered that project\'s own stack', () => {
  const easeOn = targetsFor().filter((b) => b.entryTitle === 'Ease-On');
  const offered = new Set(easeOn.flatMap((b) => b.targets.map((t) => t.term.toLowerCase())));

  // React and PostgreSQL are in that project's stack and wanted by the posting,
  // but neither bullet says them — the exact case this ranking exists for.
  assert.ok(
    offered.has('react') || offered.has('postgresql'),
    `expected the project stack to surface, got: ${[...offered].join(', ')}`
  );
});

test('every target explains why it was offered for this bullet', () => {
  for (const bullet of targetsFor()) {
    for (const target of bullet.targets) {
      assert.ok(target.reason && target.reason.length > 0, `${target.term} has no reason`);
      assert.ok(['entry', 'resume', 'new'].includes(target.evidence));
    }
  }
});

test('bullets carry the entry context needed to group them', () => {
  const bullets = targetsFor();
  const acme = bullets.find((b) => b.text.includes('reporting pipelines'));
  const ease = bullets.find((b) => b.text.includes('scheduling web app'));

  assert.equal(acme.entryTitle, 'Data Engineer');
  assert.equal(ease.entryTitle, 'Ease-On');
  assert.deepEqual(ease.entryTech, ['React', 'Node.js', 'PostgreSQL']);
});

test('nameable skills are offered ahead of posting vocabulary', () => {
  for (const bullet of targetsFor()) {
    const skillFlags = bullet.targets.map((t) => t.isSkill);
    const firstNonSkill = skillFlags.indexOf(false);
    if (firstNonSkill === -1) continue;
    assert.ok(
      !skillFlags.slice(firstNonSkill).includes(true),
      `"add essential to this bullet" is not advice: ${bullet.targets.map((t) => t.term).join(', ')}`
    );
  }
});

test('a resume with no candidates degrades quietly', () => {
  const bullets = bulletsWithTargets({
    resumeText: RESUME, jobDescription: JOB.description, candidates: [],
  });
  assert.ok(bullets.length > 0, 'bullets still come back');
  assert.ok(bullets.every((b) => Array.isArray(b.targets)));
});
