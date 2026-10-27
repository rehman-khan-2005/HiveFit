// Sweep the configured job boards and reconcile the local pool.
//
//   npm run jobs:refresh
//   npm run jobs:refresh -- "machine learning" "backend engineer"
//   npm run jobs:refresh -- --location "New York" --ttl 72
//   npm run jobs:refresh -- --verify 100      # check more listings this run
//   npm run jobs:refresh -- --prune           # also delete long-dead rows
//
// Searching already refreshes whatever the user searched for. This exists for
// the part a search cannot do: sweeping the whole set of roles the pool is
// meant to cover, so that postings nobody happened to search for this week
// still age out. Run it on a cron if you want the pool to drift without
// anybody opening the app.
//
// Three passes, because "this job is gone" arrives in three different ways:
//
//   sweep    re-sight everything the boards still serve
//   verify   fetch listings and believe the page over the board — the only
//            thing that catches a posting a board keeps serving after its page
//            has 404'd, which no amount of re-sweeping will ever notice
//   expire   infer death from silence, for listings that cannot be verified
//            (Adzuna answers 403 to any server-side request)

import { pathToFileURL } from 'node:url';
import { config } from '../config/env.js';
import { searchJobs, enabledProviders, hasLiveProvider } from './index.js';
import {
  upsertPostings, expireStale, freshnessSummary,
  postingsToVerify, markUnavailable, markChecked, prunePostings, backfillCoordinates,
} from './store.js';
import { checkListings } from './verify.js';
import { pool } from '../db/pool.js';

/**
 * Sweep every query against every configured provider, then expire what has
 * not been seen for a while.
 *
 * @param {object} args
 * @param {string[]} [args.queries]
 * @param {string}   [args.location]
 * @param {number}   [args.limit]     per query, per provider
 * @param {number}   [args.ttlHours]
 * @param {number}   [args.verifyLimit]  listings to fetch-check (0 disables)
 * @param {number}   [args.pruneAfterHours]  0 keeps dead rows forever
 * @param {function} [args.onProgress]
 * @param {function} [args.onVerified]
 */
export async function refreshJobPool({
  queries = config.jobs.refreshQueries,
  location = '',
  limit = 50,
  ttlHours = config.jobs.ttlHours,
  verifyLimit = config.jobs.verifyLimit,
  pruneAfterHours = 0,
  onProgress = () => {},
  onVerified = () => {},
} = {}) {
  const sweeps = [];
  let added = 0;
  let refreshed = 0;

  for (const query of queries) {
    // Sequential on purpose. These are third-party APIs on free tiers, and
    // firing every query at every provider at once is the fastest way to get
    // rate-limited into a 429 for the rest of the month.
    const result = await searchJobs({ query, location, limit });
    const { added: a, refreshed: r } = await upsertPostings(result.jobs);

    added += a;
    refreshed += r;
    sweeps.push({
      query,
      found: result.jobs.length,
      added: a,
      refreshed: r,
      providers: result.providers,
    });
    onProgress(sweeps[sweeps.length - 1]);
  }

  // Verify before expiring, so a listing confirmed gone is recorded as such
  // rather than waiting a week to be guessed at.
  let verified = { checked: 0, gone: 0, inconclusive: 0 };
  if (verifyLimit > 0) {
    const candidates = await postingsToVerify({ limit: verifyLimit });
    if (candidates.length > 0) {
      const { gone, unknown, blockedHosts } = await checkListings(candidates, { onResult: onVerified });
      await markUnavailable(gone);
      await markChecked(unknown);
      verified = {
        checked: candidates.length,
        gone: gone.length,
        inconclusive: unknown.length,
        blockedHosts,
      };
    }
  }

  // Free — the gazetteer is offline, so this is CPU over rows we already hold.
  const located = await backfillCoordinates();

  const expiry = await expireStale({ ttlHours });
  const pruned = pruneAfterHours > 0 ? await prunePostings({ olderThanHours: pruneAfterHours }) : 0;
  const summary = await freshnessSummary();

  return { sweeps, added, refreshed, ...expiry, verified, located, pruned, summary };
}

/** Minimal flag parsing, so the script stays dependency-free. */
function parseArgs(argv) {
  const queries = [];
  let location = '';
  let ttlHours = config.jobs.ttlHours;
  let limit = 50;
  let verifyLimit = config.jobs.verifyLimit;
  let pruneAfterHours = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--location') { location = argv[++i] ?? ''; }
    else if (arg === '--ttl') { ttlHours = Number(argv[++i]); }
    else if (arg === '--limit') { limit = Number(argv[++i]); }
    else if (arg === '--verify') { verifyLimit = Number(argv[++i]); }
    else if (arg === '--no-verify') { verifyLimit = 0; }
    // Expiry already hides them; this reclaims the rows. Default off, because
    // deleting is the one step here that cannot be undone by another sweep.
    else if (arg === '--prune') { pruneAfterHours = Number(argv[i + 1]) > 0 ? Number(argv[++i]) : 720; }
    else queries.push(arg);
  }

  return {
    queries: queries.length > 0 ? queries : config.jobs.refreshQueries,
    location, ttlHours, limit, verifyLimit, pruneAfterHours,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`sweeping ${enabledProviders().join(', ')} for ${options.queries.length} quer${options.queries.length === 1 ? 'y' : 'ies'}`);
  if (!hasLiveProvider()) {
    console.log('\n  note: JOBS_PROVIDER is the offline fixture set, so nothing will change.');
    console.log('  set JOBS_PROVIDER=adzuna,muse in .env for live listings.\n');
  }

  let firstVerify = true;
  const report = await refreshJobPool({
    ...options,
    onProgress: (sweep) => {
      const failed = sweep.providers.filter((p) => !p.ok);
      console.log(`  "${sweep.query}" — ${sweep.found} found, ${sweep.added} new, ${sweep.refreshed} still listed`);
      for (const provider of failed) console.log(`      ! ${provider.label}: ${provider.error}`);
    },
    onVerified: (record) => {
      if (firstVerify) {
        console.log(`\nchecking up to ${options.verifyLimit} listings are still there`);
        firstVerify = false;
      }
      // Only the deaths are worth a line; a healthy listing is the norm.
      if (record.status === 'gone') {
        console.log(`  gone  [${record.source}] ${record.title.slice(0, 48)} — ${record.reason}`);
      }
    },
  });

  const { summary, verified } = report;
  console.log('');
  console.log(`added      ${report.added}`);
  console.log(`refreshed  ${report.refreshed}`);
  console.log(`confirmed  ${verified.gone} gone of ${verified.checked} checked${verified.inconclusive > 0 ? ` (${verified.inconclusive} could not be verified)` : ''}`);
  for (const host of verified.blockedHosts ?? []) {
    console.log(`           ${host} blocks automated checks — those listings rely on the staleness TTL`);
  }
  console.log(`located    ${report.located.located} placed on the map of ${report.located.examined} without coordinates`);
  console.log(`delisted   ${report.expired}${report.byDeadline > 0 ? ` (${report.byDeadline} past their stated close date)` : ''}`);
  if (report.pruned > 0) console.log(`pruned     ${report.pruned} dead rows deleted`);
  console.log('');
  console.log(`pool now:  ${summary.active} available · ${summary.confirmedGone} confirmed gone · ${summary.addedToday} added in the last 24h`);
  console.log(`unseen postings expire after ${summary.ttlHours}h; unverifiable ones rely on that alone`);

  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`\njobs:refresh failed — ${err.message}\n`);
    process.exit(1);
  });
}
