# Two data bugs that mattered more than the scoring formula

**Found:** 23 November 2026, while investigating
[the scoring ceiling](scoring-ceiling.md)

## 1. Descriptions were storing their own markup

`stripHtml` decoded HTML entities **after** stripping tags:

```js
.replace(/<[^>]*>/g, ' ')   // strip tags   ← ran first
.replace(/&lt;/gi, '<')     // decode       ← ran second
```

Greenhouse and The Muse serve descriptions escaped **twice**. The markup
arrives looking like this:

```
&lt;div class=&quot;content-intro&quot;&gt;Build &amp; ship&lt;/div&gt;
```

So the tag stripper found no tags, then decoding turned the entities *into*
tags — after the only step that would have removed them. `&quot;` was never
handled at all. The markup was persisted as if it were prose.

**Scale:** 268 of 2,695 stored postings, carrying about 1,300 characters of
markup each — 351,486 characters in total.

**Why it was not cosmetic:** every `div`, `class`, `quot`, `span`, `style`,
`data`, `renderer` and `pos` entered the TF-IDF vocabulary. IDF is fitted
across the *whole corpus*, so markup in those 268 rows shifted the term weights
used to score every other posting, including the clean ones.

**Fix:** decode and strip repeatedly until the text stops changing (capped at
three passes), handle named, decimal and hex entities, and drop `<script>` and
`<style>` *contents* rather than inlining them as prose.
`recleanDescriptions()` repairs what is already stored and runs on every
sweep — a no-op once the pool is clean.

**Code:** `server/src/jobs/shared.js` · **Tests:** `server/tests/descriptions.test.js`

## 2. Three quarters of the pool has no description to score

Adzuna's search API returns a description truncated to exactly 500 characters,
and Adzuna is 1,999 of the 2,695 stored postings. Scored by source:

| source | n | median length | median score | max score |
|---|---|---|---|---|
| adzuna | 1999 | 500 | 0.0 | 100.0 |
| amazon | 319 | 5920 | 9.4 | 31.4 |
| greenhouse | 267 | 5718 | 10.4 | 33.8 |
| muse | 9 | 5476 | 7.2 | 25.3 |
| fixtures | 15 | 332 | 19.4 | 49.4 |

On a 500-character snippet the denominator is a handful of terms, so the score
flips between 0 and 100 rather than measuring anything. **This is the single
largest reason the headline figure looks the way it does** — three quarters of
the pool is not being scored, it is being guessed at.

The shortest stored description is 151 characters and contains no requirements
at all. One Adzuna posting is the phrase "Software Engineer" repeated thirteen
times.

The full text exists only on the posting's own page, which the
[source policy audit](../job-sources.md) records Adzuna's terms as forbidding
us to collect. This is a limitation of the data, not something the scoring can
fix.

## Consequence for the architecture

The first-party boards — Amazon and Greenhouse, through their own documented
APIs — return descriptions 11× longer than the aggregator and are the only
sources the scoring can work on honestly. The aggregator contributes breadth
and coordinates; the first-party boards contribute analysable text.

That is the strongest argument for weighting them more heavily, and it is a
finding about the data rather than a preference.

## Method note

Both bugs were found by measuring rather than reading. The sequence was:

1. The score looked wrong, so sweep the formula's parameters — no improvement.
2. Print the actual denominator for the best-matching posting: five
   "recognized skills", and they were `power`, `system`, `test`, `product`,
   `design` — generic words, not skills.
3. That is not a formula problem, so look at the stored text itself.

Step 3 is the one that should have come first.
