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

  const analysisId = results[0]?.analysisId;

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
