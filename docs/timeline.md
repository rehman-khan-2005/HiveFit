# Timeline

Four periods, bounded by advisor meetings. Newest first. Feature dates come
from the repository rather than recollection.

---

## v0.5 — 23 November 2026 → present

**What you see, and what the score is actually worth**

The 23 November meeting asked for a 50% cutoff on the results list. Checking it
first showed the cutoff would have hidden every job in the pool, which turned
into the largest single finding of the project.

### Scoring

- **The percentage ranks postings; it does not grade them.** Three candidate
  fixes were measured and rejected before anything was built. Postings are now
  banded *relative to the set being compared* — green, amber, grey — which is
  what the meeting suggested independently. Full write-up and numbers:
  [findings/scoring-ceiling.md](findings/scoring-ceiling.md).
- The absolute figure is still computed and still shown on the breakdown page,
  now next to the measurement and the command that reproduces it, so the caveat
  cannot drift away from the number it qualifies.

### Data quality

- **Descriptions were storing their own markup.** HTML entities were decoded
  *after* tags were stripped, so double-escaped markup from Greenhouse and The
  Muse was persisted as if it were prose — 268 postings, ~1,300 characters each.
  Every `div` and `quot` sat in the TF-IDF vocabulary, which is fitted across
  the whole corpus, so it shifted the weights used to score every other
  posting. See [findings/data-quality.md](findings/data-quality.md).
- **Three quarters of the pool has no description to score.** Adzuna truncates
  to 500 characters. On a snippet that short the score is a coin flip between 0
  and 100 rather than a measurement.

### Interface

- **Four display preferences in one dropdown** — match strength (colour, or
  colour and number), hide weak matches, where you will work, how much detail.
  Stored on the account rather than the device, because the same user opens
  this on a laptop and a phone. The option list is defined once on the server
  and sent to the client, which builds its dropdown from it.
- **"How these employers spell it."** An ATS keyword search is literal: a
  recruiter types "Kubernetes" and a resume saying "k8s" is not in the result
  set. 33 alias groups close the gap. It only fires on skills the resume
  already claims, and the advice is always additive — both spellings belong on
  the page.
- **On-demand availability check.** `POST /api/jobs/:id/check` asks a posting's
  own page whether it is still there, at the moment the user is about to spend
  an hour tailoring to it. Only a 404, 410 or explicit removal notice counts as
  gone; a 403 or a timeout reports as unknown and is rendered as such.

### Platform

- **The app runs on iOS and Android**, not only the web. The blocker was never
  the UI — it was that `localhost` means the handset on a phone, so the API
  address is now taken from the machine serving the JS bundle. The map runs the
  same Leaflet code inside a WebView, so pins and grouping are identical on
  both. One new dependency, already in Expo Go.

---

## v0.4 — 12 November 2026 → 23 November 2026

**Score guidance, tailoring advice, and far fewer board requests**

- **Band thresholds set to 80 / 60 / 40**, each shipping an interpretation and
  an instruction, with the ladder shown on the analysis screen.
- **Those thresholds did not fit real postings** — 98% of live listings landed
  in the bottom band. Documented rather than quietly patched; resolved in v0.5.
- **Ordered tailoring advice.** The gap list, buried-skills list and bullet
  critique each said something true and left the user to work out the order,
  which is the useful part. Steps now sort by what the change costs: free
  (evidence already on the page) → low (rewrite, no new claim) → asks you first
  → accept.
- **The boards are only called when the user means it.** Opening the tab: 77 ms,
  no board requests. Pressing Refresh: 1418 ms. Expiry moved off the read path,
  where it had been shrinking the pool for someone who was only scrolling.
- **A city-only listing pins to the business district.** "New York, NY" lands
  in Midtown rather than at City Hall.
- Map connected to the same skill filter as the list.

---

## v0.3 — 15 October 2026 → 12 November 2026

**The advisor's notes, implemented and measured**

- **Not applicable is no longer 100%.** A category the posting never mentions
  used to report 100%, flattering the resume for something it was never
  measured on. It now reports N/A.
- **BM25 added, and the scoring measured against the alternatives.**
  `npm run calibrate` scores one resume against a labelled ladder with all
  metrics and reports spread, margin and ordering. Cosine — the textbook
  metric — is the one that mis-ranks.
- **Two company career sites through their own APIs**: Amazon's public JSON
  endpoint and Greenhouse's documented board API. Nothing is scraped.
- **Every major board prohibits automated collection.**
  `npm run audit:sources` checks each site's live `robots.txt` and prints a
  verdict, so the answer is re-runnable.
  See [job-sources.md](job-sources.md).
- **Filter by required skill and by location**, with a 60% ubiquity ceiling —
  narrowing by a skill 76 of 80 postings mention returns 76 postings.
- **Three charts, no new dependency.** Built from layout primitives rather than
  adding a charting library to draw rectangles.
- **Map view.** Pan and zoom to an area, tap a pin, apply from it.
  OpenStreetMap rather than Google Maps: no billing account, and a web
  renderer. Offline gazetteer of 190 cities resolves city-only listings.

---

## v0.2 — 22 September 2026 → 15 October 2026

**Live job data, and a pool that goes stale on purpose**

- **Three sources behind one adapter**, queried concurrently, failing
  independently, merged round-robin so one source cannot fill the page.
- **Listings now expire.** Each posting tracks first seen, last seen and when
  we concluded it was gone. Run the same resume on Monday and Thursday and the
  pool genuinely differs.
- **Dead listings that no amount of refreshing removed.** Two defects: search
  never read the expiry flag, and every re-sighting cleared it — so a board
  still serving a listing whose page had already 404'd resurrected it forever.
  Fixed by separating inferred death from confirmed death.
- **The Muse switched off** for data quality: 95 of 95 stored postings 404'd on
  themuse.com itself. The client stays wired and tested.
- **Postings come back ranked**, best match first, decided once in the pipeline.
- **Skills you have but have not shown.** The other half of the keyword gap:
  what a posting wants that you *have*, but buried on a Skills line where no
  accomplishment demonstrates it. The cheapest fix available, since it needs no
  new claim.
- **Each bullet gets its own suggested terms.** Previously every bullet offered
  the same twelve, which made picking a bullet meaningless.
- **Apply links everywhere a match appears.**
- **Two levels of job classification.** A board asked for "software engineer"
  still returns nurses. A broad field sits above the tech-shaped role families.

---

## v0.1 — 10 September 2026 → 22 September 2026

**The system the report describes, built and running**

- **Three-tier stack in one npm workspace**: Express 5, React Native on Expo,
  MySQL 8 through a pooled `mysql2` connection, parameterized throughout.
- **Six-entity schema with the many-to-many resolved.** `ats_analyses` resolves
  resumes against postings, which is what makes comparing one resume to many
  jobs possible at all. (A seventh entity, `user_preferences`, arrived in v0.5.)
- **All five Level 1 DFD processes**, one router each.
- **Analysis pipeline, DFD 2.1–2.5**, one file per sub-process. Hand-written
  tokenizer, Porter stemmer, TF-IDF and cosine — no machine-learning
  dependency, which is what makes the pipeline inspectable for the report.
- **Honest AI: the constraint is in the control flow, not the prompt.**
  Unevidenced terms are never passed to the rewriter; the user is asked whether
  the experience is real. A test proves a deliberately credulous backend still
  cannot fabricate a qualification.
- **Structural resume parser** with four tiers of evidence — shown by the
  bullet, declared by the entry's tech stack, claimed on a Skills line, or
  absent. The middle tiers matter: a resume listing Python under Skills should
  not be asked whether it has ever used Python.
