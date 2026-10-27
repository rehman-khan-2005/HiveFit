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

import { stemSet, termStems, coveredBy } from '../nlp/evidence.js';

const WEAK_OPENERS = [
  'responsible for', 'worked on', 'helped with', 'assisted with',
  'involved in', 'participated in', 'tasked with', 'duties included',
];

const HAS_METRIC = /\d/;

/**
 * Decide, for each target term, what evidence the resume offers for it.
 *
 * Evidence comes in tiers, because "does this person have the skill" and "does
 * it belong in this particular bullet" are different questions:
 *
 *   bullet   the bullet itself demonstrates it — safe to emphasize
 *   entry    the project/job header declares the stack ("Ease-On | React,
 *            Node.js") — that work genuinely used it, so it belongs here
 *   resume   listed under Skills elsewhere — they have it, but writing it into
 *            unrelated work would misrepresent where it was used, so we ask
 *   none     nothing anywhere — we ask, and never write it
 *
 * Without the tiers a resume whose Skills line reads "Python" would still be
 * asked "have you actually worked with Python?", which is both wrong and
 * corrosive to the feature's credibility.
 *
 * @param {string}   bulletText
 * @param {string[]} targetTerms
 * @param {object}   [context] { entryTech: string[], skills: string[] }
 * @returns {{evidenced: string[], fromEntry: string[], fromResume: string[], unsupported: string[]}}
 */
export function classifyTerms(bulletText, targetTerms, context = {}) {
  const inBullet = stemSet(bulletText);
  const inEntry = stemSet([context.entryTitle ?? '', ...(context.entryTech ?? [])].join(' '));
  const inResume = stemSet((context.skills ?? []).join(' '));

  const evidenced = [];
  const fromEntry = [];
  const fromResume = [];
  const unsupported = [];

  for (const term of targetTerms) {
    const termTokens = termStems(term);
    if (termTokens.length === 0) continue;

    const covers = (set) => coveredBy(termTokens, set);

    if (covers(inBullet)) evidenced.push(term);
    else if (covers(inEntry)) fromEntry.push(term);
    else if (covers(inResume)) fromResume.push(term);
    else unsupported.push(term);
  }

  return { evidenced, fromEntry, fromResume, unsupported };
}

/** A softer question for a skill the resume claims but this bullet does not show. */
export function buildPlacementQuestion(terms, entryTitle) {
  const list = terms.map((t) => `"${t}"`).join(', ');
  const where = entryTitle ? `your work on ${entryTitle}` : 'this specific work';
  return `Your resume already lists ${list}, so we know you have it. Did you use it in ${where}? ` +
    `If yes we will work it into this bullet. If it belongs to different work, say no — ` +
    `putting it here would point a recruiter at the wrong project.`;
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
  bullet, targetTerms = [], jobTitle = null, userEvidence = null, context = {}, provider,
}) {
  const original = String(bullet ?? '').trim();
  if (!original) {
    throw Object.assign(new Error('A bullet is required'), { status: 400 });
  }

  const { evidenced, fromEntry, fromResume, unsupported } =
    classifyTerms(original, targetTerms, context);
  const issues = critiqueBullet(original);

  // The user answered a previous question describing real experience. That
  // answer is evidence, so whatever it covers becomes writable.
  let confirmed = [];
  let stillUnsupported = unsupported;
  let stillMisplaced = fromResume;

  if (userEvidence) {
    const open = [...unsupported, ...fromResume];
    if (open.length > 0) {
      const check = classifyTerms(userEvidence, open);
      confirmed = check.evidenced;
      const answered = new Set(confirmed);
      stillUnsupported = unsupported.filter((t) => !answered.has(t));
      stillMisplaced = fromResume.filter((t) => !answered.has(t));
    }
  }

  // A term the entry's own tech stack declares is safe to surface: that work
  // demonstrably used it, even if this one sentence does not say the word.
  const writable = [...evidenced, ...fromEntry, ...confirmed];

  // Two kinds of open question, because they are genuinely different. One asks
  // whether the experience exists at all; the other asks whether experience we
  // already know about belongs in this bullet.
  const questions = [];
  if (stillUnsupported.length > 0) questions.push(buildGapQuestion(stillUnsupported, jobTitle));
  if (stillMisplaced.length > 0) questions.push(buildPlacementQuestion(stillMisplaced, context.entryTitle));

  // Nothing can be written: every requested term is unevidenced or misplaced,
  // and the user has not told us otherwise. Ask rather than invent.
  if (writable.length === 0 && questions.length > 0) {
    return {
      original,
      status: 'needs_input',
      suggested: null,
      question: questions.join('\n\n'),
      termsAddressed: [],
      termsRequiringConfirmation: [...stillUnsupported, ...stillMisplaced],
      evidence: { fromBullet: evidenced, fromEntry, fromResume, confirmed },
      issues,
      rationale: stillUnsupported.length > 0
        ? 'Every requested term is absent from your resume, so writing one would mean inventing experience.'
        : 'Your resume lists these skills, but this bullet does not show them being used here.',
    };
  }

  const suggested = await provider.rewrite({
    original, writable, issues, jobTitle, userEvidence,
  });

  const why = [];
  if (evidenced.length > 0) why.push(`${evidenced.join(', ')} (already in this bullet)`);
  if (fromEntry.length > 0) why.push(`${fromEntry.join(', ')} (from this entry's stack)`);
  if (confirmed.length > 0) why.push(`${confirmed.join(', ')} (you confirmed it)`);

  return {
    original,
    status: 'suggested',
    suggested,
    // Even when something is writable, anything still open is surfaced rather
    // than quietly dropped.
    question: questions.length > 0 ? questions.join('\n\n') : null,
    termsAddressed: writable,
    termsRequiringConfirmation: [...stillUnsupported, ...stillMisplaced],
    evidence: { fromBullet: evidenced, fromEntry, fromResume, confirmed },
    issues,
    rationale: why.length > 0
      ? `Rewritten to surface ${why.join('; ')}.`
      : 'Rewritten for structure only; no new skill claims were added.',
  };
}
