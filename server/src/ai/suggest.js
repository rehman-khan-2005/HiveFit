// Process 3.0 — AI Recommendations, under the report's "honest optimization"
// constraint.
//
// The rule this module enforces: a suggestion may only surface experience the
// bullet already evidences. If a posting wants Kubernetes and the bullet says
// nothing about Kubernetes, the correct output is a QUESTION to the user, not
// a rewritten bullet claiming Kubernetes. That is the difference the report
// draws between HiveFit and Rezi/Kickresume, so it is enforced here in code
// rather than left to a model's discretion — the model never sees a code path
// that lets it write an unsupported term into a bullet.

import { preprocess } from '../nlp/tokenize.js';

const WEAK_OPENERS = [
  'responsible for', 'worked on', 'helped with', 'assisted with',
  'involved in', 'participated in', 'tasked with', 'duties included',
];

const HAS_METRIC = /\d/;

/**
 * Decide, for each target term, whether the bullet already evidences it.
 * @returns {{evidenced: string[], unsupported: string[]}}
 */
export function classifyTerms(bulletText, targetTerms) {
  const { tokens } = preprocess(bulletText);
  const present = new Set(tokens);

  const evidenced = [];
  const unsupported = [];

  for (const term of targetTerms) {
    const { tokens: termTokens } = preprocess(term);
    if (termTokens.length === 0) continue;
    // Evidenced only when every stem of the term appears in the bullet.
    const isPresent = termTokens.every((t) => present.has(t));
    (isPresent ? evidenced : unsupported).push(term);
  }

  return { evidenced, unsupported };
}

/** Structural weaknesses worth flagging regardless of keyword coverage. */
export function critiqueBullet(bulletText) {
  const text = String(bulletText ?? '').trim();
  const lower = text.toLowerCase();
  const issues = [];

  const weakOpener = WEAK_OPENERS.find((opener) => lower.startsWith(opener));
  if (weakOpener) {
    issues.push({
      type: 'weak_opener',
      detail: `Starts with "${weakOpener}", which describes assignment rather than accomplishment.`,
    });
  }
  if (!HAS_METRIC.test(text)) {
    issues.push({
      type: 'no_metric',
      detail: 'No number anywhere in the bullet. Scale, volume, or percentage change makes impact legible.',
    });
  }
  if (text.split(/\s+/).length < 8) {
    issues.push({ type: 'too_short', detail: 'Too short to convey context or outcome.' });
  }
  if (text.split(/\s+/).length > 45) {
    issues.push({ type: 'too_long', detail: 'Long enough that a recruiter skimming will lose the outcome.' });
  }
  return issues;
}

/**
 * Build the question shown to the user when a gap cannot be closed honestly.
 * Phrased to ask about real experience, never to imply they should claim it.
 */
export function buildGapQuestion(unsupported, jobTitle) {
  const list = unsupported.length === 1
    ? `"${unsupported[0]}"`
    : `${unsupported.slice(0, -1).map((t) => `"${t}"`).join(', ')} and "${unsupported[unsupported.length - 1]}"`;

  const role = jobTitle ? `the ${jobTitle} posting` : 'this posting';

  const opener = role.charAt(0).toUpperCase() + role.slice(1);

  return `${opener} asks for ${list}, and this bullet does not mention ${unsupported.length === 1 ? 'it' : 'them'}. ` +
    `Have you actually worked with ${unsupported.length === 1 ? 'it' : 'them'}? ` +
    `If yes, tell us what you did and we will work it into the bullet. ` +
    `If no, leave it out — we will not add experience you do not have, and claiming it here is what gets caught at the interview.`;
}

/**
 * Produce a suggestion for one bullet.
 *
 * @param {object} args
 * @param {string}   args.bullet       the bullet the user selected
 * @param {string[]} args.targetTerms  gap terms the user wants addressed
 * @param {string}   [args.jobTitle]
 * @param {string}   [args.userEvidence] the user's answer to a previous question
 * @param {object}   args.provider     { rewrite(payload): Promise<string> }
 */
export async function suggestForBullet({
  bullet, targetTerms = [], jobTitle = null, userEvidence = null, provider,
}) {
  const original = String(bullet ?? '').trim();
  if (!original) {
    throw Object.assign(new Error('A bullet is required'), { status: 400 });
  }

  const { evidenced, unsupported } = classifyTerms(original, targetTerms);
  const issues = critiqueBullet(original);

  // The user answered a previous question describing real experience. That
  // answer is now evidence, so the terms it covers become writable.
  let confirmed = [];
  let stillUnsupported = unsupported;
  if (userEvidence && unsupported.length > 0) {
    const check = classifyTerms(userEvidence, unsupported);
    confirmed = check.evidenced;
    stillUnsupported = check.unsupported;
  }

  // Nothing can be written yet: every requested term is unevidenced and the
  // user has not told us otherwise. Ask instead of inventing.
  if (evidenced.length === 0 && confirmed.length === 0 && stillUnsupported.length > 0) {
    return {
      original,
      status: 'needs_input',
      suggested: null,
      question: buildGapQuestion(stillUnsupported, jobTitle),
      termsAddressed: [],
      termsRequiringConfirmation: stillUnsupported,
      issues,
      rationale: 'Every requested term is absent from this bullet, so writing one would mean inventing experience.',
    };
  }

  const writable = [...evidenced, ...confirmed];
  const suggested = await provider.rewrite({
    original, writable, issues, jobTitle, userEvidence,
  });

  return {
    original,
    status: 'suggested',
    suggested,
    // Even when we can write something, any term still unevidenced is
    // surfaced as an open question rather than quietly dropped.
    question: stillUnsupported.length > 0 ? buildGapQuestion(stillUnsupported, jobTitle) : null,
    termsAddressed: writable,
    termsRequiringConfirmation: stillUnsupported,
    issues,
    rationale: writable.length > 0
      ? `Rewritten to surface ${writable.join(', ')}, which this bullet already evidences.`
      : 'Rewritten for structure only; no new skill claims were added.',
  };
}
