// Company career pages hosted on Greenhouse, via its documented public Job
// Board API: https://boards-api.greenhouse.io/v1/boards/{token}/jobs
//
// This is the answer to "check the big names' own hiring sites" that scales.
// Greenhouse is the ATS behind a large share of tech companies' own career
// pages, and it publishes an explicitly public, unauthenticated, documented
// read API for exactly this purpose. One client therefore reaches many
// companies' first-party boards without scraping any of them.
//
// Boards are configured rather than hard-coded so the team can add a company
// without a code change: GREENHOUSE_BOARDS=stripe,databricks,...

import { config } from '../config/env.js';
import { fetchJson, stripHtml, toIsoDate, matchesQuery } from './shared.js';

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

/** Map a Greenhouse job onto our JobPosting columns. */
function normalize(job, board) {
  return {
    source: 'greenhouse',
    // Board-qualified: two companies can and do collide on numeric ids.
    external_id: `${board}:${job.id}`,
    title: stripHtml(job.title) || 'Untitled',
    // Greenhouse does not return a display name on the jobs endpoint, so the
    // board token stands in — "stripe" reads correctly enough capitalized.
    company: board.charAt(0).toUpperCase() + board.slice(1),
    location: job.location?.name ?? null,
    description: stripHtml(job.content),
    salary_min: null,
    salary_max: null,
    url: job.absolute_url ?? null,
    posted_at: toIsoDate(job.updated_at ?? job.first_published),
    closes_at: null,
  };
}

/** One company's board. */
async function searchBoard(board, { query, limit }) {
  const data = await fetchJson(`${BASE}/${encodeURIComponent(board)}/jobs?content=true`, {
    provider: `Greenhouse (${board})`,
  });

  const jobs = (data.jobs ?? [])
    .map((job) => normalize(job, board))
    .filter((job) => job.description.length > 0);

  // The API returns a company's whole board with no query parameter, so the
  // keyword match has to happen here.
  return (query ? jobs.filter((job) => matchesQuery(job, query)) : jobs).slice(0, limit);
}

export async function searchGreenhouse({ query = '', limit = 20 } = {}) {
  const boards = config.jobs.greenhouseBoards;
  if (boards.length === 0) {
    throw Object.assign(
      new Error('No Greenhouse boards configured. Set GREENHOUSE_BOARDS, or drop greenhouse from JOBS_PROVIDER.'),
      { status: 503, provider: 'Greenhouse' }
    );
  }

  // Each board is a separate company and a separate request, so one company
  // renaming its board must not take the rest down with it.
  const perBoard = Math.max(2, Math.ceil(limit / boards.length));
  const settled = await Promise.allSettled(
    boards.map((board) => searchBoard(board, { query, limit: perBoard }))
  );

  const jobs = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []));

  if (jobs.length === 0) {
    const reason = settled.find((o) => o.status === 'rejected')?.reason;
    if (reason) throw reason;
  }
  return jobs.slice(0, limit);
}
