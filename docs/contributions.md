# Contributions

For the final presentation slide, and to be filled in by the people who did the
work — not inferred by anyone later.

## Why this file exists

The repository history is **not** a usable record of who did what. Most of the
project sits in a handful of large commits under one account:

```
191f8e2  Added mobile capability
cd13567  All updates since last 2 meetings. Map integration + better analysis
2c021d4  Fixed issue with uploading resume
dfb10a7  Rough demo of the app
```

`git log` will therefore attribute almost everything to one person, which is
wrong and will look wrong on a slide. Attribution has to come from the team's
own record instead.

## How to fill this in

Each person writes their own row. Name the **area owned**, not a list of tasks —
a slide has room for one line per person, and "owned the job-source integration
and its policy audit" reads better than six bullet points.

Do it now rather than in December. Four weeks from the end, nobody remembers who
built the gazetteer.

| Member | Area owned | Specific contributions |
|---|---|---|
| Alisha Karim | | |
| Rehman Khan | | |
| Egid Metalia | | |
| Xavier Perez | | |

## Areas available to claim

Taken from [timeline.md](timeline.md), so nothing is missed:

- **Authentication and data layer** — JWT/bcrypt, the schema, the migration
  runner
- **Resume parsing** — document structure, sections, entries, the evidence tiers
- **Analysis pipeline** — tokenizer, Porter stemmer, TF-IDF, cosine, BM25
- **Scoring and calibration** — the reference ladder, the measurements, the
  ceiling finding
- **Honest AI** — the control-flow constraint, the two rewrite providers
- **Job sources** — the multi-provider adapter, the policy audit, listing
  lifecycle and verification
- **Classification and filtering** — the field taxonomy, role families, skill
  and location filters
- **Map** — Leaflet, the offline gazetteer, clustering, the WebView build
- **Interface** — the screens, the charts, the preference dropdown
- **Cross-platform** — the iOS/Android build, API host resolution
- **Documentation** — the README, this archive, the report, the slides

## From now on

Commit under your own GitHub account, in smaller commits, and `git log` becomes
the record for the rest of the project. It is too late for the first three
months, but there are four weeks left and they are the weeks the final report
describes.
