// Adzuna API client — the report's primary job data source (25,000 free calls
// per month). Reached only when JOBS_PROVIDER=adzuna and credentials are set.

import { config } from '../config/env.js';

const BASE = 'https://api.adzuna.com/v1/api/jobs';

/** Map Adzuna's response shape onto the JobPosting columns in our schema. */
function normalize(result) {
  return {
    source: 'adzuna',
    external_id: String(result.id),
    title: result.title?.replace(/<[^>]*>/g, '').trim() ?? 'Untitled',
    company: result.company?.display_name ?? null,
    location: result.location?.display_name ?? null,
    // Adzuna returns HTML-ish snippets; strip tags so the NLP pipeline sees prose.
    description: (result.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    salary_min: result.salary_min ?? null,
    salary_max: result.salary_max ?? null,
    url: result.redirect_url ?? null,
  };
}

export async function searchAdzuna({ query = '', location = '', limit = 20, page = 1 } = {}) {
  const { appId, appKey, country } = config.jobs.adzuna;
  if (!appId || !appKey) {
    throw Object.assign(
      new Error('Adzuna credentials are missing. Set ADZUNA_APP_ID and ADZUNA_APP_KEY, or use JOBS_PROVIDER=fixtures.'),
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(Math.min(limit, 50)),
    'content-type': 'application/json',
  });
  if (query) params.set('what', query);
  if (location) params.set('where', location);

  const url = `${BASE}/${encodeURIComponent(country)}/search/${page}?${params}`;

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw Object.assign(
      new Error(`Could not reach Adzuna: ${err.message}`),
      { status: 504, cause: err }
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`Adzuna returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`),
      { status: response.status === 401 ? 401 : 502 }
    );
  }

  const data = await response.json();
  return (data.results ?? []).map(normalize);
}
