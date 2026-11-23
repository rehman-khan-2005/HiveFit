// Relative fit bands — how postings compare to each other, not to 100.
//
// The headline score is a good ranker and a bad grade, and that is measured
// rather than assumed. On the labelled reference ladder it separates tiers by
// 24 points in the right order. On real listings every absolute form of it
// collapses into a narrow band near the bottom:
//
//   IDF-weighted coverage of recognized skills   median  10.9   max 34.4
//   coverage of the terms the posting leans on   median   9.5   max 44.5
//   plain count of requirements met              median   3.3%  max  6.7%
//
// The cause is structural, not a bug and not a threshold in the wrong place. A
// real posting names 150 to 400 terms — the team's whole stack, the
// nice-to-haves, the things the next team over uses — and no single resume
// covers most of them. Shrinking the denominator to the emphasised terms moves
// the median by a point; shrinking it further turns the score into an
// all-or-nothing flip between 0 and 100 on a handful of terms.
//
// So an absolute band ("80 and above is a strong match") cannot be honest
// here: every real listing lands in the bottom one. What the number can do is
// order a set, which is what the user is actually asking — of the twelve jobs
// I picked, which deserve my afternoon? These bands answer that question and
// say so in their wording: "closest of the 12 compared", never "87% match".

const BANDS = [
  {
    band: 'close',
    tone: 'green',
    floor: 0.8,
    label: 'Closest match',
    message: 'Among the best fits in this comparison. Worth applying to first.',
  },
  {
    band: 'near',
    tone: 'amber',
    floor: 0.5,
    label: 'Worth tailoring',
    message: 'Mid-pack here. Tailoring moves this one most.',
  },
  {
    band: 'far',
    tone: 'grey',
    floor: 0,
    label: 'Weakest here',
    message: 'The furthest from your resume in this set. Spend the time elsewhere.',
  },
];

export const FIT_BANDS = BANDS.map(({ band, tone, label, message }) => ({
  band, tone, label, message,
}));

/**
 * What the percentage is, measured, for the interface to say out loud.
 *
 * Shipped with every analysis so the number and the caveat cannot drift apart,
 * and so the claim is reproducible by whoever reads it rather than taken on
 * trust.
 */
export const SCORE_REALITY = {
  headline: 'The percentage ranks postings. It does not grade them.',
  measured: 'Across 80 real listings: median 11%, 90th percentile 19%, highest 34%.',
  why: 'A real posting names 150 to 400 terms — the whole stack, the '
    + 'nice-to-haves, the next team\u2019s tools — and no resume covers most of '
    + 'them. The ceiling is a property of job postings, not of your resume.',
  reproduce: 'npm run calibrate -- --live 80',
};

/**
 * Band a set of scored results against each other.
 *
 * Relative to the best score in the set, so the wording is true whatever the
 * absolute numbers are: the closest match of a weak set is still the closest
 * match of that set, and the label says "of these" rather than implying a
 * grade.
 *
 * A single posting gets no band. One result has nothing to be relative to, and
 * calling it the closest match of one is a tautology dressed as a finding.
 *
 * @param {Array<{score: number}>} results  ranked, best first
 * @returns {Array<object>} the same results, each with a `fit`
 */
export function bandByFit(results) {
  if (results.length < 2) {
    return results.map((result) => ({ ...result, fit: null }));
  }

  const best = Math.max(...results.map((r) => r.score));

  return results.map((result) => {
    // Every score is zero: nothing in this set resembles the resume, and
    // ranking them against each other would invent a winner.
    if (best <= 0) {
      const far = BANDS[BANDS.length - 1];
      return {
        ...result,
        fit: {
          band: far.band,
          tone: far.tone,
          label: far.label,
          message: 'None of these postings share meaningful vocabulary with your resume.',
          ratio: 0,
          comparedWith: results.length,
        },
      };
    }

    const ratio = result.score / best;
    const tier = BANDS.find((b) => ratio >= b.floor);

    return {
      ...result,
      fit: {
        band: tier.band,
        tone: tier.tone,
        label: tier.label,
        message: tier.message,
        // Rounded for display; the raw score stays on the result for the
        // report, which does need the absolute figure.
        ratio: Math.round(ratio * 100),
        comparedWith: results.length,
      },
    };
  });
}

/**
 * The bands, with how many of this comparison fell in each.
 *
 * Returned with the analysis so the interface can offer "hide the weakest"
 * against real counts rather than a guess.
 */
export function fitSummary(results) {
  const counts = new Map();
  for (const result of results) {
    if (!result.fit) continue;
    counts.set(result.fit.band, (counts.get(result.fit.band) ?? 0) + 1);
  }

  return FIT_BANDS.map((band) => ({ ...band, count: counts.get(band.band) ?? 0 }));
}
