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

  // Reading the pool must not cost a board request; only intent does.
  const pooled = await call('/jobs/search?query=&limit=6&refresh=0');
  check('a plain search is served from the stored pool',
    pooled.data?.source === 'pool' && pooled.data?.fromProviders === false,
    `source ${pooled.data?.source}, fromProviders ${pooled.data?.fromProviders}`);

  const forced = await call('/jobs/search?query=&limit=6&refresh=1');
  check('refresh=1 calls the job boards',
    forced.data?.fromProviders === true, `fromProviders ${forced.data?.fromProviders}`);

  const repeat = await call('/jobs/search?query=&limit=6&refresh=1');
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

  // Score interpretation, asked for at the 12 November meeting.
  const guide = analysis.data?.scoreGuide ?? [];
  check('the analysis ships a score guide', guide.length === 4 && guide[0].floor === 80,
    `${guide.length} bands, top floor ${guide[0]?.floor}`);
  check('every band says what to do about it', guide.every((g) => g.guidance?.length > 20));
  check('verdicts carry guidance alongside the band',
    results.every((r) => r.verdict?.band && r.verdict?.guidance));

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
  const plan = reloaded.data?.analysis?.tailoring;
  check('the analysis returns an ordered tailoring plan',
    Boolean(plan?.summary) && Array.isArray(plan?.steps),
    JSON.stringify(plan ?? {}).slice(0, 110));
  check('no tailoring step tells the user to claim something unevidenced',
    (plan?.steps ?? []).every((s) => s.effort !== 'asks' || /if you have|nothing is added/i.test(s.why)));

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

  console.log('\nrelative fit bands');
  // Added after measuring the absolute bands against real listings and finding
  // that every one of them lands in the bottom band. The list is banded
  // against its own best instead.
  check('each result above a single posting carries a relative fit band',
    results.length < 2 || results.every((r) => r.fit?.tone),
    JSON.stringify(results[0]?.fit));
  check('the best result in the set is the closest match',
    results.length < 2 || results[0].fit.band === 'close');
  check('a fit band says what it is relative to',
    results.length < 2 || results.every((r) => r.fit.comparedWith === results.length));
  check('the band tone is one the interface can colour',
    results.length < 2 || results.every((r) => ['green', 'amber', 'grey'].includes(r.fit.tone)));
  check('the comparison counts how many fell in each band',
    Array.isArray(analysis.data?.comparison?.fitBands)
    && analysis.data.comparison.fitBands.reduce((n, b) => n + b.count, 0) === results.length);
  check('the measured reality of the percentage ships with the scores',
    /median/.test(analysis.data?.scoreReality?.measured ?? '')
    && /calibrate/.test(analysis.data?.scoreReality?.reproduce ?? ''));

  const single = await call('/analyses', {
    method: 'POST',
    body: { resumeId, jobPostingIds: [jobIds[0]] },
  });
  check('a single posting gets no fit band',
    single.data?.results?.[0]?.fit === null,
    'calling one posting the closest match of one is a tautology');

  console.log('\nkeyword visibility');
  const keywords = analysis.data?.keywords;
  check('the analysis reports whether a keyword search can find the resume',
    keywords && Array.isArray(keywords.missingSpellings) && Array.isArray(keywords.searchable));
  check('every spelling suggestion is additive, never a replacement',
    (keywords?.missingSpellings ?? []).every((m) => /as well as/.test(m.action)));
  check('a spelling suggestion names how many postings use it',
    (keywords?.missingSpellings ?? []).every((m) => m.postings >= 1
      && m.postings <= keywords.postingsCompared));
  check('nothing to report yields no summary line rather than a reassurance',
    keywords?.missingSpellings?.length > 0
      ? typeof keywords.summary === 'string'
      : keywords?.summary === null);

  console.log('\ndisplay preferences');
  const defaults = await call('/preferences');
  check('preferences are served with the options they were chosen from',
    defaults.data?.schema?.length >= 4 && defaults.data?.preferences);
  check('match strength defaults to colour, not a percentage',
    defaults.data?.preferences?.scoreDisplay === 'band');
  check('nothing is hidden by default',
    defaults.data?.preferences?.hideBelow === 'nothing'
    && defaults.data?.preferences?.locationScope === 'any');
  check('every default is one of the offered options',
    defaults.data.schema.every((pref) =>
      pref.options.some((o) => o.value === defaults.data.preferences[pref.key])));
  check('the advertised schema hides the column names',
    defaults.data.schema.every((pref) => pref.column === undefined));

  const saved2 = await call('/preferences', {
    method: 'PATCH',
    body: { hideBelow: 'far', detailLevel: 'summary' },
  });
  check('a change is stored and echoed back whole',
    saved2.data?.preferences?.hideBelow === 'far'
    && saved2.data?.preferences?.detailLevel === 'summary');

  const rejected = await call('/preferences', {
    method: 'PATCH',
    body: { hideBelow: 'everything-above-50', nonsense: 'x' },
  });
  check('an unoffered value is ignored rather than failing the request',
    rejected.status === 200 && rejected.data.preferences.hideBelow === 'far');
  check('what was ignored is reported, not silently dropped',
    (rejected.data?.ignored ?? []).includes('hideBelow')
    && rejected.data.ignored.includes('nonsense'));

  const persisted = await call('/preferences');
  check('preferences survive the request that set them',
    persisted.data?.preferences?.detailLevel === 'summary');

  const withPrefs = await call('/analyses', {
    method: 'POST',
    body: { resumeId, jobPostingIds: jobIds.slice(0, 2) },
  });
  check('an analysis carries the user preferences, so the first render is their view',
    withPrefs.data?.preferences?.detailLevel === 'summary');

  const scoped = await call('/preferences', { method: 'PATCH', body: { locationScope: 'domestic' } });
  check('the location preference is accepted', scoped.data?.preferences?.locationScope === 'domestic');
  const domestic = await call('/jobs/search?limit=30&refresh=0');
  check('the job search applies the location preference server-side',
    domestic.data?.preferences?.locationScope === 'domestic'
    && typeof domestic.data?.outOfScope === 'number');
  check('a posting hidden by preference is reported separately from the search',
    domestic.data.jobs.every((j) => !/\b(canada|united kingdom|india|germany|france)\b/i.test(j.location ?? '')),
    JSON.stringify(domestic.data.jobs.slice(0, 3).map((j) => j.location)));

  await call('/preferences', { method: 'PATCH', body: { locationScope: 'any', detailLevel: 'full', hideBelow: 'nothing' } });

  console.log('\non-demand availability check');
  const checked = await call(`/jobs/${jobIds[0]}/check`, { method: 'POST' });
  check('a posting can be checked against its own page on demand',
    checked.status === 200 && ['gone', 'unknown'].includes(checked.data?.status),
    JSON.stringify(checked.data));
  check('an inconclusive check is not reported as a dead job',
    checked.data.status !== 'unknown' || checked.data.actionable === false,
    'a 403 from a board says nothing about whether the job exists');
  check('the check records when it happened', Boolean(checked.data?.checkedAt));

  const missing = await call('/jobs/99999999/check', { method: 'POST' });
  check('checking a posting that does not exist is a 404', missing.status === 404);

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
