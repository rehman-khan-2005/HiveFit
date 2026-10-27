import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config/env.js';
import { searchJobs, enabledProviders, hasLiveProvider } from '../src/jobs/index.js';
import { searchFixtures } from '../src/jobs/fixtures.js';
import { searchMuse } from '../src/jobs/muse.js';
import { searchAmazon } from '../src/jobs/amazon.js';
import { searchGreenhouse } from '../src/jobs/greenhouse.js';
import { stripHtml, toIsoDate, matchesQuery } from '../src/jobs/shared.js';
import { classifyRole } from '../src/jobs/roles.js';
import { classifyField, FIELDS } from '../src/jobs/fields.js';

/**
 * Run a body with a provider's credentials blanked.
 *
 * Tests must not depend on what happens to be in .env — a developer with real
 * Adzuna keys and one without should get the same result.
 */
async function withoutCredentials(name, body) {
  const original = config.jobs[name];
  config.jobs[name] = Object.fromEntries(Object.keys(original).map((k) => [k, '']));
  try { return await body(); } finally { config.jobs[name] = original; }
}

/** Run a body with JOBS_PROVIDER temporarily set to something else. */
async function withProviders(providers, body) {
  const original = config.jobs.providers;
  config.jobs.providers = providers;
  try { return await body(); } finally { config.jobs.providers = original; }
}

/** Swap global fetch for a stub serving full 20-result pages. */
async function withPagedFetch(totalPages, body) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get('page') ?? 0);
    const isLast = page >= totalPages - 1;
    const results = Array.from({ length: isLast ? 7 : 20 }, (_, i) => ({
      id: page * 100 + i,
      name: `Software Engineer ${page}-${i}`,
      contents: '<p>Build things.</p>',
      company: { name: 'Acme' },
      locations: [],
      refs: {},
    }));
    const payload = { page, page_count: totalPages, results };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try { return await body(calls); } finally { globalThis.fetch = original; }
}

/** Swap global fetch for one canned JSON response. */
async function withFetch(payload, body) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try { return await body(calls); } finally { globalThis.fetch = original; }
}

test('stripHtml turns provider markup into prose the NLP can read', () => {
  const html = '<p>Build <b>React</b> apps.</p><ul><li>Node.js</li></ul>&amp; more';
  const text = stripHtml(html);

  assert.ok(!text.includes('<'), 'no tags should survive');
  assert.ok(text.includes('React'));
  assert.ok(text.includes('Node.js'));
  assert.ok(text.includes('&'), 'entities should decode, not vanish');
});

test('toIsoDate normalizes provider dates and rejects junk', () => {
  assert.equal(toIsoDate('2026-03-04T10:00:00Z'), '2026-03-04 10:00:00');
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate('not a date'), null);
});

test('client-side keyword filter requires every word', () => {
  const job = { title: 'ML Engineer', company: 'X', description: 'machine learning at scale' };
  assert.ok(matchesQuery(job, 'machine learning'));
  assert.ok(!matchesQuery(job, 'machine welding'));
  assert.ok(matchesQuery(job, ''), 'an empty query matches everything');
});

test('an unknown provider name falls back to fixtures rather than returning nothing', async () => {
  await withProviders(['nonsense'], async () => {
    assert.deepEqual(enabledProviders(), ['fixtures']);
    const { jobs } = await searchJobs({ limit: 5 });
    assert.ok(jobs.length > 0);
  });
});

test('fixtures are not treated as a live source', async () => {
  await withProviders(['fixtures'], () => {
    assert.equal(hasLiveProvider(), false);
  });
  await withProviders(['fixtures', 'muse'], () => {
    assert.equal(hasLiveProvider(), true);
  });
});

test('a failing provider degrades the results, not the request', async () => {
  await withoutCredentials('adzuna', () => withProviders(['fixtures', 'adzuna'], async () => {
    const result = await searchJobs({ query: 'engineer', limit: 5 });

    assert.ok(result.jobs.length > 0, 'the working provider still returns');
    const failed = result.providers.find((p) => p.name === 'adzuna');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /Adzuna/);
  }));
});

test('every provider failing falls back to the offline set', async () => {
  await withoutCredentials('adzuna', () => withProviders(['adzuna'], async () => {
    const result = await searchJobs({ query: 'engineer', limit: 5 });
    assert.equal(result.degraded, true);
    assert.equal(result.live, false, 'a fallback result must not claim to be live');
    assert.ok(result.jobs.length > 0);
  }));
});

test('search results never exceed the requested limit', async () => {
  await withProviders(['fixtures'], async () => {
    const { jobs } = await searchJobs({ limit: 3 });
    assert.ok(jobs.length <= 3, `got ${jobs.length}`);
  });
});

test('fixtures carry the same lifecycle fields as live providers', () => {
  const [job] = searchFixtures({ limit: 1 });
  assert.ok('posted_at' in job, 'the store reads posted_at off every posting');
  assert.ok('closes_at' in job);
  assert.equal(job.source, 'fixtures');
});

test('The Muse response maps onto our posting shape', async () => {
  const payload = {
    results: [{
      id: 42,
      name: 'Backend Engineer',
      contents: '<p>Write <b>Python</b> services.</p>',
      company: { name: 'Northwind' },
      locations: [{ name: 'New York, NY' }, { name: 'Remote' }],
      refs: { landing_page: 'https://example.com/42' },
      publication_date: '2026-03-04T10:00:00Z',
    }],
  };

  await withFetch(payload, async () => {
    const [job] = await searchMuse({ query: 'backend engineer', limit: 5 });

    assert.equal(job.source, 'muse');
    assert.equal(job.external_id, '42');
    assert.equal(job.company, 'Northwind');
    assert.equal(job.location, 'New York, NY · Remote');
    assert.equal(job.url, 'https://example.com/42');
    assert.equal(job.posted_at, '2026-03-04 10:00:00');
    assert.ok(!job.description.includes('<'), 'contents arrive as HTML and must be stripped');
    assert.equal(job.salary_min, null, 'The Muse publishes no salary; null must not become 0');
  });
});

test('a query naming a known field is sent to The Muse as a category', async () => {
  await withFetch({ results: [] }, async (calls) => {
    await searchMuse({ query: 'machine learning', limit: 5 });
    // URLSearchParams form-encodes the space, which is what The Muse expects.
    assert.match(calls[0].url, /category=Data\+Science/);

    await searchMuse({ query: 'senior backend engineer', limit: 5 });
    assert.match(calls[1].url, /category=Software\+Engineering/);
  });
});

test('The Muse results are ranked by title relevance, not dropped', async () => {
  // The Muse's own tagging is noisy: all three of these come back tagged
  // "Software Engineering". Ranking must float the real one without discarding
  // the engineer whose title never says "software".
  const payload = {
    results: [
      { id: 1, name: 'Area Superintendent', contents: '<p>Concrete work.</p>', company: { name: 'Bechtel' }, locations: [], refs: {} },
      { id: 2, name: 'Sr Software Engineer', contents: '<p>Build services.</p>', company: { name: 'Acme' }, locations: [], refs: {} },
      { id: 3, name: 'Staff Engineer', contents: '<p>Build systems.</p>', company: { name: 'Globex' }, locations: [], refs: {} },
    ],
  };

  await withFetch(payload, async () => {
    const jobs = await searchMuse({ query: 'software engineer', limit: 10 });

    assert.equal(jobs.length, 3, 'a noisy category must not silently drop postings');
    assert.equal(jobs[0].title, 'Sr Software Engineer', 'the best title match leads');
    assert.ok(
      jobs.some((j) => j.title === 'Staff Engineer'),
      'an engineer whose title omits "software" is still a real result'
    );
  });
});

test('The Muse walks pages so a large limit is actually honoured', async () => {
  // The Muse serves 20 per page whatever you ask for, so a single request can
  // never satisfy a limit of 50.
  await withPagedFetch(4, async (calls) => {
    const jobs = await searchMuse({ query: 'software engineer', limit: 50 });
    assert.equal(jobs.length, 50, `got ${jobs.length}`);
    assert.ok(calls.length >= 3, `expected several pages, made ${calls.length} request(s)`);
  });
});

test('The Muse stops at the last page instead of crawling', async () => {
  await withPagedFetch(2, async (calls) => {
    const jobs = await searchMuse({ query: 'software engineer', limit: 100 });
    // Page 0 is full (20), page 1 is short (7) and ends it.
    assert.equal(jobs.length, 27);
    assert.equal(calls.length, 2, `made ${calls.length} requests`);
  });
});

test('a small limit costs exactly one request', async () => {
  await withPagedFetch(5, async (calls) => {
    await searchMuse({ query: 'software engineer', limit: 10 });
    assert.equal(calls.length, 1, 'a free API should not be walked for a short list');
  });
});

test('role families come from the title, specific before generic', () => {
  const cases = [
    ['Senior Backend Engineer', 'Backend'],
    ['Full Stack Developer', 'Full Stack'],
    ['Machine Learning Engineer', 'Machine Learning'],
    ['Data Analyst', 'Data'],
    ['DevOps Engineer', 'DevOps & Cloud'],
    ['iOS Developer', 'Mobile'],
    ['Security Analyst', 'Security'],
    ['Product Manager', 'Product & PM'],
    // "Software Engineering" must lose to every more specific family, or it
    // swallows the entire list — almost every posting says "engineer".
    ['Software Engineer II', 'Software Engineering'],
  ];
  for (const [title, expected] of cases) {
    assert.equal(classifyRole({ title }).label, expected, title);
  }
});

test('a title with no signal falls back to the description, then to Other', () => {
  // The patterns match role language, not technologies — a description has to
  // name the kind of job, not just list a tool the job happens to use.
  assert.equal(
    classifyRole({ title: 'Team Member', description: 'Join our devops practice managing clusters.' }).label,
    'DevOps & Cloud'
  );
  assert.equal(classifyRole({ title: 'Area Superintendent', description: 'Pour concrete.' }).label, 'Other');
});

test('the generic family never matches on description alone', () => {
  // Otherwise every posting mentioning "engineers" anywhere becomes software.
  assert.equal(
    classifyRole({ title: 'Office Coordinator', description: 'Support our engineers with scheduling.' }).label,
    'Other'
  );
});


test('Amazon response maps onto our posting shape, qualifications included', () => {
  const payload = {
    jobs: [{
      id_icims: '2812345',
      title: 'Software Development Engineer',
      city: 'Seattle',
      state: 'WA',
      job_path: '/en/jobs/2812345/sde',
      description: 'Build large scale services.',
      basic_qualifications: '3+ years with Java or Python',
      preferred_qualifications: 'Experience with AWS and distributed systems',
      posted_date: '2026-10-01T00:00:00Z',
    }],
  };

  return withFetch(payload, async () => {
    const [job] = await searchAmazon({ query: 'software development engineer', limit: 5 });

    assert.equal(job.source, 'amazon');
    assert.equal(job.external_id, '2812345');
    assert.equal(job.company, 'Amazon');
    assert.equal(job.location, 'Seattle, WA');
    assert.equal(job.url, 'https://www.amazon.jobs/en/jobs/2812345/sde');
    assert.equal(job.posted_at, '2026-10-01 00:00:00');
    // The skills live in the qualifications, so the gap analysis needs them.
    assert.match(job.description, /Java or Python/);
    assert.match(job.description, /distributed systems/);
  });
});

test('Greenhouse qualifies ids by board, since numeric ids collide', () => {
  const payload = {
    jobs: [{
      id: 4567,
      title: 'Backend Engineer',
      location: { name: 'Remote' },
      content: '&lt;p&gt;Write Ruby and Go services.&lt;/p&gt;',
      absolute_url: 'https://example.com/jobs/4567',
      updated_at: '2026-10-02T00:00:00Z',
    }],
  };

  const original = config.jobs.greenhouseBoards;
  config.jobs.greenhouseBoards = ['stripe'];
  try {
    return withFetch(payload, async () => {
      const [job] = await searchGreenhouse({ query: '', limit: 5 });
      assert.equal(job.source, 'greenhouse');
      assert.equal(job.external_id, 'stripe:4567', 'two boards can share a numeric id');
      assert.equal(job.company, 'Stripe');
      assert.equal(job.location, 'Remote');
    });
  } finally {
    config.jobs.greenhouseBoards = original;
  }
});

test('Greenhouse with no boards configured says so', async () => {
  const original = config.jobs.greenhouseBoards;
  config.jobs.greenhouseBoards = [];
  try {
    await assert.rejects(
      () => searchGreenhouse({ query: 'x' }),
      (err) => err.status === 503 && /GREENHOUSE_BOARDS/.test(err.message)
    );
  } finally {
    config.jobs.greenhouseBoards = original;
  }
});

test('one broken company board does not take the others down', async () => {
  const original = config.jobs.greenhouseBoards;
  config.jobs.greenhouseBoards = ['broken', 'working'];

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('broken')) {
      return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    }
    const payload = {
      jobs: [{ id: 1, title: 'Engineer', location: { name: 'NYC' }, content: 'Go services.', absolute_url: 'https://e.co/1' }],
    };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };

  try {
    const jobs = await searchGreenhouse({ query: '', limit: 10 });
    assert.equal(jobs.length, 1, 'the working board should still return');
    assert.equal(jobs[0].external_id, 'working:1');
  } finally {
    globalThis.fetch = realFetch;
    config.jobs.greenhouseBoards = original;
  }
});
