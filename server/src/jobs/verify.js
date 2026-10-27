// Is this listing still actually there?
//
// Absence from a sweep is weak evidence and slow: the TTL has to be generous
// because boards drop and re-list constantly, so a dead posting can linger for
// a week. Worse, a board that keeps serving a listing whose page is already
// gone will never trip the TTL at all — every sweep re-sights it. The Muse
// does exactly this, and in a sample of its live feed most landing pages had
// already become "job not found".
//
// So this fetches the listing and reads the answer off the page. The rule it
// follows matters more than the mechanism: ONLY mark a posting dead on
// unambiguous evidence. A false negative leaves one stale row in a list. A
// false positive hides a job the user could have applied for, which is the
// whole product failing. So anything short of proof is "unknown":
//
//   gone     404 or 410, or a 200 page that says in so many words that the
//            posting is no longer there (boards serve soft 404s constantly)
//   unknown  403, 429, 5xx, redirects to a search page, timeouts, DNS
//            failures — every form of "we could not tell"
//
// Adzuna is the reason `unknown` has to be a first-class outcome rather than
// an error: it answers 403 to every server-side request, so its listings can
// never be verified this way and must fall back to the staleness TTL.

const TIMEOUT_MS = 12000;

// Phrases that only appear when a board is telling you the posting is gone.
// Deliberately short: every addition here is a chance to hide a live job.
const GONE_MARKERS = [
  'job not found',
  'no longer available',
  'no longer accepting applications',
  'this job has expired',
  'this position has been filled',
  'posting has closed',
  'position is no longer open',
  'vacancy has expired',
  'job you are looking for is no longer',
];

// Only read enough of the page to find a marker. Job pages carry a lot of
// script payload, and a verification pass should not download megabytes.
const MAX_BODY_BYTES = 200_000;

/**
 * Check one listing URL.
 * @returns {Promise<{status: 'gone'|'unknown', reason: string, httpStatus: number|null}>}
 */
export async function checkListing(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { status: 'unknown', reason: 'no usable url', httpStatus: null };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      // Some boards serve a different page to an obvious bot. Asking for HTML
      // as a browser would is about getting a representative answer, not about
      // evading anything — a 403 is still taken at face value below.
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'HiveFit/0.1 (+listing availability check)' },
    });
  } catch (err) {
    return { status: 'unknown', reason: err?.name === 'TimeoutError' ? 'timed out' : `unreachable (${err?.message ?? 'error'})`, httpStatus: null };
  }

  const httpStatus = response.status;

  if (httpStatus === 404 || httpStatus === 410) {
    return { status: 'gone', reason: `HTTP ${httpStatus}`, httpStatus };
  }

  // Everything else non-OK is a failure to determine, not a death certificate.
  // 403 and 429 in particular mean "we were blocked", which says nothing about
  // whether the job exists.
  if (!response.ok) {
    return { status: 'unknown', reason: `HTTP ${httpStatus}`, httpStatus };
  }

  let body;
  try {
    body = (await readCapped(response)).toLowerCase();
  } catch {
    return { status: 'unknown', reason: 'body unreadable', httpStatus };
  }

  const marker = GONE_MARKERS.find((phrase) => body.includes(phrase));
  if (marker) {
    return { status: 'gone', reason: `page says "${marker}"`, httpStatus };
  }

  return { status: 'unknown', reason: 'page loaded with no removal notice', httpStatus };
}

/** Read at most MAX_BODY_BYTES of a response body. */
async function readCapped(response) {
  if (!response.body?.getReader) return (await response.text()).slice(0, MAX_BODY_BYTES);

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  try {
    while (out.length < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out.slice(0, MAX_BODY_BYTES);
}

/**
 * Check many listings with a bounded number in flight.
 *
 * @param {object[]} postings  rows with { id, url }
 * @param {object} [options] { concurrency, onResult, fetchImpl, timeoutMs }
 * @returns {Promise<{gone: number[], unknown: number[], results: object[]}>}
 */
export async function checkListings(postings, {
  concurrency = 6, onResult = () => {}, blockedAfter = 3, ...rest
} = {}) {
  const queue = [...postings];
  const gone = [];
  const unknown = [];
  const results = [];

  // A host that answers 403 once will answer 403 every time. Without this the
  // budget drains into Adzuna — which blocks server-side requests wholesale —
  // and never reaches the hosts where checking actually resolves anything.
  const refusals = new Map();
  const blocked = new Set();

  const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };

  async function worker() {
    for (;;) {
      const posting = queue.shift();
      if (!posting) return;

      const host = hostOf(posting.url);
      if (host && blocked.has(host)) {
        // Counted as checked so it moves to the back of the queue rather than
        // being retried immediately on the next run.
        const record = { ...posting, status: 'unknown', reason: `${host} blocks automated checks`, httpStatus: null };
        results.push(record);
        unknown.push(posting.id);
        onResult(record);
        continue;
      }

      const outcome = await checkListing(posting.url, rest);
      const record = { ...posting, ...outcome };

      if (host && (outcome.httpStatus === 403 || outcome.httpStatus === 429)) {
        const count = (refusals.get(host) ?? 0) + 1;
        refusals.set(host, count);
        if (count >= blockedAfter) blocked.add(host);
      }

      results.push(record);
      (outcome.status === 'gone' ? gone : unknown).push(posting.id);
      onResult(record);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, postings.length || 1)) }, worker)
  );

  return { gone, unknown, results, blockedHosts: [...blocked] };
}
