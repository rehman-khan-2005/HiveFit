// Porter stemming algorithm (Porter, 1980) — reduces inflected forms to a
// common stem so "managing", "managed" and "manages" all match "manag".
//
// Without this, a resume saying "developed" would not match a posting asking
// for "developer", and the cosine score would understate a genuine match.

const consonant = '[^aeiou]';
const vowel = '[aeiouy]';
const consonantSeq = `${consonant}[^aeiouy]*`;
const vowelSeq = `${vowel}[aeiou]*`;

const MEASURE_GT_0 = new RegExp(`^(${consonantSeq})?${vowelSeq}${consonantSeq}`);
const MEASURE_EQ_1 = new RegExp(
  `^(${consonantSeq})?${vowelSeq}${consonantSeq}(${vowelSeq})?$`
);
const MEASURE_GT_1 = new RegExp(`^(${consonantSeq})?(${vowelSeq}${consonantSeq}){2,}`);
const HAS_VOWEL = new RegExp(`^(${consonantSeq})?${vowel}`);

const STEP2 = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize',
  bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
  ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive',
  fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble',
  logi: 'log',
};

const STEP3 = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic',
  ful: '', ness: '',
};

const STEP4 = /^(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;

export function stem(word) {
  let w = word;
  if (w.length < 3) return w;

  // Step 1a — plurals.
  if (/(ss|i)es$/.test(w)) w = w.replace(/(ss|i)es$/, '$1');
  else if (/([^s])s$/.test(w)) w = w.replace(/([^s])s$/, '$1');

  // Step 1b — past tense and gerunds.
  let step1bApplied = false;
  if (/eed$/.test(w)) {
    const stemPart = w.replace(/eed$/, '');
    if (MEASURE_GT_0.test(stemPart)) w = w.replace(/eed$/, 'ee');
  } else if (/(ed|ing)$/.test(w)) {
    const stemPart = w.replace(/(ed|ing)$/, '');
    if (HAS_VOWEL.test(stemPart)) {
      w = stemPart;
      step1bApplied = true;
    }
  }
  if (step1bApplied) {
    if (/(at|bl|iz)$/.test(w)) w += 'e';
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    else if (MEASURE_EQ_1.test(w) && new RegExp(`${consonant}${vowel}[^aeiouwxy]$`).test(w)) w += 'e';
  }

  // Step 1c — terminal y to i.
  if (/y$/.test(w)) {
    const stemPart = w.replace(/y$/, '');
    if (HAS_VOWEL.test(stemPart)) w = `${stemPart}i`;
  }

  // Steps 2 and 3 — derivational suffixes.
  for (const [suffix, replacement] of Object.entries(STEP2)) {
    if (w.endsWith(suffix)) {
      const stemPart = w.slice(0, -suffix.length);
      if (MEASURE_GT_0.test(stemPart)) w = stemPart + replacement;
      break;
    }
  }
  for (const [suffix, replacement] of Object.entries(STEP3)) {
    if (w.endsWith(suffix)) {
      const stemPart = w.slice(0, -suffix.length);
      if (MEASURE_GT_0.test(stemPart)) w = stemPart + replacement;
      break;
    }
  }

  // Step 4 — strip suffixes only when the stem is substantial (m > 1).
  const step4 = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w);
  if (step4 && MEASURE_GT_1.test(step4[1])) {
    w = step4[1];
  } else {
    const ion = /^(.+?)(s|t)(ion)$/.exec(w);
    if (ion && MEASURE_GT_1.test(ion[1] + ion[2])) w = ion[1] + ion[2];
  }

  // Step 5 — tidy up a trailing e and doubled l.
  if (/e$/.test(w)) {
    const stemPart = w.slice(0, -1);
    const endsCVC = new RegExp(`${consonant}${vowel}[^aeiouwxy]$`).test(stemPart);
    if (MEASURE_GT_1.test(stemPart) || (MEASURE_EQ_1.test(stemPart) && !endsCVC)) w = stemPart;
  }
  if (/ll$/.test(w) && MEASURE_GT_1.test(w)) w = w.slice(0, -1);

  return w;
}
