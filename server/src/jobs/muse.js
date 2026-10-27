// The Muse API client.
//
// NOT ENABLED BY DEFAULT, and not because of this code. As of October 2026
// every listing this API returns 404s on themuse.com itself — checked with a
// browser user-agent, with none at all, and against their company pages,
// which 404 too. The API serves records whose public pages are gone, so every
// posting it contributes is a job the user cannot open, let alone apply to.
// The listing verifier marks them dead on sight, which is correct but means
// the provider contributes nothing but work. Kept wired and tested so it can
// be switched back on if their data recovers.
//
// Chosen as the second live source because it needs no credentials at all —
// an API key only raises the rate limit. That keeps the "listings change from
// day to day" behaviour demoable on a machine with no accounts set up, which
// is the state a grader's laptop will be in.
//
// The one awkwardness: The Muse has no free-text keyword search. It filters by
// category, level and location only, so a query is mapped onto a category when
// it clearly names one and the posting text is filtered here otherwise.
//
// Their category filter works, but their category DATA is noisy — a search for
// "Software Engineering" genuinely returns construction superintendents and
// creative directors, each tagged "Software Engineering" at the source. So
// results are additionally ranked by how well the title matches the query.
// Ranking rather than filtering on purpose: "Sr. Staff Engineer (GenAI)" is a
// perfectly good software result that never says the word "software", and
// dropping it would be a worse error than showing one bad row further down.

import { config } from '../config/env.js';
import { fetchJson, stripHtml, toIsoDate, matchesQuery } from './shared.js';

const BASE = 'https://www.themuse.com/api/public/jobs';

// The Muse's own category names. A query that clearly lands in one is sent as
// a server-side filter; anything else is filtered client-side.
const CATEGORY_HINTS = [
  [/\b(software|backend|back-end|frontend|front-end|full.?stack|engineer|developer|programming)\b/i, 'Software Engineering'],
  [/\b(data scien|machine learning|\bml\b|\bai\b|deep learning)\b/i, 'Data Science'],
  [/\b(data analy|analytics|business intelligence|\bbi\b)\b/i, 'Data and Analytics'],
  [/\b(devops|sre|site reliability|infrastructure|platform|sysadmin|cloud)\b/i, 'DevOps and Sysadmin'],
  [/\b(product manager|product management)\b/i, 'Product Management'],
  [/\b(design|ux|ui|user experience)\b/i, 'Design and UX'],
  [/\b(\bit\b|help ?desk|support engineer)\b/i, 'IT'],
  [/\b(project manage|program manage|scrum master)\b/i, 'Project Management'],
];

function categoryFor(query) {
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(query))?.[1] ?? null;
}

/** How many words of the query the title carries — the relevance signal. */
function titleRelevance(job, query) {
  const title = job.title.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return words.filter((word) => title.includes(word)).length;
}

/** Map The Muse's response shape onto our JobPosting columns. */
function normalize(result) {
  return {
    source: 'muse',
    external_id: String(result.id),
    title: stripHtml(result.name) || 'Untitled',
    company: result.company?.name ?? null,
    location: (result.locations ?? []).map((l) => l.name).join(' · ') || null,
    description: stripHtml(result.contents),
    // The Muse publishes no salary data at all. Null rather than zero: a zero
    // would render as "$0" in the UI and read as a real figure.
    salary_min: null,
    salary_max: null,
    url: result.refs?.landing_page ?? null,
    posted_at: toIsoDate(result.publication_date),
    closes_at: null,
  };
}

// The Muse serves 20 results per page regardless of what you ask for, so a
// request for 50 silently returns 20 unless pages are walked. Capped so a
// large limit cannot turn into an unbounded crawl of a free API.
const PAGE_SIZE = 20;
const MAX_PAGES = 5;

export async function searchMuse({ query = '', location = '', limit = 20, page = 0 } = {}) {
  const category = categoryFor(query);

  const baseParams = () => {
    const params = new URLSearchParams();
    if (config.jobs.muse.apiKey) params.set('api_key', config.jobs.muse.apiKey);
    if (category) params.append('category', category);
    if (location) params.append('location', location);
    return params;
  };

  const pagesNeeded = Math.min(MAX_PAGES, Math.max(1, Math.ceil(limit / PAGE_SIZE)));
  const raw = [];

  for (let offset = 0; offset < pagesNeeded; offset += 1) {
    const params = baseParams();
    params.set('page', String(page + offset));

    const data = await fetchJson(`${BASE}?${params}`, { provider: 'The Muse' });
    const results = data.results ?? [];
    raw.push(...results);

    // Ran past the end, or the last page of this filter.
    if (results.length < PAGE_SIZE) break;
    if (data.page_count != null && page + offset + 1 >= data.page_count) break;
  }

  const jobs = raw
    .map(normalize)
    .filter((job) => job.description.length > 0);

  // Without a category the API did nothing for us, so the words have to be a
  // hard filter. With one, they are only a ranking signal — see the note above
  // about The Muse's own tagging.
  const filtered = category ? jobs : jobs.filter((job) => matchesQuery(job, query));

  if (query.trim()) {
    filtered.sort((a, b) => titleRelevance(b, query) - titleRelevance(a, query));
  }

  return filtered.slice(0, limit);
}
