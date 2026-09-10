import test from 'node:test';
import assert from 'node:assert/strict';

import {
  suggestForBullet, classifyTerms, critiqueBullet, buildGapQuestion,
} from '../src/ai/suggest.js';
import { heuristicProvider, getProvider } from '../src/ai/provider.js';

const BULLET = 'Responsible for working on the API and fixing bugs';

// A provider that writes whatever it is told to. Used to prove the honesty
// constraint lives in suggestForBullet and not in the provider's good manners:
// even a maximally credulous backend cannot be handed an unevidenced term.
const leakyProvider = {
  name: 'leaky',
  async rewrite({ writable }) {
    return `REWRITE_WITH[${writable.join('|')}]`;
  },
};

test('classifyTerms separates evidenced from unsupported terms', () => {
  const { evidenced, unsupported } = classifyTerms(BULLET, ['API', 'Kubernetes']);
  assert.deepEqual(evidenced, ['API']);
  assert.deepEqual(unsupported, ['Kubernetes']);
});

test('classifyTerms requires every word of a multi-word term', () => {
  const bullet = 'Trained a machine model on user data';
  const { unsupported } = classifyTerms(bullet, ['machine learning']);
  assert.deepEqual(unsupported, ['machine learning'],
    '"machine" alone must not count as evidence for "machine learning"');
});

test('an unevidenced term produces a question and no rewrite', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: ['Kubernetes'],
    jobTitle: 'Backend Engineer', provider: heuristicProvider,
  });
  assert.equal(result.status, 'needs_input');
  assert.equal(result.suggested, null, 'must not write a bullet it cannot support');
  assert.match(result.question, /Kubernetes/);
  assert.deepEqual(result.termsAddressed, []);
});

test('the provider is never handed an unevidenced term', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: ['Kubernetes', 'Terraform'], provider: leakyProvider,
  });
  // Nothing was writable, so the provider was never reached at all.
  assert.equal(result.status, 'needs_input');
  assert.equal(result.suggested, null);
});

test('a mixed request writes only the evidenced half', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: ['API', 'Kubernetes'], provider: leakyProvider,
  });
  assert.equal(result.status, 'suggested');
  assert.equal(result.suggested, 'REWRITE_WITH[API]',
    'Kubernetes must not reach the provider');
  assert.deepEqual(result.termsRequiringConfirmation, ['Kubernetes']);
  assert.match(result.question, /Kubernetes/, 'the open gap is still surfaced');
});

test('user-confirmed experience unlocks a term', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: ['Kubernetes'], provider: leakyProvider,
    userEvidence: 'I ran our staging cluster on Kubernetes for a year',
  });
  assert.equal(result.status, 'suggested');
  assert.equal(result.suggested, 'REWRITE_WITH[Kubernetes]');
  assert.deepEqual(result.termsRequiringConfirmation, []);
});

test('vague confirmation does not unlock a term', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: ['Kubernetes'], provider: leakyProvider,
    userEvidence: 'I think I have used something like that before',
  });
  assert.equal(result.status, 'needs_input',
    'an answer that never names the skill is not evidence for it');
  assert.equal(result.suggested, null);
});

test('a bullet with no target terms is still improved structurally', async () => {
  const result = await suggestForBullet({
    bullet: BULLET, targetTerms: [], provider: heuristicProvider,
  });
  assert.equal(result.status, 'suggested');
  assert.notEqual(result.suggested, BULLET, 'weak opener should be replaced');
  assert.match(result.rationale, /no new skill claims/i);
});

test('the heuristic rewriter never invents a metric', async () => {
  const result = await suggestForBullet({
    bullet: 'Worked on the deployment pipeline', targetTerms: [], provider: heuristicProvider,
  });
  // It marks where a number belongs rather than supplying one.
  assert.match(result.suggested, /add a number here/i);
  assert.ok(!/\b\d+%/.test(result.suggested), 'no fabricated percentage');
});

test('critiqueBullet flags weak openers, missing metrics, and length', () => {
  const weak = critiqueBullet('Responsible for stuff');
  const types = weak.map((i) => i.type);
  assert.ok(types.includes('weak_opener'));
  assert.ok(types.includes('no_metric'));
  assert.ok(types.includes('too_short'));

  const good = critiqueBullet('Cut p95 checkout latency 40% by adding a Redis read-through cache across 12 services');
  assert.deepEqual(good, [], 'a strong bullet should raise no issues');
});

test('the gap question asks about real experience and refuses fabrication', () => {
  const q = buildGapQuestion(['Docker'], 'DevOps Engineer');
  assert.match(q, /^The DevOps Engineer posting/);
  assert.match(q, /Have you actually worked with it\?/);
  assert.match(q, /will not add experience you do not have/i);
});

test('the gap question lists multiple terms readably', () => {
  const q = buildGapQuestion(['Docker', 'Redis', 'Kafka'], null);
  assert.match(q, /"Docker", "Redis" and "Kafka"/);
  assert.match(q, /^This posting/);
});

test('an empty bullet is rejected', async () => {
  await assert.rejects(
    () => suggestForBullet({ bullet: '   ', provider: heuristicProvider }),
    /bullet is required/i
  );
});

test('getProvider defaults to the offline heuristic', () => {
  assert.equal(getProvider('heuristic').name, 'heuristic');
  assert.equal(getProvider('anthropic').name, 'anthropic');
  assert.equal(getProvider(undefined).name, 'heuristic');
});
