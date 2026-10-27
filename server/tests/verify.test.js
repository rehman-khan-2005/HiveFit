import test from 'node:test';
import assert from 'node:assert/strict';

import { checkListing, checkListings } from '../src/jobs/verify.js';

/** A stub fetch returning one canned response. */
function stubFetch({ status = 200, body = '', ok = null, throws = null }) {
  return async () => {
    if (throws) throw Object.assign(new Error(throws), { name: throws });
    return {
      status,
      ok: ok ?? (status >= 200 && status < 300),
      text: async () => body,
      body: null,
    };
  };
}

test('a 404 is proof the listing is gone', async () => {
  const r = await checkListing('https://example.com/j/1', { fetchImpl: stubFetch({ status: 404 }) });
  assert.equal(r.status, 'gone');
  assert.equal(r.httpStatus, 404);
});

test('a 410 is proof the listing is gone', async () => {
  const r = await checkListing('https://example.com/j/1', { fetchImpl: stubFetch({ status: 410 }) });
  assert.equal(r.status, 'gone');
});

test('a soft 404 is caught by what the page says', async () => {
  // Boards serve "job not found" with HTTP 200 constantly; status alone misses
  // the majority of dead listings.
  const r = await checkListing('https://example.com/j/1', {
    fetchImpl: stubFetch({ status: 200, body: '<h1>Job not found</h1>' }),
  });
  assert.equal(r.status, 'gone');
  assert.match(r.reason, /job not found/i);
});

test('a healthy listing page is never called gone', async () => {
  const r = await checkListing('https://example.com/j/1', {
    fetchImpl: stubFetch({ status: 200, body: '<h1>Backend Engineer</h1><p>Apply now</p>' }),
  });
  assert.equal(r.status, 'unknown');
});

test('being blocked is not evidence of death', async () => {
  // This is the rule that matters most. Adzuna answers 403 to every
  // server-side request; treating that as "gone" would hide its entire feed.
  for (const status of [403, 429, 500, 503]) {
    const r = await checkListing('https://example.com/j/1', { fetchImpl: stubFetch({ status }) });
    assert.equal(r.status, 'unknown', `HTTP ${status} must be inconclusive`);
  }
});

test('a timeout or network failure is inconclusive', async () => {
  const timeout = await checkListing('https://example.com/j/1', { fetchImpl: stubFetch({ throws: 'TimeoutError' }) });
  assert.equal(timeout.status, 'unknown');
  assert.match(timeout.reason, /timed out/);

  const dns = await checkListing('https://example.com/j/1', { fetchImpl: stubFetch({ throws: 'TypeError' }) });
  assert.equal(dns.status, 'unknown');
});

test('a missing or non-http url is inconclusive, never gone', async () => {
  for (const url of [null, '', 'mailto:a@b.c', 'javascript:void 0']) {
    const r = await checkListing(url, { fetchImpl: stubFetch({ status: 404 }) });
    assert.equal(r.status, 'unknown', `${url} should not be fetched at all`);
  }
});

test('checkListings splits the batch into gone and unknown', async () => {
  const postings = [
    { id: 1, url: 'https://a.example/1' },
    { id: 2, url: 'https://a.example/2' },
  ];
  const fetchImpl = async (url) => ({
    status: url.endsWith('/1') ? 404 : 200,
    ok: !url.endsWith('/1'),
    text: async () => 'Backend Engineer',
    body: null,
  });

  const { gone, unknown } = await checkListings(postings, { fetchImpl, concurrency: 2 });
  assert.deepEqual(gone, [1]);
  assert.deepEqual(unknown, [2]);
});

test('a host that keeps refusing is dropped rather than retried', async () => {
  // Otherwise the whole per-run budget drains into one blocking host and never
  // reaches the ones where checking resolves anything.
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return { status: 403, ok: false, text: async () => '', body: null };
  };

  const postings = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, url: `https://blocked.example/${i}` }));
  const { gone, unknown, blockedHosts } = await checkListings(postings, {
    fetchImpl, concurrency: 1, blockedAfter: 3,
  });

  assert.equal(gone.length, 0, 'a blocking host must never produce a death');
  assert.equal(unknown.length, 20, 'every posting is still accounted for');
  assert.ok(requests <= 4, `expected to stop after the host refused, made ${requests} requests`);
  assert.deepEqual(blockedHosts, ['blocked.example']);
});

test('one blocking host does not stop another host being checked', async () => {
  const postings = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, url: `https://blocked.example/${i}` })),
    { id: 99, url: 'https://good.example/dead' },
  ];
  const fetchImpl = async (url) => (url.includes('blocked')
    ? { status: 403, ok: false, text: async () => '', body: null }
    : { status: 404, ok: false, text: async () => '', body: null });

  const { gone } = await checkListings(postings, { fetchImpl, concurrency: 1, blockedAfter: 3 });
  assert.deepEqual(gone, [99]);
});
