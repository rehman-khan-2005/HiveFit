// npm run audit:sources — what each job site actually permits.
//
// Li asked whether the sites we pull from allow automated collection, and
// whether the big names' own hiring sites can be used. That is a question with
// a checkable answer rather than an opinion: robots.txt states the site's
// machine-readable policy, and several of these companies publish a structured
// public API that removes the question entirely.
//
// The rule this project follows, and the reason the output is a verdict rather
// than a score: a documented public API is always preferred to parsing HTML,
// and an explicit prohibition is final regardless of whether a crawl would
// technically work.

const SOURCES = [
  {
    name: 'Adzuna',
    robots: 'https://www.adzuna.com/robots.txt',
    path: '/search',
    api: 'https://api.adzuna.com — documented, keyed, free tier',
    note: 'Aggregator. Official API, so robots.txt is moot for our use.',
  },
  {
    name: 'The Muse',
    robots: 'https://www.themuse.com/robots.txt',
    path: '/jobs',
    api: 'https://www.themuse.com/api/public/jobs — documented, public',
    note: 'Official API, but its listings 404 on themuse.com. Disabled for data quality, not policy.',
  },
  {
    name: 'Amazon Jobs',
    robots: 'https://www.amazon.jobs/robots.txt',
    path: '/en/search.json',
    api: 'https://www.amazon.jobs/en/search.json — the search page calls this itself',
    note: "First-party board. robots.txt disallows only /internal paths.",
  },
  {
    name: 'Greenhouse boards',
    robots: 'https://boards-api.greenhouse.io/robots.txt',
    path: '/v1/boards',
    api: 'https://boards-api.greenhouse.io/v1/boards/{token}/jobs — documented, public, unauthenticated',
    note: 'The ATS behind many companies\' own career pages. Read API published for this purpose.',
  },
  {
    name: 'Lever boards',
    robots: 'https://api.lever.co/robots.txt',
    path: '/v0/postings',
    api: 'https://api.lever.co/v0/postings/{company}?mode=json — documented, public',
    note: 'Same shape as Greenhouse. Not wired; available if more coverage is wanted.',
  },
  {
    name: 'LinkedIn',
    robots: 'https://www.linkedin.com/robots.txt',
    path: '/jobs/search',
    api: 'Partner-only. Talent Solutions requires an approved partnership.',
    tosProhibits: 'User Agreement forbids scraping and automated access',
    note: 'No public job search API. Crawling is contested in court and contrary to the UA.',
  },
  {
    name: 'Indeed',
    robots: 'https://www.indeed.com/robots.txt',
    path: '/jobs',
    api: 'Publisher API closed to new applicants.',
    // robots.txt says Allow: / — the Terms say otherwise, and the Terms win.
    tosProhibits: 'Terms of Service forbid scraping and automated data collection',
    note: 'robots.txt permits the path, but the Terms of Service do not. No route for a new project.',
  },
  {
    name: 'Google Careers',
    robots: 'https://careers.google.com/robots.txt',
    path: '/jobs/results',
    api: 'None published.',
    tosProhibits: 'Terms of Service forbid automated access without permission',
    note: 'Listings are served by an internal endpoint with no public contract.',
  },
  {
    name: 'Meta Careers',
    robots: 'https://www.metacareers.com/robots.txt',
    path: '/jobs',
    api: 'None published.',
    tosProhibits: 'robots.txt and Terms both forbid automated collection',
    note: 'robots.txt carries an explicit written prohibition on automated collection.',
  },
  {
    name: 'Microsoft Careers',
    robots: 'https://careers.microsoft.com/robots.txt',
    path: '/v2/global/en/search',
    api: 'gcsservices.careers.microsoft.com — undocumented internal endpoint.',
    tosProhibits: 'Terms of Use forbid automated data collection',
    note: 'No robots.txt served; no published contract.',
  },
];

/**
 * Minimal robots.txt reading for the `*` group.
 *
 * Longest matching rule wins, which is the behaviour the spec and every real
 * crawler implement; a shorter Disallow does not override a longer Allow.
 */
function evaluate(body, path) {
  const lines = String(body ?? '').split(/\r?\n/);
  const rules = [];
  let inStar = false;
  let sawAnyGroup = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      sawAnyGroup = true;
      inStar = value === '*';
      continue;
    }
    if (!inStar) continue;
    if (key === 'allow' || key === 'disallow') rules.push({ key, value });
  }

  if (!sawAnyGroup) return { allowed: true, reason: 'no rules for any agent' };

  let best = null;
  for (const rule of rules) {
    if (rule.value === '') continue;
    if (!path.startsWith(rule.value)) continue;
    if (!best || rule.value.length > best.value.length) best = rule;
  }

  if (!best) return { allowed: true, reason: 'no rule matches this path' };
  return {
    allowed: best.key === 'allow',
    reason: `${best.key}: ${best.value}`,
  };
}

const PROHIBITION = /(prohibit|not permitted|without.{0,20}written permission|scraping)/i;

async function audit(source) {
  let body = '';
  let status = null;
  try {
    const res = await fetch(source.robots, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'HiveFit/0.1 (academic project; source policy audit)' },
    });
    status = res.status;
    const text = await res.text();
    // A site that 302s its robots.txt to an HTML error page has none.
    body = /^\s*</.test(text) ? '' : text;
  } catch (err) {
    return { ...source, verdict: 'UNREACHABLE', detail: err.message.slice(0, 60) };
  }

  const explicit = PROHIBITION.test(body);
  const { allowed, reason } = evaluate(body, source.path);

  const hasApi = !/^(None|Partner-only|Publisher API closed)/i.test(source.api)
    && !/undocumented/i.test(source.api);

  // Order matters, and the contract outranks the crawl file. Indeed's
  // robots.txt says Allow: / while its Terms of Service forbid automated
  // collection outright — reporting that as "permitted" because one of the two
  // documents is machine-readable would be telling the team the wrong thing.
  let verdict;
  let detail;
  if (source.tosProhibits) {
    verdict = 'PROHIBITED (terms)';
    detail = source.tosProhibits;
  } else if (explicit) {
    verdict = 'PROHIBITED (robots)';
    detail = 'explicit prohibition in robots.txt';
  } else if (hasApi) {
    verdict = 'USE OFFICIAL API';
    detail = reason;
  } else if (!body) {
    // A site that serves no robots.txt, or redirects it to an HTML error page,
    // has published no policy. Absence of a rule is not permission.
    verdict = 'NO POLICY PUBLISHED';
    detail = `no robots.txt (HTTP ${status})`;
  } else {
    verdict = allowed ? 'CRAWL PERMITTED' : 'CRAWL DISALLOWED';
    detail = reason;
  }

  return { ...source, verdict, detail };
}

const results = [];
for (const source of SOURCES) results.push(await audit(source));

console.log('\nJob source policy audit');
console.log('Checked against each site\'s live robots.txt. Official APIs preferred over parsing HTML.\n');

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.name.padEnd(width)}  ${r.verdict.padEnd(21)} ${r.detail}`);
}

console.log('\nWired into HiveFit:');
for (const r of results.filter((x) => ['Adzuna', 'Amazon Jobs', 'Greenhouse boards', 'The Muse'].includes(x.name))) {
  console.log(`  ${r.name.padEnd(width)}  ${r.api}`);
}
console.log('\nNot used, and why:');
for (const r of results.filter((x) => ['LinkedIn', 'Indeed', 'Google Careers', 'Meta Careers', 'Microsoft Careers'].includes(x.name))) {
  console.log(`  ${r.name.padEnd(width)}  ${r.note}`);
}
console.log('');
