# The match percentage ranks postings. It does not grade them.

**Measured:** 23 November 2026
**Reproduce:** `npm run calibrate -- --live 80`

## How this came up

The 12 November meeting set verdict bands at 80 / 60 / 40. The 23 November
meeting asked for a cutoff: *"anything below 50% we won't see."*

Both presuppose scores that reach those numbers. Against 80 real listings from
the stored pool, scoring the same reference resume throughout:

```
min 0.0   median 10.9   p90 19.1   max 34.4
```

Every real listing is in the bottom band. A 50% cutoff would have hidden the
entire list — and would have looked, to a user, like the search had failed.

So the threshold was not moved. Three candidate fixes were measured first.

## Fix 1 — score only the terms the posting leans on

The fix proposed at the 12 November meeting. The gap analysis already sorts
terms into *critical*, *important* and *minor* tiers by weight relative to the
posting's heaviest term, so the denominator can shrink to the emphasised terms
with no new machinery. Implemented as `core` in `server/src/nlp/analyze.js` and
reported by `npm run calibrate` alongside the headline.

On the reference ladder it is **identical** to the headline — those postings are
short enough that every recognized skill in them is already a leaned-on one —
so it costs nothing in spread, margin or ordering. On real listings:

| metric | median | p90 | max |
|---|---|---|---|
| Requirement coverage (headline) | 10.9 | 19.1 | 34.4 |
| Leaned-on coverage | 9.5 | 25.6 | 44.5 |

The median moves by about a point. Not a fix.

## Fix 2 — tighten the threshold further

Sweeping the relative-weight floor turns the score into noise rather than
lifting it. The denominator collapses and the result becomes an all-or-nothing
flip:

| relative-weight floor | median terms in denominator | median score | max score |
|---|---|---|---|
| 0.00 | 32 | 10.9 | 34.4 |
| 0.45 | 9 | 9.4 | 54.2 |
| 0.60 | 4 | 0.0 | 100.0 |
| 0.75 | 2 | 0.0 | 100.0 |

A score that reads 0 or 100 off two terms is worse than one that reads 11.

## Fix 3 — count requirements met instead of weighting them

"Meets 6 of 9 key requirements" is more interpretable than a percentage, so it
was worth measuring. On real postings it runs 1–7% — worse than the headline —
**and** it mis-orders the reference ladder: 29.4% for the same-field posting
against 31.3% for the adjacent role. A metric that is confidently wrong is
worse than useless.

## Why none of them work

A real job posting names **150 to 400 terms**: the team's whole stack, the
nice-to-haves, the tools the next team over uses, and a great deal of role and
soft-skill vocabulary. No single resume covers most of them, and no candidate
is expected to.

The ceiling is a property of job postings, not of the resume and not of the
formula. There is no threshold to move and no denominator to pick.

## What the number *can* do

Rank. On the labelled reference ladder it separates tiers by 24 points in the
correct order:

```
metric                              spread   margin   ordering
Requirement coverage (headline)      90.39    24.35   correct
Leaned-on coverage                   90.39    24.35   correct
BM25 retrieval                       53.91     1.09   correct
TF-IDF cosine                        40.87    -0.06   WRONG ORDER
```

Cosine — the textbook document-similarity metric — is the one that mis-ranks.
BM25 orders correctly but separates adjacent tiers by about a point, too thin
to hang bands on.

Ranking is also the question the user is actually asking: *of the twelve jobs I
picked, which deserve my afternoon?*

## What was built instead

Postings are banded **relative to the set being compared**, which is what the
23 November meeting suggested independently ("maybe not even show percentage,
only show green jobs or orange jobs"):

- 80% or more of the set's best score → green, "Closest match"
- 50% or more → amber, "Worth tailoring"
- below that → grey, "Weakest here"

The wording is relative on purpose. "2nd of 12" and "closest of the 12 you
compared" are true whatever the absolute numbers are, where "18 / 100" invites
a reading the measure cannot support.

Two guards:

- **A single posting gets no band.** Calling it the closest match of one is a
  tautology dressed as a finding.
- **A set that scores all zeros gets no winner.** It says that none of these
  postings share meaningful vocabulary with the resume.

The absolute figure is still computed, still returned by the API, and still
shown on the breakdown page for the report — next to `scoreReality`, which
ships the measurement and the reproducing command with every analysis so the
caveat cannot drift away from the number it qualifies.

**Code:** `server/src/nlp/fit.js` · **Tests:** `server/tests/fit.test.js`

## For the report

This is the most defensible result in the project, and it is a negative one.
The honest framing is:

> A single match percentage is the industry convention — Jobscan and Rezi both
> lead with one. We implemented it, calibrated it against a labelled ladder,
> and then measured it against real job postings, where it has a hard ceiling
> around 34%. Rather than rescale the bands to hide that, we changed what the
> interface claims: the number orders a set of postings, and the interface says
> only what the number can support.

The alternative — moving the thresholds down until the colours looked right —
would have produced a better-looking demo and a false claim.
