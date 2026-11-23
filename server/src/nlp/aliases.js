// Spellings that mean the same skill.
//
// This exists because of how recruiters actually search. An ATS keyword search
// is literal: a recruiter who types "Kubernetes" does not match a resume that
// says "k8s", and one who types "PostgreSQL" does not match "Postgres". The
// stemmer cannot close that gap — "postgres" and "postgresql" are different
// words, not inflections of one — so the equivalences have to be stated.
//
// The first spelling in each group is the formal one, which is what postings
// and search boxes overwhelmingly use. The rest are the shorthand that ends up
// on a resume because that is what engineers call it in conversation.
//
// Scope note: this is a keyword-visibility aid, not an ontology. Groups are
// only added where the two spellings are genuinely the same thing, so nothing
// here claims that React and Next.js, or SQL and PostgreSQL, are equivalent.

const GROUPS = [
  ['JavaScript', 'js'],
  ['TypeScript', 'ts'],
  ['PostgreSQL', 'postgres', 'psql', 'postgre'],
  ['Kubernetes', 'k8s'],
  ['Node.js', 'node', 'nodejs'],
  ['React', 'react.js', 'reactjs'],
  ['Vue.js', 'vue', 'vuejs'],
  ['Amazon Web Services', 'aws'],
  ['Google Cloud Platform', 'gcp'],
  ['Microsoft Azure', 'azure'],
  ['Continuous Integration', 'ci'],
  ['CI/CD', 'cicd'],
  ['Machine Learning', 'ml'],
  ['Natural Language Processing', 'nlp'],
  ['Artificial Intelligence', 'ai'],
  ['Object-Oriented Programming', 'oop'],
  ['Representational State Transfer', 'rest', 'restful'],
  ['Application Programming Interface', 'api'],
  ['User Interface', 'ui'],
  ['User Experience', 'ux'],
  ['Structured Query Language', 'sql'],
  ['MongoDB', 'mongo'],
  ['Elasticsearch', 'elastic', 'elk'],
  ['Microsoft SQL Server', 'mssql', 'sqlserver'],
  ['Git', 'github', 'version control'],
  ['Documentation', 'docs'],
  ['Quality Assurance', 'qa'],
  ['Test-Driven Development', 'tdd'],
  ['Infrastructure as Code', 'iac'],
  ['Command Line Interface', 'cli'],
  ['Software Development Kit', 'sdk'],
  ['Continuous Deployment', 'cd'],
  ['Bachelor of Science', 'bs', 'bsc'],
];

/**
 * Build the stem lookup lazily.
 *
 * preprocess() is imported from tokenize.js, and tokenize.js is imported by
 * categories.js, which this module's callers also use — doing the work at
 * module scope would run before the stop-word list is necessarily ready in
 * every import order. Built once, on first use.
 */
let groupsByStem = null;

function build(preprocess) {
  const byStem = new Map();

  for (const spellings of GROUPS) {
    const [canonical] = spellings;
    const stems = new Set();

    for (const spelling of spellings) {
      for (const token of preprocess(spelling).tokens) stems.add(token);
    }

    // A multi-word spelling stems to several tokens, none of which identifies
    // the group on its own ("machine" is not Machine Learning). Only
    // single-token spellings are usable as a lookup key.
    for (const spelling of spellings) {
      const { tokens } = preprocess(spelling);
      if (tokens.length !== 1) continue;
      const stem = tokens[0];
      if (!byStem.has(stem)) {
        byStem.set(stem, { canonical, spelling, stems: [...stems] });
      }
    }
  }

  return byStem;
}

/**
 * The alias group a stem belongs to, or null.
 *
 * @returns {{canonical: string, spelling: string, stems: string[]}|null}
 *   canonical — the formal spelling a recruiter is likely to type
 *   spelling  — the spelling this particular stem came from
 *   stems     — every stem in the group
 */
export function aliasGroupFor(stem, preprocess) {
  if (!groupsByStem) groupsByStem = build(preprocess);
  return groupsByStem.get(stem) ?? null;
}

/** Every group, for tests and for the docs. */
export function aliasGroups() {
  return GROUPS.map(([canonical, ...rest]) => ({ canonical, shorthand: rest }));
}
