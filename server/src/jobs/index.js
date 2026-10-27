// Process 4.0 — Job Search.
//
// One interface over every data source so routes never branch on provider.
// Which sources are live is a .env change, not a code change.
//
// Providers run concurrently and fail independently: a dead API degrades the
// result set rather than the request. That matters more here than it looks —
// the whole point of pulling from live boards is that the pool changes day to
// day, and a pool that changes is a pool that will occasionally 502 at you.

import { config } from '../config/env.js';
import { searchFixtures, corpusTexts } from './fixtures.js';
import { searchAdzuna } from './adzuna.js';
import { searchMuse } from './muse.js';
import { searchAmazon } from './amazon.js';
import { searchGreenhouse } from './greenhouse.js';

const PROVIDERS = {
  fixtures: { label: 'Offline sample set', search: searchFixtures, live: false },
  adzuna: { label: 'Adzuna', search: searchAdzuna, live: true },
  muse: { label: 'The Muse', search: searchMuse, live: true },
  amazon: { label: 'Amazon Jobs', search: searchAmazon, live: true },
  greenhouse: { label: 'Company boards (Greenhouse)', search: searchGreenhouse, live: true },
};

/** Configured providers, in order, ignoring names we do not implement. */
export function enabledProviders() {
  const names = config.jobs.providers.filter((name) => PROVIDERS[name]);
  return names.length > 0 ? names : ['fixtures'];
}

/** Whether any configured provider actually talks to a job board. */
export function hasLiveProvider() {
  return enabledProviders().some((name) => PROVIDERS[name].live);
}

/** Cross-source duplicate key: the same job listed on two boards. */
function dedupeKey(job) {
  const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(job.title)}|${norm(job.company)}`;
}

/**
 * Round-robin rather than concatenate.
 *
 * Concatenating means the first provider fills the page and the others are
 * never seen at a limit of 20. Interleaving keeps every source represented,
 * which is the reason for running more than one of them.
 */
function interleave(lists, limit) {
  const merged = [];
  const seenIds = new Set();
  const seenJobs = new Set();
  const depth = Math.max(0, ...lists.map((list) => list.length));

  for (let i = 0; i < depth && merged.length < limit; i += 1) {
    for (const list of lists) {
      if (merged.length >= limit) break;
      const job = list[i];
      if (!job) continue;

      const idKey = `${job.source}:${job.external_id}`;
      const jobKey = dedupeKey(job);
      if (seenIds.has(idKey) || seenJobs.has(jobKey)) continue;

      seenIds.add(idKey);
      seenJobs.add(jobKey);
      merged.push(job);
    }
  }
  return merged;
}

/**
 * Search every configured provider.
 *
 * @returns {Promise<{provider: string, providers: object[], jobs: object[], live: boolean, degraded: boolean}>}
 */
export async function searchJobs(params = {}) {
  const limit = params.limit ?? 20;
  const names = enabledProviders();

  // How many to ask each provider for.
  //
  // The ceiling is well above one page because both live clients page
  // internally now, and a caller narrowing the pool to a single field has to
  // start from far more than a page: a blank query comes back mostly
  // healthcare, so filtering to Technology from 50 results yields a handful.
  // Headroom for de-duplication is only worth paying for when there is more
  // than one provider to collide.
  const perProvider = Math.min(
    200,
    names.length > 1 ? Math.ceil((limit * 1.5) / names.length) : limit
  );

  const settled = await Promise.allSettled(
    names.map((name) => PROVIDERS[name].search({ ...params, limit: perProvider }))
  );

  const report = [];
  const lists = [];

  settled.forEach((outcome, index) => {
    const name = names[index];
    if (outcome.status === 'fulfilled') {
      report.push({ name, label: PROVIDERS[name].label, ok: true, count: outcome.value.length, error: null });
      lists.push(outcome.value);
    } else {
      report.push({
        name, label: PROVIDERS[name].label, ok: false, count: 0,
        error: outcome.reason?.message ?? 'Unknown provider error',
      });
    }
  });

  let jobs = interleave(lists, limit);

  // Every live provider is down or unconfigured. Falling back keeps the app
  // usable — the README promises it runs with no API keys at all, and a demo
  // that shows an empty screen because a third party is having a bad morning
  // is worse than a demo that shows sample data and says so.
  const degraded = jobs.length === 0 && !names.includes('fixtures');
  if (degraded) {
    jobs = searchFixtures({ ...params, limit });
    report.push({ name: 'fixtures', label: PROVIDERS.fixtures.label, ok: true, count: jobs.length, error: null });
  }

  return {
    provider: report.filter((r) => r.ok && r.count > 0).map((r) => r.name).join('+') || 'none',
    providers: report,
    jobs,
    live: hasLiveProvider() && !degraded,
    degraded,
  };
}

/**
 * Background corpus for IDF fitting. Always the fixture set: term weights
 * should be stable across analyses, so they must not shift with whatever the
 * user happened to search for, nor with which postings a live board served
 * that morning. Real postings the user analyzes are added on top of this by
 * the analysis pipeline.
 */
export function backgroundCorpus() {
  return corpusTexts();
}

export { searchFixtures, searchAdzuna, searchMuse, searchAmazon, searchGreenhouse };
