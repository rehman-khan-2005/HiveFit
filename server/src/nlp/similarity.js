// DFD 2.4 — Cosine similarity scoring.
//
// cos(a, b) = (a . b) / (||a|| ||b||). Vectors from TfidfVectorizer.transform
// are already L2-normalized, so the dot product alone is the cosine; the norms
// are still computed here so the function stays correct for any input.

/** Cosine similarity of two sparse vectors, in [0, 1]. */
export function cosineSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;

  // Iterate the smaller vector: only shared terms contribute to the product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];

  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  if (dot === 0) return 0;

  let normA = 0;
  for (const w of a.values()) normA += w * w;
  let normB = 0;
  for (const w of b.values()) normB += w * w;

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  // Floating-point error can push an identical pair a hair above 1.
  return Math.min(1, dot / denominator);
}

/** Cosine similarity expressed as the 0-100 ATS Compatibility Score. */
export function compatibilityScore(a, b) {
  return Math.round(cosineSimilarity(a, b) * 10000) / 100;
}

/**
 * IDF-weighted coverage of a posting's requirements by a resume.
 *
 * Raw cosine (above) is symmetric: it asks "how similar are these two
 * documents?" and is dragged down by every resume term the posting does not
 * mention — your degree, your unrelated internship, your address. A resume
 * that genuinely covers a posting still scores in the teens, which is not a
 * number anyone can act on.
 *
 * ATS compatibility is not a symmetric question. It asks "how much of what
 * this posting requires does this resume actually contain?" — recall over the
 * posting's term space, weighted so that missing "kubernetes" costs more than
 * missing "dashboard". That is the number reported as the headline score, with
 * the cosine kept alongside it for the detail view.
 *
 * @param {Map<string, number>} jobVector    TF-IDF vector of the posting
 * @param {Set<string>}         resumeTerms  stemmed resume terms
 */
export function requirementCoverage(jobVector, resumeTerms, predicate = null) {
  if (jobVector.size === 0) return 0;

  let total = 0;
  let covered = 0;
  for (const [term, weight] of jobVector) {
    if (predicate && !predicate(term)) continue;
    total += weight;
    if (resumeTerms.has(term)) covered += weight;
  }
  if (total === 0) return 0;

  return Math.round((covered / total) * 10000) / 100;
}
