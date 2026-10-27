// Adzuna API client — the report's primary job data source (25,000 free calls
// per month). Adzuna aggregates from the major boards, so its results include
// postings that originate on Indeed and LinkedIn; neither of those offers a
// public search API of its own.

import { config } from '../config/env.js';
import { fetchJson, stripHtml, toIsoDate } from './shared.js';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

/** Map Adzuna's response shape onto the JobPosting columns in our schema. */
function normalize(result) {
  return {
    source: 'adzuna',
    external_id: String(result.id),
    title: stripHtml(result.title) || 'Untitled',
    company: result.company?.display_name ?? null,
    location: result.location?.display_name ?? null,
    // Adzuna returns HTML-ish snippets; strip tags so the NLP pipeline sees prose.
    description: stripHtml(result.description),
    salary_min: result.salary_min ?? null,
    salary_max: result.salary_max ?? null,
    url: result.redirect_url ?? null,
    // Adzuna is the one provider that resolves coordinates for us, and the
    // only reason the map works without geocoding the whole pool.
    latitude: Number.isFinite(result.latitude) ? result.latitude : null,
    longitude: Number.isFinite(result.longitude) ? result.longitude : null,
    geo_source: Number.isFinite(result.latitude) ? 'provider' : null,
    posted_at: toIsoDate(result.created),
    // Adzuna states no close date. Absence from a later sweep is the only
    // death signal it gives us, which is what the staleness TTL is for.
    closes_at: null,
  };
}

// Adzuna caps a single response at 50. Asking for more silently returns 50,
// which matters once the caller is filtering the merged pool down to one field
// and needs headroom to still fill a page.
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

export async function searchAdzuna({ query = '', location = '', limit = 20, page = 1 } = {}) {
  const { appId, appKey, country } = config.jobs.adzuna;
  if (!appId || !appKey) {
    throw Object.assign(
      new Error('Adzuna credentials are missing. Set ADZUNA_APP_ID and ADZUNA_APP_KEY, or drop adzuna from JOBS_PROVIDER.'),
      { status: 503, provider: 'Adzuna' }
    );
  }

  const perPage = Math.min(limit, PAGE_SIZE);
  const pagesNeeded = Math.min(MAX_PAGES, Math.max(1, Math.ceil(limit / PAGE_SIZE)));
  const out = [];

  for (let offset = 0; offset < pagesNeeded; offset += 1) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(perPage),
      'content-type': 'application/json',
    });
    if (query) params.set('what', query);
    if (location) params.set('where', location);

    const url = `${BASE}/${encodeURIComponent(country)}/search/${page + offset}?${params}`;
    const data = await fetchJson(url, { provider: 'Adzuna' });
    const results = data.results ?? [];
    out.push(...results.map(normalize));

    if (results.length < perPage) break;
  }

  return out;
}
