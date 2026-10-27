# HiveFit

An intelligent resume optimization and job-matching platform.

CSCI 456 Senior Project · Alisha Karim, Rehman Khan, Egid Metalia, Xavier Perez
Advisor: Dr. Wenjia Li

This is the Phase 4 implementation of the system designed in
`HiveFit_SemesterOne_FinalReport`. It implements all five Level 1 DFD
processes, the ERD, and the four differentiators the report argues for.

---

## Quick start

```bash
npm install                       # installs server + mobile workspaces

cp -n .env.example .env           # -n: never overwrite an existing .env
                                  # then set DB_PASSWORD to your MySQL password
npm run db:setup                  # creates the database and applies schema.sql
npm run db:seed                   # demo account + 15 sample job postings

npm run calibrate                 # scoring methodology, measured
npm run audit:sources             # what each job site permits

npm run dev                       # terminal 1 — API on http://localhost:4000
npm run mobile                    # terminal 2 — Expo; press w for web

npm run jobs:refresh              # optional — sweep the live boards and
                                  # age out postings that have come down
```

**These are two separate servers.** `localhost:4000` is the API and serves JSON
only — opening it in a browser gives you an endpoint list, not the app. The
interface is the Expo app, usually `http://localhost:8081` after pressing `w`.
The mobile app reads the API address from `apiBaseUrl` in `mobile/app.json`.

Demo login after seeding: `demo@hivefit.app` / `hivefit-demo`

Nothing requires an API key. Job data defaults to a bundled fixture set and AI
suggestions default to a deterministic local rewriter. Both switch to live
services through `.env` alone — see [Configuration](#configuration). The Muse
needs no credentials at all, so `JOBS_PROVIDER=muse` gives live, changing
listings with nothing to sign up for.

---

## What is implemented

| DFD process | Where | Endpoint |
|---|---|---|
| 1.0 Authentication | `server/src/routes/auth.js` | `POST /api/auth/register`, `/login`, `GET /me` |
| 2.0 Resume Analysis | `server/src/nlp/` | `POST /api/resumes`, `POST /api/analyses` |
| 3.0 AI Recommendations | `server/src/ai/` | `POST /api/suggestions`, `PATCH /api/suggestions/:id` |
| 4.0 Job Search | `server/src/jobs/` | `GET /api/jobs/search` |
| 5.0 Application Tracker | `server/src/routes/saved.js` | `GET/POST/PATCH/DELETE /api/saved-jobs` |

The Level 2 resume-analysis pipeline maps one file per sub-process:

| Sub-process | File |
|---|---|
| 2.1 Document Parsing | `server/src/nlp/parse.js` |
| 2.2 Preprocessing | `server/src/nlp/tokenize.js` + `stemmer.js` + `stopwords.js` |
| 2.3 TF-IDF Vectorization | `server/src/nlp/tfidf.js` |
| 2.4 Cosine Similarity | `server/src/nlp/similarity.js` |
| 2.5 Keyword Gap Analysis | `server/src/nlp/keywordGap.js` + `categories.js` |
| 2.6 Highlight Analysis | `server/src/nlp/highlight.js` + `evidence.js` |
| 2.7 Per-Bullet Targets | `server/src/nlp/bulletTargets.js` |

The six ERD entities are `server/src/db/schema.sql`, with `ats_analyses`
resolving the many-to-many between resumes and job postings — which is what
makes multi-job comparison possible.

---

## The four differentiators, and where they live

**Multi-job comparison.** `POST /api/analyses` takes a list of postings, not
one. Beyond per-posting scores it returns a `comparison` block: your average
across the pool, your best and worst match, and the gaps that recur across
several postings. A term missing from four of five postings is one fix that
lifts every application, and no one-to-one tool can see it.
→ `server/src/nlp/analyze.js`

**Transparent scoring.** Every score breaks into four categories, each with a
coverage percentage, the terms matched and missed, how much weight that
category carries in this posting, and a plain-language sentence explaining the
number. A 40% soft-skills score on a posting that barely mentions soft skills
is not the thing to fix first, and the UI says so.
→ `server/src/nlp/keywordGap.js`
**Select-a-Bullet.** The user picks the bullet and picks which missing terms it
should address. The system returns one revision. The user accepts or discards
it; nothing is applied automatically.

The terms offered are ranked for the selected bullet, not shared across all of
them — picking a bullet has to change the answer or picking a bullet is
theatre. Four signals decide, in order: whether the bullet's own entry already
accounts for the term (a React bullet from the project whose stack lists React
can claim it with no questions asked), how closely the posting discusses the
term alongside what the bullet describes, whether the bullet is technical or
soft-skill flavoured, and how heavily the posting leans on the term. Nameable
skills fill the slots first — "add *essential* to this bullet" is not advice.
→ `server/src/nlp/bulletTargets.js`, `mobile/app/analysis/[id].js`,
`server/src/routes/suggestions.js`

**Honest AI.** Enforced in code, not in a prompt. Before any rewrite,
`classifyTerms` checks whether the bullet actually evidences each requested
term. Unevidenced terms are never passed to the rewriter — instead the user
gets a question asking whether the experience is real. Only after they describe
it does the term become writable. The test `the provider is never handed an
unevidenced term` proves a deliberately credulous backend still cannot
fabricate a qualification.
→ `server/src/ai/suggest.js`

---

## Ranked results, a pool that moves, and skills you already have

Three behaviours that sit on top of the five DFD processes.

**Postings are ranked, best match first.** `POST /api/analyses` returns results
sorted by score descending, each carrying a `rank`. Ties break on overall
coverage and then title, so the same pool ranks identically however the caller
ordered it — the ordering is decided once, in the pipeline, rather than
re-derived by every consumer.

The posting's own URL travels with the ranking — through the result cards, the
comparison's best match, the analysis detail view and the tracker — so the
answer to "which of these should I apply to" is one tap from the score that
produced it. Postings with no URL render no button rather than a dead one.
→ `rankResults` in `server/src/nlp/analyze.js`, `ApplyLink` in
`mobile/src/components/ui.js`

**The job pool changes from day to day, and dead listings leave it.** A job
board will keep telling you a posting exists long after its page has gone, so
"is this job still there?" gets answered two ways, kept in separate columns:

| Column | Means | Established by | Cleared by a re-sighting? |
|---|---|---|---|
| `expired_at` | *inferred* gone | not returned by a sweep for `JOBS_TTL_HOURS` (default a week), or past a stated close date | Yes — the board serving it again disproves the inference |
| `unavailable_at` | *confirmed* gone | fetching the listing and reading the answer off the page | **No** — a board still listing a page that 404s does not make it live again |

That second column is the one that does the work. Without it a provider that
keeps serving a dead listing resurrects it on every sweep, forever, and no
amount of refreshing removes it.

The verifier is deliberately hard to convince, because the two errors are not
equally bad: leaving a stale row costs one bad line in a list, while wrongly
hiding a live job is the product failing at the only thing it is for. So only a
404/410, or a page that says in so many words that the posting is gone, counts
as proof. Everything else — 403, 429, 5xx, timeouts, DNS failures — is recorded
as inconclusive and changes nothing. Adzuna answers 403 to every server-side
request, so its listings can never be verified this way and fall back to the
staleness TTL; a host that refuses repeatedly is dropped for the rest of the run
so the budget reaches hosts where checking resolves something.

Search is a provider call, not a database read, so results are filtered against
both columns on the way out and the response reports how many it dropped. That
filtering is the point: it is what stops a board's dead listing reaching the
user however stubbornly the board keeps serving it.

```bash
npm run jobs:refresh                      # sweep, verify, expire
npm run jobs:refresh -- --verify 200      # check more listings this run
npm run jobs:refresh -- --no-verify       # sweep and expire only
npm run jobs:refresh -- --prune           # also delete long-dead rows
npm run jobs:refresh -- "machine learning" --location "New York" --ttl 72
```

Verification is bounded (`JOBS_VERIFY_LIMIT`, default 40) because it is one
request per listing against someone else's site; the pool is worked through
least-recently-checked first, so runs round-robin rather than re-checking the
same rows. `--prune` is the only step that deletes anything, is off by default,
and never touches a posting a user saved or analysed.

`GET /api/jobs/freshness` reports what moved: available, confirmed gone, added
today, delisted this week. Saved jobs are never hidden — a tracked posting that
comes down is labelled "no longer listed" instead of vanishing mid-application.

→ `server/src/jobs/store.js`, `server/src/jobs/verify.js`,
`server/src/jobs/refresh.js`

**Postings are classified in two levels, and the broad one steers the search.**
A board asked for "software engineer" still returns nurses, occupational
therapists and delivery drivers — Adzuna's relevance is loose and its pool is
everything. With one tech-shaped set of role families, every job outside tech
collapsed into a single "Other", which is no use to someone who wants to rule
out a whole industry rather than pick a specialty. So:

| Level | Examples | Answers |
|---|---|---|
| **Field** | Technology, Healthcare & Medicine, Finance & Accounting, Engineering (non-software), Construction & Trades, Operations & Logistics, … | Is this my industry at all |
| **Role** | Backend, Frontend, Data, DevOps & Cloud, Machine Learning, Security, … | Which specialty, within Technology |

Both come off the title, which a human wrote to be read; descriptions are
consulted only when the title is silent, and never for the broad commercial
fields, because a software role at a hospital mentions patients constantly and
a nursing post mentions the software it is charted in. Two rules earn their
place: **occupation outranks industry**, so "Healthcare Software Engineer" is
Technology rather than Healthcare; and a bare "engineer" never decides a field,
because half a dozen fields use the word and matching it collapses all of them
into whichever rule is listed first.

Filtering alone could not fix this. A blank query comes back 21 healthcare and
2 technology, so sieving 50 results for Technology yields a handful. Picking a
field therefore **changes what the board is asked for** — `?field=technology`
with no query of its own searches for "software engineer developer" — and only
then filters. That turns a useless filter into fifty technology postings across
seven specialties. Role families are `null` outside Technology rather than a
misleading "Other", and an unknown field id is a 400 rather than silently
ignored.

The picker narrows on four: field (which re-queries the board), specialty,
required skills, and free text for whatever the taxonomy misses.

**Browse by area on a map.** The Jobs tab has a List/Map toggle. Pan and zoom
to a region, tap a pin, and apply from it. Pins are grouped by location, since
city-level coordinates mean every job in Seattle shares one point and an
ungrouped map is one pin hiding forty.

Three decisions worth knowing:

- **Leaflet and OpenStreetMap, not Google Maps.** `react-native-maps` has no
  web renderer and the web portal is what gets demoed; the Google Maps
  JavaScript API needs a billing account with a card on file. OSM tiles need
  neither and give real pan and zoom. Leaflet is loaded from a CDN at runtime,
  so `package.json` is untouched and the native build does not carry a library
  it cannot use — on device the map shows a "use the web build" note and the
  list still works.
- **Coordinates are mostly free.** Adzuna returns real latitude and longitude.
  Amazon and Greenhouse return a city string, which an offline bundled
  gazetteer resolves (190 cities, 59 regions, 16 countries) — no geocoding API,
  no key, no rate limit. Anything it cannot resolve stays off the map and in
  the list, because a pin in the wrong city is worse than no pin.
- **Remote roles get no pin, deliberately.** Pinning them to a country centroid
  would invent a cluster in the middle of Kansas that no job is actually in.
  The map says so, and the count tells you how much of the pool is mappable.

Panning reads the stored pool (`GET /api/jobs/map?bbox=…`), not a job board —
a board request per pan would exhaust the rate limit in a minute, and the user
is moving around jobs already found rather than searching again. The viewport's
field and skill filters carry over, and when a viewport holds more listings
than the map will draw the response says so rather than truncating silently.
→ `server/src/jobs/gazetteer.js`, `mobile/src/components/JobMap.js`

**Skill filters are curated, and must discriminate.** `skillOptions` offers the
technologies a pool actually asks for, with how many postings want each — but
two restrictions earn their place. A term present in more than 60% of the pool
is excluded, because narrowing by a skill 76 of 80 postings mention returns 76
postings. And the list is a curated set of technology names rather than a slice
of the scoring taxonomy: that taxonomy stores "machine learning" and "unit
testing" as space-separated words with no phrase boundary recorded, which is
harmless for scoring and useless for a menu — it offers "learn", "units" and
"excellence" as skills to filter by. Location is sent to the provider, which
knows about metro areas, except for remote, which the boards handle badly
enough to enforce locally.
→ `server/src/jobs/filters.js` Selections survive a change of
field and stay listed by title, so a comparison spanning two fields is still
reviewable.

**Select-all respects the comparison cap.** One analysis compares at most
`MAX_POSTINGS_PER_ANALYSIS` postings — each means its own TF-IDF transform, gap
analysis, highlight pass and stored row. A select-all that handed the server
fifty was worse than no button: it produced a 400 after the user had already
committed to the choice. The cap now travels to the client in the search
response, so one number governs the server's check, the button's label
(`Select 14`), the row disabling at the limit, and the counter — including the
pasted description, which is a posting too.
→ `server/src/jobs/fields.js`, `server/src/jobs/roles.js`,
`server/src/config/limits.js`

**Skills you have but have not shown.** The keyword gap answers "what does this
posting want that you lack?". The other half of that question is "what does it
want that you *have*, but have buried?" — a skill sitting on a Skills line that
no accomplishment demonstrates. The ATS keyword-matches it and scores you
fine; the recruiter reading the page next never learns you can do it.

Evidence is tiered by where it lives — demonstrated in a bullet, declared in an
entry's tech stack, claimed on a Skills line, or only in coursework. The first
two count as visible; the rest are reported as `underhighlighted`, each with
where it currently sits, what to do about it, and which bullets are the best
home for it. A bullet from the entry that already declares the term is the
confident case and needs no confirmation from the user.

Nothing here invents anything — that is the point. A term absent from the
resume entirely stays in the keyword gap, where it belongs, and is never
suggested for "highlighting". Both readings of the evidence come from one
module, so the analysis and the rewriter cannot disagree about where a skill is
evidenced.
→ `server/src/nlp/highlight.js`, `server/src/nlp/evidence.js`

**A note on Indeed and LinkedIn.** Neither offers a public job-search API.
Indeed closed its Publisher API to new applicants and LinkedIn's job endpoints
are partner-only, restricted to approved ATS vendors. Adzuna aggregates from
the major boards and carries postings that originate on both. Both it and The
Muse are free.

**Where the listings come from, and what we are not allowed to use.** Every
source is an official documented API; nothing is scraped. Adzuna aggregates the
major boards; Amazon's own careers site is pulled through the public JSON
endpoint its own search page calls; and Greenhouse's public board API reaches a
large number of companies' *own* career pages through one documented client
(configured by `GREENHOUSE_BOARDS`, so adding a company is a `.env` change).

LinkedIn, Indeed, Google, Meta and Microsoft Careers all prohibit automated
collection in their Terms, so none of them is used. Two traps worth naming:
Indeed's `robots.txt` says `Allow: /` while its Terms forbid collection — the
contract outranks the crawl file — and Microsoft serves no `robots.txt` at all,
which is an absence of policy rather than permission.

`npm run audit:sources` checks every site's live `robots.txt` and prints the
verdicts, so the claim is re-runnable rather than a snapshot. Full write-up in
[docs/job-sources.md](docs/job-sources.md).

**A note on The Muse.** Wired, tested, and switched off. As of October 2026
every listing its public API returns 404s on themuse.com itself — confirmed
with a browser user-agent, with no headers at all, and against their company
pages, which 404 too. The API serves records whose public pages are gone, so
every posting it contributed was a job the user could not open, let alone apply
to. The verifier marks them dead on sight, which is correct but means the
provider contributes nothing but work. Re-enable it in `JOBS_PROVIDER` if their
data recovers.

---

## Scoring

The report specifies cosine similarity for stage 2.4, and it is implemented and
reported. It is not the headline number, for a measured reason.

Cosine is symmetric: it asks how similar two documents are, and every resume
term the posting does not mention drags it down — your degree, an unrelated
internship, your address. Measured against reference pairs, a resume that
genuinely covers a posting scored 45%, and a good-but-imperfect match 14%.
Those are not numbers a student can act on.

ATS compatibility is not a symmetric question. It asks how much of what this
posting requires the resume actually contains. The headline **score** is
therefore IDF-weighted coverage of the posting's recognized skills, which on
the same reference pairs gives 100 / 90 / 46 / 26 / 0 across near-identical,
strong, good-with-gaps, adjacent, and unrelated. Each response carries all
three numbers:

- `score` — skills coverage, the headline
- `overallCoverage` — coverage including non-taxonomy vocabulary
- `similarity` — the raw cosine from stage 2.4

Verdict bands (75 / 45 / 25) are calibrated against those reference pairs in
`server/tests/scoring.test.js`, so changing the scoring breaks a test rather
than silently shifting what "strong match" means.

### Is a keyword score good enough? Measure it

The fair objection to term-overlap scoring is that it can hand a near-identical
number to a resume that genuinely fits and one that merely shares vocabulary.
That is a measurable claim, so `npm run calibrate` measures it: one resume
against a labelled ladder of postings, scored by all three metrics, reporting
the **spread** (best minus worst), the **margin** (tightest gap between
adjacent tiers) and whether the metric **ranked the ladder correctly**.

```
pair                         score  retrieval similarity   band
rewritten from resume        90.39      53.91      40.87   strong
same field, gaps             49.51      19.03      13.01   moderate
adjacent role                25.16      17.94      13.07   weak
unrelated field                  0          0          0   poor

metric                              spread   margin   ordering
Requirement coverage (headline)      90.39    24.35   correct
BM25 retrieval                       53.91     1.09   correct
TF-IDF cosine                        40.87    -0.06   WRONG ORDER
```

The result is the argument for the current headline. **Cosine — the textbook
document-similarity metric — is the one that mis-ranks**: a negative margin
means it placed the adjacent role *above* the same-field posting. BM25 orders
the ladder correctly but separates adjacent tiers by about one point, which is
too thin to hang verdict bands on. Requirement coverage separates them by 24.

BM25 (Okapi, k1=1.2, b=0.75) is implemented and reported alongside rather than
instead of the headline, because it answers a real weakness of raw TF-IDF —
term frequency saturates, and document length is normalized, so the eighth
mention of a term stops earning full credit. All three numbers travel with
every analysis and are shown in the UI, so the scoring can be checked rather
than believed.
→ `server/src/nlp/bm25.js`, `server/src/nlp/calibration.js`

### Not applicable is not 100%

A category a posting never mentions reports `null`, and the UI shows **N/A**.
It used to report 100%, which is misleading in the direction that matters: a
resume with no soft skills at all showed "Soft Skills 100%" on a posting that
happened to ask for none. There is nothing there to be perfect at.

IDF is fitted across a 15-posting background corpus, not across the two
documents being compared — with a corpus of two, every shared term has the same
document frequency and the weighting collapses to raw word overlap.

---

## Database setup

`npm run db:setup` and `db:seed` need a MySQL account. The scripts read
`DB_USER` / `DB_PASSWORD` from `.env`, and a blank `DB_PASSWORD` is the usual
cause of `Access denied ... (using password: NO)`.

**If you know your MySQL password**, put it in `.env` and re-run:

```bash
# .env
DB_PASSWORD=your-mysql-password
```

**Prefer a dedicated account over root.** Root has cluster-wide privileges this
app never needs, and the password ends up in a file on disk. From a MySQL shell
you can already log into:

```sql
CREATE USER 'hivefit'@'localhost' IDENTIFIED BY 'pick-a-password';
CREATE DATABASE IF NOT EXISTS hivefit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON hivefit.* TO 'hivefit'@'localhost';
FLUSH PRIVILEGES;
```

Then set `DB_USER=hivefit` and the matching `DB_PASSWORD` in `.env`.

**If you do not know the root password** (Homebrew MySQL on macOS):

```bash
brew services stop mysql
mysqld_safe --skip-grant-tables --skip-networking &   # starts with auth disabled
mysql -u root
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'a-new-password';
```

```bash
# stop the unauthenticated instance, then start normally
mysqladmin -u root -p shutdown
brew services start mysql
```

The `--skip-grant-tables` server accepts any connection, so keep
`--skip-networking` set and shut it down as soon as the password is changed.

Verify before re-running the scripts:

```bash
mysql -u root -p -e "SELECT VERSION();"
```

---

## Testing

```bash
npm test          # 152 unit tests, no database required
npm run smoke     # 60 checks end-to-end against a running server + database
```

The unit tests cover the NLP pipeline (stemming, tokenizing, TF-IDF, cosine,
coverage, gap analysis, bullet extraction), the scoring calibration, posting
ranking, the highlight analysis, per-bullet target ranking, the job providers
and their field and role classification, the listing verifier's refusal to call
a blocked request a dead job, and the honest-AI constraint. They need no database, no API
key, and no network — provider responses are stubbed, and credentials are
blanked inside the tests so a machine with real Adzuna keys and one without
behave identically.

`npm run smoke` needs MySQL configured and the server running. It walks the
full lifecycle: register → upload → analyze → suggest → track, and asserts the
honesty constraint end to end.

---

## Configuration

All in `.env` (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `DB_*` | `root@127.0.0.1/hivefit` | MySQL connection |
| `JWT_SECRET` | dev fallback | Production start-up refuses the fallback |
| `JOBS_PROVIDER` | `fixtures` | Comma-separated: `adzuna,amazon,greenhouse` |
| `GREENHOUSE_BOARDS` | 5 companies | Company board tokens to pull first-party listings from |
| `JOBS_TTL_HOURS` | `168` | Unseen postings are delisted after this |
| `JOBS_VERIFY_LIMIT` | `40` | Listings each refresh fetch-checks for liveness |
| `JOBS_REFRESH_QUERIES` | 5 roles | What `npm run jobs:refresh` sweeps |
| `ADZUNA_APP_ID` / `_KEY` | — | Free tier: 25,000 calls/month |
| `MUSE_API_KEY` | — | Optional, and The Muse is off by default — see the note above |
| `AI_PROVIDER` | `heuristic` | `anthropic` for model-written rewrites |
| `ANTHROPIC_API_KEY` | — | Required only when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |

Switching either provider is a `.env` change, never a code change — both sit
behind an interface (`server/src/jobs/index.js`, `server/src/ai/provider.js`).
Live job providers run concurrently and fail independently: one board being
down thins the results rather than failing the request, and if every live
source is unreachable the search falls back to the fixture set and says so.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React Native (Expo SDK 57, expo-router) — iOS, Android, web |
| Backend | Node.js, Express 5 |
| Database | MySQL 8 (`mysql2`, pooled, parameterized) |
| NLP | Hand-written TF-IDF, cosine similarity, Porter stemmer — no ML dependency |
| Job data | Adzuna (primary), bundled fixtures (default) |
| Auth | JWT + bcrypt |

The NLP engine has no third-party dependency: the Porter stemmer, the
vectorizer, and the similarity math are implemented directly, which is what
makes the pipeline inspectable for the report.

---

## Layout

```
server/
  src/
    config/     environment loading, shared limits, production safety checks
    db/         schema.sql, pool, setup, migrations, seed scripts
    middleware/ auth (JWT + bcrypt), error handling
    nlp/        DFD 2.1-2.5 — one file per sub-process, plus
                evidence/highlight (skills held but not demonstrated),
                bm25 + calibration (scoring, measured against alternatives)
    ai/         honest suggestion logic + rewrite providers
    jobs/       Adzuna / Amazon / Greenhouse / Muse clients, fixture corpus,
                unified adapter, field+role taxonomy, skill & location filters,
                offline gazetteer, listing lifecycle, liveness verifier,
                refresh sweep, source policy audit
    routes/     one router per DFD Level 1 process
  tests/        unit tests + end-to-end smoke script
mobile/
  app/          expo-router screens (auth, tabs, analysis detail)
  src/          API client, theme, shared components, charts, Leaflet map,
                auth state
```
