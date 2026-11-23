// Plumbing common to every live job provider.
//
// Three providers with three different error shapes would otherwise each grow
// their own timeout handling and their own idea of what a failure looks like.
// The multi-provider search depends on them failing identically, so that one
// dead API degrades the result set instead of the request.

/** Job-posting HTML is inconsistent across providers; the NLP wants prose. */
const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  '#39': "'", '#34': '"', ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'",
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', bull: '\u2022',
};

/** One pass of entity decoding. Named, decimal and hex forms. */
function decodeEntities(value) {
  return value
    .replace(/&([a-z]+|#\d{1,6}|#x[0-9a-f]{1,5});/gi, (whole, body) => {
      const key = body.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith('#x')) {
        const code = parseInt(key.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      if (key.startsWith('#')) {
        const code = Number(key.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ' ';
    });
}

/**
 * A job board's description as plain text.
 *
 * Decoding runs before tag stripping, and both repeat until the text stops
 * changing. Greenhouse and The Muse serve descriptions that are escaped twice
 * — the markup arrives as `&lt;div class=&quot;intro&quot;&gt;` — so decoding
 * once and stripping once turns the entities into tags only after the tag
 * stripper has already run, and the markup is stored as if it were prose.
 *
 * That is not cosmetic. Every one of those tokens ("div", "class", "quot",
 * "span", "style") enters the TF-IDF vocabulary, which is fitted across the
 * whole corpus, so markup in one provider's postings shifts the term weights
 * used to score every other provider's too.
 */
export function stripHtml(value) {
  let text = String(value ?? '');

  // Twice is enough for the double-escaping seen in practice; the cap stops a
  // pathological input from looping.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = decodeEntities(text)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ');
    if (text === before) break;
  }

  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
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
