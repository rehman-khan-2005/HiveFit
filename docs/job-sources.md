# Job data sources: what we use, and what we are not allowed to use

Answers the question raised in the 2026-10 advisor meeting: do these sites
permit automated collection, and can we pull from the big names' own hiring
sites?

Re-runnable rather than a snapshot — `npm run audit:sources` checks every
site's live `robots.txt` and prints the table below.

## The short answer

**No major job board permits scraping, and we do not scrape any site.** Every
source wired into HiveFit is an official, documented, public API — either the
site's own or its applicant-tracking system's. Two of them are companies' own
first-party boards, which is the "check out their own hiring sites" ask.

## What is wired in

| Source | Kind | Endpoint | Why it is permitted |
|---|---|---|---|
| Adzuna | Aggregator | `api.adzuna.com` | Documented API, free tier, API key issued to us |
| Amazon Jobs | Company's own board | `amazon.jobs/en/search.json` | The public search page calls this endpoint itself; returns JSON, not HTML. `robots.txt` disallows only `/internal` paths |
| Greenhouse boards | Many companies' own boards | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | Documented, public, unauthenticated read API published for this purpose |
| The Muse | Aggregator | `themuse.com/api/public/jobs` | Documented public API — **disabled for data quality, not policy** (see below) |

Greenhouse is the important one for coverage: it is the applicant-tracking
system behind a large share of tech companies' own career pages, so a single
documented client reaches many first-party boards without touching any of them
directly. Companies are configured, not hard-coded — `GREENHOUSE_BOARDS` in
`.env`. Lever publishes an equivalent API and is a drop-in second if more
coverage is wanted.

## What we are not allowed to use

| Site | Verdict | Basis |
|---|---|---|
| LinkedIn | Prohibited | User Agreement forbids scraping and automated access. No public job-search API; Talent Solutions is partner-only |
| Indeed | Prohibited | Terms of Service forbid scraping. Its `robots.txt` says `Allow: /`, but **the contract overrides the crawl file** |
| Google Careers | Prohibited | Terms forbid automated access without permission. Listings come from an internal endpoint with no public contract |
| Meta Careers | Prohibited | `robots.txt` carries an explicit written prohibition on automated collection, and the Terms agree |
| Microsoft Careers | Prohibited | Terms of Use forbid automated collection. Serves no `robots.txt` at all — and absence of a rule is not permission |

Two points worth keeping straight, because they are easy to get wrong:

- **`robots.txt` is not the whole policy.** Indeed is the clean example: its
  crawl file permits `/jobs` while its Terms of Service forbid collection. The
  audit script therefore ranks Terms above `robots.txt`, and reports Indeed as
  prohibited.
- **No `robots.txt` is not consent.** Microsoft's careers site serves none.
  That is an absence of a published policy, not permission, and the audit says
  so rather than defaulting to "allowed".

## The Muse: disabled, and why it matters

The Muse is permitted — it publishes a documented public API. It is switched
off because its data is unusable: as of October 2026 every listing the API
returns 404s on themuse.com itself. Verified with a browser user-agent, with no
headers at all, and against their company pages, which 404 too. Every posting
it contributed was a job the user could not open.

This is the reason the listing verifier exists (`server/src/jobs/verify.js`): a
board's claim that a job exists is not evidence that it does.

## Why first-party boards are better than an aggregator anyway

Beyond permission: when a company's own board stops listing a role, the role is
closed. When an aggregator stops listing it, the syndication feed may simply
have rotated. First-party sources give the delisting logic a far more reliable
signal.
