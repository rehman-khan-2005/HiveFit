// What to actually do with this resume, in order.
//
// Every piece of this advice already existed and was scattered: the gap list
// said what was missing, the highlight analysis said what was buried, the
// bullet critique said which sentences were weak. A user reading three
// separate lists has to work out the order themselves, and the order is the
// most useful part — the cheapest, safest edits first.
//
// Steps are sorted by what they cost the user, not by what they score:
//
//   free     the evidence is already on the page and only needs moving. No new
//            claim, nothing to confirm, no risk of overstating anything.
//   low      the sentence needs rewriting but makes no new claim.
//   asks     the system has to ask whether the experience is real before
//            anything can be written. Honest, and slower.
//   accept   nothing can be done truthfully. Said plainly so the user stops
//            looking for a fix that does not exist.
//
// That ordering is the whole point. Telling someone to "add Kubernetes" when
// they have never used it is the failure mode this product exists to avoid, so
// those steps sort last and are phrased as preparation rather than editing.

import { critiqueBullet } from './suggest.js';
import { isFilterableSkill } from '../nlp/categories.js';

const MAX_STEPS = 8;

/**
 * Is this a term worth putting in an instruction?
 *
 * The gap and highlight lists are built for scoring, where every token that
 * carries skill signal legitimately counts — including "languages", a stem the
 * taxonomy picks up from "natural language processing". Scoring is right to
 * count it. "Work languages into your Data Engineer bullet" is not advice, so
 * advice is held to the tighter, curated standard: unambiguous technology
 * names a user would recognise as a skill.
 */
function nameable(item) {
  return isFilterableSkill(item.stem);
}

/** The bullet best placed to carry a term, by the analysis's own ranking. */
function bestHomeFor(stem, bullets) {
  for (const bullet of bullets) {
    const target = (bullet.targets ?? []).find((t) => t.stem === stem);
    if (target?.evidence === 'entry') return { bullet, confident: true };
  }
  for (const bullet of bullets) {
    if ((bullet.targets ?? []).some((t) => t.stem === stem)) {
      return { bullet, confident: false };
    }
  }
  return null;
}

function shorten(text, length = 72) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1)}…`;
}

/**
 * Build an ordered tailoring plan for one analysis.
 *
 * @param {object} args
 * @param {object[]} args.underhighlighted  skills held but not demonstrated
 * @param {object[]} args.prioritizedGap    terms the posting wants and the resume lacks
 * @param {object[]} args.bullets           bullets with their ranked targets
 * @param {object}   args.verdict
 * @returns {{summary: string, steps: object[]}}
 */
export function tailoringPlan({
  underhighlighted = [], prioritizedGap = [], bullets = [], verdict = null,
}) {
  const steps = [];

  // 1. Free wins: the skill is on the resume, just not where it counts.
  for (const item of underhighlighted.filter(nameable).slice(0, 4)) {
    const home = bestHomeFor(item.stem, bullets);
    steps.push({
      kind: 'surface',
      effort: 'free',
      terms: [item.term],
      title: home
        ? `Work "${item.term}" into your ${home.bullet.entryTitle ?? 'relevant'} bullet`
        : `Show "${item.term}" in an accomplishment, not just a list`,
      why: `${item.foundIn} This posting asks for it, and the keyword scan counts it — the person reading your resume will not.`,
      bullet: home ? shorten(home.bullet.text) : null,
      confident: Boolean(home?.confident),
    });
  }

  // 2. Structural rewrites: no new claim, just a better sentence.
  const weak = bullets
    .map((bullet) => ({ bullet, issues: critiqueBullet(bullet.text) }))
    .filter((entry) => entry.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 2);

  for (const { bullet, issues } of weak) {
    steps.push({
      kind: 'structure',
      effort: 'low',
      terms: [],
      title: issues.some((i) => i.type === 'weak_opener')
        ? 'Lead with what you accomplished, not what you were assigned'
        : 'Add a number to this bullet',
      why: issues.map((i) => i.detail).join(' '),
      bullet: shorten(bullet.text),
      confident: true,
    });
  }

  // 3. Gaps worth a question. Recognized skills only: "add essential to your
  //    resume" is not advice, and the gap list carries posting vocabulary.
  const askable = prioritizedGap.filter(nameable).slice(0, 3);
  if (askable.length > 0) {
    steps.push({
      kind: 'confirm',
      effort: 'asks',
      terms: askable.map((g) => g.term),
      title: `Tell us whether you have used ${askable.length === 1 ? askable[0].term : 'these'}`,
      why: 'This posting asks for them and your resume does not mention them. If you have the experience, describe it and it goes into a bullet. If not, nothing is added.',
      bullet: null,
      confident: false,
    });
  }

  // 4. What to stop trying to fix.
  const critical = prioritizedGap.filter((g) => nameable(g) && g.importance === 'critical');
  if (critical.length > 3) {
    steps.push({
      kind: 'accept',
      effort: 'accept',
      terms: critical.slice(0, 4).map((g) => g.term),
      title: 'Prepare to talk about these rather than claim them',
      why: `This posting leans on ${critical.length} skills your resume does not evidence. Tailoring will not close that, and claiming them is what gets caught at the interview.`,
      bullet: null,
      confident: true,
    });
  }

  const free = steps.filter((s) => s.effort === 'free').length;

  let summary;
  if (free > 0) {
    summary = `${free} ${free === 1 ? 'change costs' : 'changes cost'} you nothing — the experience is already on your resume, in a place that does not count. Start there.`;
  } else if (steps.length > 0) {
    summary = 'Nothing here needs a new claim from you, but a few bullets would read better and a few gaps are worth answering.';
  } else {
    summary = verdict?.band === 'strong'
      ? 'This resume already answers the posting. Read the gaps for interview preparation rather than rewriting.'
      : 'No tailoring will move this one much. Spend the time on a closer match.';
  }

  return { summary, steps: steps.slice(0, MAX_STEPS) };
}
