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

npm run dev                       # terminal 1 — API on http://localhost:4000
npm run mobile                    # terminal 2 — Expo; press w for web
```

**These are two separate servers.** `localhost:4000` is the API and serves JSON
only — opening it in a browser gives you an endpoint list, not the app. The
interface is the Expo app, usually `http://localhost:8081` after pressing `w`.
The mobile app reads the API address from `apiBaseUrl` in `mobile/app.json`.

Demo login after seeding: `demo@hivefit.app` / `hivefit-demo`

Nothing requires an API key. Job data defaults to a bundled fixture set and AI
suggestions default to a deterministic local rewriter. Both switch to live
services through `.env` alone — see [Configuration](#configuration).

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
→ `mobile/app/analysis/[id].js`, `server/src/routes/suggestions.js`

**Honest AI.** Enforced in code, not in a prompt. Before any rewrite,
`classifyTerms` checks whether the bullet actually evidences each requested
term. Unevidenced terms are never passed to the rewriter — instead the user
gets a question asking whether the experience is real. Only after they describe
it does the term become writable. The test `the provider is never handed an
unevidenced term` proves a deliberately credulous backend still cannot
fabricate a qualification.
→ `server/src/ai/suggest.js`

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
npm test          # 40 unit tests, no database required
npm run smoke     # end-to-end against a running server + database
```

The unit tests cover the NLP pipeline (stemming, tokenizing, TF-IDF, cosine,
coverage, gap analysis, bullet extraction), the scoring calibration, and the
honest-AI constraint. They need no database, no API key, and no network.

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
| `JOBS_PROVIDER` | `fixtures` | `adzuna` for live listings |
| `ADZUNA_APP_ID` / `_KEY` | — | Free tier: 25,000 calls/month |
| `AI_PROVIDER` | `heuristic` | `anthropic` for model-written rewrites |
| `ANTHROPIC_API_KEY` | — | Required only when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |

Switching either provider is a `.env` change, never a code change — both sit
behind an interface (`server/src/jobs/index.js`, `server/src/ai/provider.js`).

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
    config/     environment loading and production safety checks
    db/         schema.sql, pool, setup and seed scripts
    middleware/ auth (JWT + bcrypt), error handling
    nlp/        DFD 2.1-2.5 — one file per sub-process
    ai/         honest suggestion logic + rewrite providers
    jobs/       Adzuna client, fixture corpus, unified adapter
    routes/     one router per DFD Level 1 process
  tests/        unit tests + end-to-end smoke script
mobile/
  app/          expo-router screens (auth, tabs, analysis detail)
  src/          API client, theme, shared components, auth state
```
