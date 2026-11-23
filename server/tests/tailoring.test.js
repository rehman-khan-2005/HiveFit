import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeResume, scoreGuide } from '../src/nlp/analyze.js';
import { bulletsWithTargets } from '../src/nlp/bulletTargets.js';
import { tailoringPlan } from '../src/ai/tailoring.js';

// --- score bands, as agreed with the advisor on 12 November ---

test('the bands are 80 strong, 60 decent, 40 partial', () => {
  const guide = scoreGuide();
  assert.deepEqual(guide.map((g) => g.band), ['strong', 'moderate', 'weak', 'poor']);
  assert.deepEqual(guide.map((g) => g.floor), [80, 60, 40, 0]);
  assert.equal(guide[0].label, '80 and above');
  assert.equal(guide[1].label, '60–80');
});

test('every band explains itself and says what to do', () => {
  for (const tier of scoreGuide()) {
    assert.ok(tier.message.length > 20, `${tier.band} message too thin`);
    assert.ok(tier.guidance.length > 20, `${tier.band} has no guidance`);
  }
});

test('the ranges tile without gaps or overlap', () => {
  // A score must land in exactly one band, or the legend lies.
  const guide = scoreGuide();
  for (const score of [0, 39, 40, 59, 60, 79, 80, 100]) {
    const matches = guide.filter((t) => score >= t.floor && (t.ceiling >= 100 ? score <= 100 : score < t.ceiling));
    assert.equal(matches.length, 1, `score ${score} matched ${matches.length} bands`);
  }
});

test('a perfect score stays reachable', () => {
  // The advisor asked that 100 remain possible when justified, just rare.
  const resume = 'Engineer\n• Built Python services on AWS with Docker and PostgreSQL daily';
  const { results } = analyzeResume({
    resumeText: resume,
    jobs: [{ id: 1, description: 'Python AWS Docker PostgreSQL.' }],
  });
  assert.equal(results[0].score, 100);
  assert.equal(results[0].verdict.band, 'strong');
});

test('a verdict carries guidance, not just a label', () => {
  const { results } = analyzeResume({
    resumeText: 'Engineer\n• Wrote Python services handling 40,000 requests a day',
    jobs: [{ id: 1, description: 'Registered nurse, pediatric ward, BLS required.' }],
  });
  assert.equal(results[0].verdict.band, 'poor');
  assert.match(results[0].verdict.guidance, /stronger matches/i);
});

// --- the tailoring plan ---

const RESUME = `Jane Doe

SKILLS
Languages: Python, SQL
Developer Tools: Docker, Kubernetes, Git

EXPERIENCE
Data Engineer | Acme | 2023 - Present
- Responsible for reporting pipelines across the analytics stack
- Wrote SQL transformations and tuned warehouse query performance

PROJECTS
Ease-On | React, Node.js, PostgreSQL
- Developed a scheduling web app used by 300 students each semester
`;

const JOB = {
  id: 1,
  title: 'Platform Engineer',
  description: `Kubernetes and Docker in production, Python automation, PostgreSQL,
    Terraform infrastructure, Kafka streaming, and strong communication.`,
};

function planFor() {
  const result = analyzeResume({ resumeText: RESUME, jobs: [JOB] }).results[0];
  const bullets = bulletsWithTargets({
    resumeText: RESUME,
    jobDescription: JOB.description,
    candidates: [...result.prioritizedGap, ...result.underhighlighted],
  });
  return tailoringPlan({
    underhighlighted: result.underhighlighted,
    prioritizedGap: result.prioritizedGap,
    bullets,
    verdict: result.verdict,
  });
}

test('free changes are ordered ahead of everything else', () => {
  // Surfacing a skill already on the page costs nothing and risks nothing, so
  // it must never sort below a step that asks the user to claim something.
  const { steps } = planFor();
  const ranks = { free: 0, low: 1, asks: 2, accept: 3 };
  const sequence = steps.map((s) => ranks[s.effort]);
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b),
    steps.map((s) => `${s.effort}:${s.title}`).join(' | '));
});

test('a buried skill becomes a step naming where to put it', () => {
  const { steps } = planFor();
  const surface = steps.filter((s) => s.kind === 'surface');
  assert.ok(surface.length > 0, 'Kubernetes is on the Skills line and nowhere else');
  for (const step of surface) {
    assert.ok(step.terms.length > 0);
    assert.equal(step.effort, 'free');
  }
});

test('a weak opener is flagged as a rewrite, not a new claim', () => {
  const { steps } = planFor();
  const structural = steps.find((s) => s.kind === 'structure');
  assert.ok(structural, 'the Acme bullet opens with "Responsible for"');
  assert.equal(structural.effort, 'low');
  assert.ok(structural.bullet, 'a structural step has to name the sentence');
});

test('gaps are offered as a question, never as an instruction', () => {
  const { steps } = planFor();
  const confirm = steps.find((s) => s.kind === 'confirm');
  if (confirm) {
    assert.equal(confirm.effort, 'asks');
    assert.match(confirm.why, /if you have|describe it|nothing is added/i);
    // It must not read as "add Terraform to your resume".
    assert.doesNotMatch(confirm.title, /^add /i);
  }
});

test('only nameable skills reach the plan', () => {
  // The scoring lists legitimately include stems like "languages" (picked up
  // from "natural language processing") and "systems" (from "distributed
  // systems"). Counting them is right; instructing the user to "work languages
  // into your bullet" is not.
  const junk = /^(essential|strong|build|maintain|experience|languages?|systems?|learn|units?|excellence|products?|process)$/i;
  for (const step of planFor().steps) {
    for (const term of step.terms) {
      assert.doesNotMatch(term, junk, `"${term}" is not actionable advice`);
    }
  }
});

test('the summary leads with what is free when anything is', () => {
  const { summary, steps } = planFor();
  const free = steps.filter((s) => s.effort === 'free').length;
  if (free > 0) assert.match(summary, /nothing|already on your resume/i);
});

test('an empty analysis produces a plan rather than throwing', () => {
  const plan = tailoringPlan({});
  assert.ok(typeof plan.summary === 'string' && plan.summary.length > 0);
  assert.deepEqual(plan.steps, []);
});
