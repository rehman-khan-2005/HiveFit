// DFD 2.2 — Preprocessing.
//
// Lowercase, strip stop words, tokenize, and stem. Two details matter for
// resume/job-posting text specifically:
//
// 1. Naive tokenizing on /\W+/ destroys the exact terms an ATS screens for:
//    "C++" becomes "c", "Node.js" splits in two, "CI/CD" splits in two. Those
//    are protected below before the generic split runs.
// 2. The gap report is shown to a human, so a stem has to map back to a real
//    word — telling someone their resume is missing "machin learn" is useless.
//    Every stem therefore carries the surface form it came from.

import { STOP_WORDS } from './stopwords.js';
import { stem } from './stemmer.js';

// Terms whose punctuation is meaningful. Mapped to a placeholder before the
// generic tokenizer runs, then restored.
const PROTECTED_TERMS = [
  ['c++', 'cplusplus'], ['c#', 'csharp'], ['f#', 'fsharp'],
  ['.net', 'dotnet'], ['node.js', 'nodejs'], ['next.js', 'nextjs'],
  ['vue.js', 'vuejs'], ['react.js', 'reactjs'], ['express.js', 'expressjs'],
  ['ci/cd', 'cicd'], ['tcp/ip', 'tcpip'], ['a/b', 'abtesting'],
  ['objective-c', 'objectivec'], ['asp.net', 'aspdotnet'],
];

const RESTORE = new Map(PROTECTED_TERMS.map(([surface, token]) => [token, surface]));

// Stems that must never be produced — protected terms are already atomic.
const NO_STEM = new Set(PROTECTED_TERMS.map(([, token]) => token));

function protectTerms(text) {
  let out = text;
  for (const [surface, token] of PROTECTED_TERMS) {
    out = out.split(surface).join(` ${token} `);
  }
  return out;
}

/**
 * Preprocess raw document text into stemmed tokens.
 * @returns {{tokens: string[], surface: Map<string,string>}}
 *   tokens  — stemmed terms, stop words removed, order preserved
 *   surface — stem -> most frequent original spelling, for display
 */
export function preprocess(text) {
  const lowered = protectTerms(String(text ?? '').toLowerCase());

  // Keep letters, digits and internal hyphens; everything else is a boundary.
  const rawTokens = lowered
    .split(/[^a-z0-9+#-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter(Boolean);

  const tokens = [];
  const surfaceCounts = new Map();

  for (const raw of rawTokens) {
    if (raw.length < 2) continue;
    if (/^\d+$/.test(raw)) continue;          // bare numbers carry no skill signal
    if (STOP_WORDS.has(raw)) continue;

    const stemmed = NO_STEM.has(raw) ? raw : stem(raw);
    if (!stemmed || stemmed.length < 2) continue;
    if (STOP_WORDS.has(stemmed)) continue;

    tokens.push(stemmed);

    const display = RESTORE.get(raw) ?? raw;
    if (!surfaceCounts.has(stemmed)) surfaceCounts.set(stemmed, new Map());
    const counts = surfaceCounts.get(stemmed);
    counts.set(display, (counts.get(display) ?? 0) + 1);
  }

  // Collapse each stem to the spelling that appeared most often.
  const surface = new Map();
  for (const [stemmed, counts] of surfaceCounts) {
    let best = null;
    let bestCount = -1;
    for (const [word, count] of counts) {
      if (count > bestCount) { best = word; bestCount = count; }
    }
    surface.set(stemmed, best);
  }

  return { tokens, surface };
}

/** Adjacent token pairs, so phrases like "machine learning" survive as a unit. */
export function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/** Term frequency map for a token list. */
export function termFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}
