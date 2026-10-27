#!/usr/bin/env node
// End-to-end smoke test against a RUNNING server with a live database.
//
// Unlike the unit tests (npm test), this exercises the database, so it needs
// MySQL configured in .env and `npm run db:setup` already applied.
//
//   Terminal 1:  npm run dev --workspace=server
//   Terminal 2:  node server/tests/smoke.mjs

const BASE = process.env.HIVEFIT_API ?? 'http://localhost:4000/api';

let passed = 0;
let failed = 0;
let token = null;

function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

const RESUME = `Software Engineering Intern, Northwind Systems
• Built REST API endpoints in Node.js and Express serving 10,000 requests per day
• Migrated legacy reporting queries to indexed MySQL tables, cutting p95 latency by 40%
• Shipped a React dashboard used daily by the support team
• Responsible for working on unit tests and the deployment pipeline
SKILLS
JavaScript, Python, SQL, React, Node.js, Git, Linux`;

async function main() {
  console.log(`HiveFit smoke test against ${BASE}\n`);

  console.log('health');
  const health = await call('/health', { auth: false });
  check('server is up', health.status === 200, JSON.stringify(health.data));
  if (health.data?.database !== 'up') {
    console.log('\nDatabase is not reachable. Configure .env and run: npm run db:setup');
    process.exit(1);
  }

  console.log('\n1.0 authentication');
  const email = `smoke-${Date.now()}@hivefit.test`;
  const reg = await call('/auth/register', {
    method: 'POST', auth: false,
    body: { email, password: 'smoke-test-pw', fullName: 'Smoke Test' },
  });
  check('register returns 201', reg.status === 201, JSON.stringify(reg.data));
  token = reg.data?.token;
  check('register returns a token', Boolean(token));

  const dupe = await call('/auth/register', {
    method: 'POST', auth: false, body: { email, password: 'smoke-test-pw' },
  });
  check('duplicate email rejected with 409', dupe.status === 409);

  const badLogin = await call('/auth/login', {
    method: 'POST', auth: false, body: { email, password: 'wrong' },
  });
  check('wrong password rejected with 401', badLogin.status === 401);

  const me = await call('/auth/me');
  check('/auth/me returns the account', me.data?.user?.email === email);

  console.log('\n2.0 resume + analysis');
  const resume = await call('/resumes', { method: 'POST', body: { title: 'Smoke resume', text: RESUME } });
  check('resume created', resume.status === 201, JSON.stringify(resume.data));
  const resumeId = resume.data?.resume?.id;
  check('bullets extracted', (resume.data?.resume?.bullets?.length ?? 0) >= 4,
    `got ${resume.data?.resume?.bullets?.length}`);

  const search = await call('/jobs/search?query=&limit=6');
  check('job search returns postings', (search.data?.jobs?.length ?? 0) > 0);
  const jobIds = (search.data?.jobs ?? []).slice(0, 4).map((j) => j.id);

  // 4.0 listing lifecycle — what makes the pool differ between two days.
  check('search reports which providers answered', Array.isArray(search.data?.providers));
  check('search reports pool freshness', Number.isInteger(search.data?.freshness?.active));
  check('search distinguishes new postings from re-seen ones',
    Number.isInteger(search.data?.added) && Number.isInteger(search.data?.refreshed));

  check('search reports how many known-dead listings it filtered out',
    Number.isInteger(search.data?.hidden),
    `hidden was ${search.data?.hidden}`);
  check('freshness separates confirmed-gone from inferred-stale',
    Number.isInteger(search.data?.freshness?.confirmedGone)
    && Number.isInteger(search.data?.freshness?.everChecked));

  // Map view: postings inside a viewport, read from the stored pool.
  const mappable = (search.data?.jobs ?? []).filter((j) => j.latitude != null);
  check('some postings carry coordinates for the map',
    mappable.length > 0, `${mappable.length} of ${search.data?.jobs?.length} had coordinates`);
  check('remote postings are not given a fake location',
    (search.data?.jobs ?? []).every((j) => !/\bremote\b/i.test(j.location ?? '') || j.latitude == null));

  const world = await call('/jobs/map?bbox=-180,-85,180,85');
  check('map endpoint returns postings in bounds', world.status === 200 && world.data.count > 0,
    `status ${world.status}, count ${world.data?.count}`);
  check('map payload omits descriptions', (world.data?.jobs ?? []).every((j) => !('description' in j)));
  check('map reports how much of the pool is mappable',
    Number.isInteger(world.data?.coverage?.mappable));

  const tiny = await call('/jobs/map?bbox=-0.01,-0.01,0.01,0.01');
  check('an empty ocean viewport returns nothing rather than everything',
    tiny.status === 200 && tiny.data.count === 0, `count ${tiny.data?.count}`);

  const badBox = await call('/jobs/map?bbox=1,2,3');
  check('a malformed bbox is rejected', badBox.status === 400);

  const inverted = await call('/jobs/map?bbox=50,60,-50,-60');
  check('an inverted bbox is rejected rather than returning nothing', inverted.status === 400);

  const freshness = await call('/jobs/freshness');
  check('freshness endpoint responds', freshness.status === 200);
  check('freshness reports a TTL', Number(freshness.data?.freshness?.ttlHours) > 0);

  // A match the user cannot act on is a dead end, so the link has to survive
  // every hop from provider to result card.
  const linkable = (search.data?.jobs ?? []).filter((j) => j.url);
  check('postings carry a link to apply', linkable.length === (search.data?.jobs?.length ?? 0),
    `${linkable.length} of ${search.data?.jobs?.length} have a url`);
  check('postings carry a broad field', (search.data?.jobs ?? []).every((j) => j.field?.label));
  check('role families are present inside Technology and null outside it',
    (search.data?.jobs ?? []).every((j) => (j.field.id === 'technology' ? Boolean(j.role) : j.role === null)));
  check('search offers the full field taxonomy to filter by',
    (search.data?.fields ?? []).length > 5 && Array.isArray(search.data?.fieldCounts));
  check('search tells the client the comparison cap',
    Number.isInteger(search.data?.maxComparable) && search.data.maxComparable > 0);

  const cap = search.data?.maxComparable ?? 20;

  // Filtering by field has to narrow and has to steer: asking for one field
  // must come back entirely in that field.
  const tech = await call('/jobs/search?query=&limit=20&field=technology');
  check('filtering by field returns only that field',
    (tech.data?.jobs ?? []).length > 0 && tech.data.jobs.every((j) => j.field.id === 'technology'),
    `${tech.data?.jobs?.length} jobs, fields: ${[...new Set((tech.data?.jobs ?? []).map((j) => j.field.id))].join(', ')}`);
  check('a field with no query of its own steers what the board is asked for',
    Boolean(tech.data?.query), `query was ${JSON.stringify(tech.data?.query)}`);

  const badField = await call('/jobs/search?field=nonsense');
  check('an unknown field is rejected rather than silently ignored', badField.status === 400);

  const repeat = await call('/jobs/search?query=&limit=6');
  check('a repeated search re-sees rather than duplicates postings',
    repeat.data?.added === 0 && repeat.data?.refreshed > 0,
    `added ${repeat.data?.added}, refreshed ${repeat.data?.refreshed}`);

  // The picker caps selection client-side; the server has to mean it.
  const overCap = await call('/analyses', {
    method: 'POST',
    body: { resumeId, jobPostingIds: jobIds, postings: Array.from({ length: cap + 1 }, () => ({ description: 'x '.repeat(40) })) },
  });
  check('comparing more than the cap is refused', overCap.status === 400,
    `got ${overCap.status}: ${JSON.stringify(overCap.data).slice(0, 90)}`);

  const analysis = await call('/analyses', {
    method: 'POST', body: { resumeId, jobPostingIds: jobIds },
  });
  check('analysis created', analysis.status === 201, JSON.stringify(analysis.data).slice(0, 200));
  const results = analysis.data?.results ?? [];
  check('one result per posting', results.length === jobIds.length);
  check('scores are within 0-100', results.every((r) => r.score >= 0 && r.score <= 100));
  check('four categories per result', results.every((r) => r.categories?.length === 4));
  check('category weights sum to ~100', results.every((r) => {
    const total = r.categories.reduce((s, c) => s + c.weightInPosting, 0);
    return Math.abs(total - 100) < 1;
  }));
  check('comparison summary present', Boolean(analysis.data?.comparison?.interpretation));

  // Ranking — postings come back best match first.
  const scores = results.map((r) => r.score);
  check('results are ranked high to low',
    scores.every((s, i) => i === 0 || scores[i - 1] >= s), scores.join(', '));
  check('every result carries its rank',
    results.every((r, i) => r.rank === i + 1), results.map((r) => r.rank).join(', '));
  check('comparison agrees with the ranking',
    analysis.data?.comparison?.bestScore === scores[0]
    && analysis.data?.comparison?.worstScore === scores[scores.length - 1]);

  // Skills held but not demonstrated.
  check('results report skills held but not highlighted',
    results.every((r) => Array.isArray(r.underhighlighted)));
  check('nothing is flagged as buried unless the resume covers it',
    results.every((r) => r.underhighlighted.every((u) => u.term && u.placement && u.action)));
  check('the pool-wide buried list is present',
    Array.isArray(analysis.data?.comparison?.recurringUnderhighlighted));

  const analysisId = results[0]?.analysisId;

  check('each result carries its posting link', results.every((r) => r.url));
  check('the best match carries a link to apply',
    Boolean(analysis.data?.comparison?.bestMatch?.url));

  // It has to survive the round trip, since the detail screen reads it back.
  const reloaded = await call(`/analyses/${analysisId}`);
  check('the analysis detail carries the posting link',
    Boolean(reloaded.data?.analysis?.job?.url),
    JSON.stringify(reloaded.data?.analysis?.job ?? {}));
  check('buried skills persist with the analysis',
    Array.isArray(reloaded.data?.analysis?.underhighlighted),
    JSON.stringify(reloaded.data?.analysis ?? {}).slice(0, 120));

  console.log('\n3.0 honest AI suggestions');
  const bullet = 'Responsible for working on unit tests and the deployment pipeline';

  const impossible = await call('/suggestions', {
    method: 'POST', body: { analysisId, bullet, targetTerms: ['Kubernetes'] },
  });
  check('unevidenced term asks instead of inventing',
    impossible.data?.suggestion?.status === 'needs_input',
    JSON.stringify(impossible.data).slice(0, 200));
  check('no bullet was fabricated', impossible.data?.suggestion?.suggested === null);

  const confirmed = await call('/suggestions', {
    method: 'POST',
    body: {
      analysisId, bullet, targetTerms: ['Kubernetes'],
      userEvidence: 'I ran our staging cluster on Kubernetes for a year',
    },
  });
  check('confirmed experience unlocks a rewrite',
    confirmed.data?.suggestion?.status === 'suggested');

  const decided = await call(`/suggestions/${confirmed.data?.suggestion?.id}`, {
    method: 'PATCH', body: { accepted: true },
  });
  check('user decision recorded', decided.data?.suggestion?.accepted === true);

  console.log('\n5.0 application tracker');
  const saved = await call('/saved-jobs', { method: 'POST', body: { jobPostingId: jobIds[0] } });
  check('job saved', saved.status === 201);
  const savedId = saved.data?.savedJob?.id;

  const advanced = await call(`/saved-jobs/${savedId}`, { method: 'PATCH', body: { status: 'Interview' } });
  check('status advances to Interview', advanced.data?.savedJob?.status === 'Interview');

  const badStatus = await call(`/saved-jobs/${savedId}`, { method: 'PATCH', body: { status: 'Nonsense' } });
  check('invalid status rejected', badStatus.status === 400);

  const list = await call('/saved-jobs');
  check('tracker counts by status', list.data?.counts?.Interview === 1);

  const removed = await call(`/saved-jobs/${savedId}`, { method: 'DELETE' });
  check('saved job removed', removed.status === 204);

  console.log('\nauthorization');
  const noAuth = await fetch(`${BASE}/resumes`);
  check('protected route rejects anonymous access', noAuth.status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test could not run:', err.message);
  console.error('Is the server running?  npm run dev --workspace=server');
  process.exit(1);
});
