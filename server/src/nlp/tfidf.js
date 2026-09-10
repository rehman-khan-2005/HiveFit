// DFD 2.3 — TF-IDF vectorization (Salton & Buckley, 1988).
//
// Inverse document frequency is fitted against a corpus of job postings, not
// against the two documents being compared. This matters: with a corpus of
// two, every shared term has df=2 and IDF collapses to a constant, which
// reduces the score to raw word overlap. Fitting against many postings is
// what makes a term like "kubernetes" outweigh a term like "team".

const LOG = Math.log;

export class TfidfVectorizer {
  constructor() {
    this.idf = new Map();
    this.documentCount = 0;
    this.fitted = false;
  }

  /**
   * Learn IDF weights from a corpus.
   * @param {string[][]} documents token lists, one per corpus document
   */
  fit(documents) {
    this.documentCount = documents.length;
    const documentFrequency = new Map();

    for (const tokens of documents) {
      for (const term of new Set(tokens)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    // Smoothed IDF: log((N + 1) / (df + 1)) + 1. The +1s keep an unseen term
    // finite, and the trailing +1 keeps a term present in every document at a
    // small positive weight rather than exactly zero.
    for (const [term, df] of documentFrequency) {
      this.idf.set(term, LOG((this.documentCount + 1) / (df + 1)) + 1);
    }

    this.fitted = true;
    return this;
  }

  /** IDF for a term, defaulting to the weight of a term seen in no document. */
  idfFor(term) {
    const known = this.idf.get(term);
    if (known !== undefined) return known;
    return LOG((this.documentCount + 1) / 1) + 1;
  }

  /**
   * Project a token list into an L2-normalized sparse TF-IDF vector.
   * @returns {Map<string, number>}
   */
  transform(tokens) {
    if (tokens.length === 0) return new Map();

    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    // Sublinear term frequency (1 + log tf). A term repeated ten times in a
    // posting is more important than one used once, but not ten times more.
    const raw = new Map();
    for (const [term, count] of counts) {
      raw.set(term, (1 + LOG(count)) * this.idfFor(term));
    }

    let norm = 0;
    for (const weight of raw.values()) norm += weight * weight;
    norm = Math.sqrt(norm);
    if (norm === 0) return raw;

    const normalized = new Map();
    for (const [term, weight] of raw) normalized.set(term, weight / norm);
    return normalized;
  }

  fitTransform(documents) {
    this.fit(documents);
    return documents.map((tokens) => this.transform(tokens));
  }

  /** Terms of a vector ordered by weight, highest first. */
  topTerms(vector, limit = 25) {
    return [...vector.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term, weight]) => ({ term, weight }));
  }
}
