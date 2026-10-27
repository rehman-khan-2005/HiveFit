// Amazon's own careers site, via the public JSON endpoint its search page
// calls: https://www.amazon.jobs/en/search.json
//
// This is not scraping. The page fetches this endpoint itself, it returns
// structured JSON rather than HTML, and amazon.jobs/robots.txt disallows only
// /internal paths — the search path is permitted. See docs/job-sources.md for
// the audit behind that claim.
//
// Worth having for a reason beyond coverage: unlike an aggregator, a company
// board is first-party, so a listing that disappears has actually closed
// rather than merely aged out of a syndication feed.

import { fetchJson, stripHtml, toIsoDate, matchesQuery } from './shared.js';

const BASE = 'https://www.amazon.jobs/en/search.json';

/** Map Amazon's response shape onto our JobPosting columns. */
function normalize(job) {
  // The posting text is split across three fields and the skills live in the
  // qualifications, which is exactly what the gap analysis needs.
  const description = stripHtml([
    job.description ?? '',
    job.basic_qualifications ? `Basic qualifications:\n${job.basic_qualifications}` : '',
    job.preferred_qualifications ? `Preferred qualifications:\n${job.preferred_qualifications}` : '',
  ].filter(Boolean).join('\n\n'));

  const city = [job.city, job.state].filter(Boolean).join(', ');

  return {
    source: 'amazon',
    external_id: String(job.id_icims ?? job.id ?? ''),
    title: stripHtml(job.title) || 'Untitled',
    company: 'Amazon',
    location: city || job.location || job.normalized_location || null,
    description,
    // Amazon publishes no salary on these listings.
    salary_min: null,
    salary_max: null,
    url: job.job_path ? `https://www.amazon.jobs${job.job_path}` : null,
    posted_at: toIsoDate(job.posted_date ?? job.updated_time),
    closes_at: null,
  };
}

export async function searchAmazon({ query = '', location = '', limit = 20 } = {}) {
  const params = new URLSearchParams({
    result_limit: String(Math.min(limit, 100)),
    sort: 'recent',
  });
  if (query) params.set('base_query', query);
  if (location) params.set('loc_query', location);

  const data = await fetchJson(`${BASE}?${params}`, { provider: 'Amazon Jobs' });

  const jobs = (data.jobs ?? [])
    .map(normalize)
    .filter((job) => job.external_id && job.description.length > 0);

  // base_query is a relevance search rather than a filter, so a narrow query
  // still returns loosely related roles. The caller asked for the words.
  return query ? jobs.filter((job) => matchesQuery(job, query)) : jobs;
}
