// Process 4.0 — Job Search.
//
// One interface over both data sources so routes never branch on provider.
// Switching to live Adzuna data is a .env change, not a code change.

import { config } from '../config/env.js';
import { searchFixtures, corpusTexts } from './fixtures.js';
import { searchAdzuna } from './adzuna.js';

export async function searchJobs(params = {}) {
  if (config.jobs.provider === 'adzuna') {
    return { provider: 'adzuna', jobs: await searchAdzuna(params) };
  }
  return { provider: 'fixtures', jobs: searchFixtures(params) };
}

/**
 * Background corpus for IDF fitting. Always the fixture set: term weights
 * should be stable across analyses, so they must not shift with whatever the
 * user happened to search for. Real postings the user analyzes are added on
 * top of this by the analysis pipeline.
 */
export function backgroundCorpus() {
  return corpusTexts();
}

export { searchFixtures, searchAdzuna };
