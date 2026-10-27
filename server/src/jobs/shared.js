// Plumbing common to every live job provider.
//
// Three providers with three different error shapes would otherwise each grow
// their own timeout handling and their own idea of what a failure looks like.
// The multi-provider search depends on them failing identically, so that one
// dead API degrades the result set instead of the request.

/** Job-posting HTML is inconsistent across providers; the NLP wants prose. */
export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A provider's date field, as an ISO string our schema accepts, or null. */
export function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * GET JSON with a timeout, mapping every failure onto an HTTP status our error
 * middleware understands.
 *
 * @param {string} url
 * @param {object} [options] { headers, timeoutMs, provider }
 */
export async function fetchJson(url, { headers = {}, timeoutMs = 15000, provider = 'provider' } = {}) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw Object.assign(
      new Error(timedOut
        ? `${provider} did not respond within ${timeoutMs / 1000}s.`
        : `Could not reach ${provider}: ${err.message}`),
      { status: 504, provider, cause: err }
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`${provider} returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`),
      { status: response.status === 401 || response.status === 403 ? 401 : 502, provider }
    );
  }

  try {
    return await response.json();
  } catch (err) {
    throw Object.assign(
      new Error(`${provider} returned a body that is not JSON.`),
      { status: 502, provider, cause: err }
    );
  }
}

/**
 * Client-side keyword filter, for providers with no free-text search.
 * Requires every word of the query, so "machine learning" does not match a
 * posting that merely says "learning".
 */
export function matchesQuery(job, query) {
  if (!query?.trim()) return true;
  const haystack = `${job.title} ${job.company ?? ''} ${job.description}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
