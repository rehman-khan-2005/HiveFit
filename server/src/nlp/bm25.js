// Okapi BM25 (Robertson & Spärck Jones) — reported alongside the coverage
// score, not in place of it.
//
// The objection BM25 answers: raw TF-IDF cosine treats term frequency
// linearly, so a posting that says "Python" eight times scores a resume
// mentioning Python eight times far above one mentioning it twice, when in
// practice the second and eighth mention carry almost no extra information.
// BM25 saturates term frequency through k1 and normalizes for document
// length, which is why it has been the standard retrieval baseline for thirty
// years while plain cosine has not.
//
// Two parameters, at their conventional defaults:
//
//   k1 = 1.2   how fast term frequency saturates. Higher means a repeated
//              term keeps earning credit for longer.
//   b  = 0.75  how much document length is penalized. At b=0 length is
//              ignored; at b=1 it is fully normalized. Resumes vary in length
//              far more than web documents, so the default matters here.
//
// Scored resume-as-document against posting-as-query, which is the asymmetric
// direction the problem actually has: "how well does this resume answer what
// this posting asks for" rather than "how similar are these two documents".

const DEFAULTS = { k1: 1.2, b: 0.75 };

/**
 * BM25 of one document against a query, in raw (unbounded) score units.
 *
 * @param {object} args
 * @param {string[]} args.documentTokens  the resume
 * @param {string[]} args.queryTokens     the posting
 * @param {(term: string) => number} args.idfFor
 * @param {number} args.averageDocumentLength  across the fitted corpus
 * @param {object} [args.params] { k1, b }
 */
export function bm25({
  documentTokens, queryTokens, idfFor, averageDocumentLength, params = {},
}) {
  const { k1, b } = { ...DEFAULTS, ...params };

  const docLength = documentTokens.length;
  if (docLength === 0 || queryTokens.length === 0) return 0;

  const frequency = new Map();
  for (const token of documentTokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);

  // Each distinct query term contributes once; a posting repeating
  // "communication" six times should not sextuple that requirement's weight.
  const avgLength = averageDocumentLength > 0 ? averageDocumentLength : docLength;
  const lengthNorm = k1 * (1 - b + b * (docLength / avgLength));

  let score = 0;
  for (const term of new Set(queryTokens)) {
    const tf = frequency.get(term) ?? 0;
    if (tf === 0) continue;
    score += idfFor(term) * ((tf * (k1 + 1)) / (tf + lengthNorm));
  }
  return score;
}

/**
 * BM25 expressed on 0-100, so it can sit next to the other two numbers.
 *
 * Raw BM25 is unbounded and corpus-dependent, which makes it unreadable as a
 * user-facing figure and incomparable between postings. Dividing by the score
 * the posting would give a resume that contains every term it asks for turns
 * it into "how much of the achievable retrieval score did you get" — bounded,
 * and comparable across postings of different lengths.
 */
export function bm25Score({
  documentTokens, queryTokens, idfFor, averageDocumentLength, params = {},
}) {
  const actual = bm25({ documentTokens, queryTokens, idfFor, averageDocumentLength, params });
  if (actual === 0) return 0;

  // The ceiling: the same posting scored against itself, which is the best any
  // resume could do on these terms at this length.
  const ideal = bm25({
    documentTokens: queryTokens,
    queryTokens,
    idfFor,
    averageDocumentLength,
    params,
  });
  if (ideal <= 0) return 0;

  return Math.round(Math.min(1, actual / ideal) * 10000) / 100;
}
