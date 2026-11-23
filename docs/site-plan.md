# The Google Sites plan

Per the advisor's instruction on 23 November 2026: a free service that outlasts
an NYIT account, on a **personal** Google account, and **not** `github.io`.

## Setup

1. Sign in to a **personal** Google account — not the NYIT one. NYIT accounts
   are reclaimed, and the point of this site is that it survives graduation.
2. Create a site at [sites.google.com](https://sites.google.com).
3. Name it `HiveFit — CSCI 456 Senior Project`.
4. **Add the other three members as editors.** A site owned by one person has
   exactly the durability problem this exercise is meant to solve, so this step
   is not optional.
5. Publish, and paste the URL into `docs/README.md` and into the report.

## Page map

One page per file in this folder. The site is a published copy of `docs/`, so
there is nothing to invent when writing it.

| Page | Source | Holds |
|---|---|---|
| **Home** | `README.md` | What HiveFit is, the team, the advisor, a screenshot, the repo link |
| **Timeline** | `timeline.md` | Five releases, newest first. The spine of the site |
| **Findings** | `findings/*.md`, `job-sources.md` | Three sub-pages. The actual research contribution |
| **Meetings** | `meetings/*.md` | Four sub-pages, verbatim notes then outcomes |
| **Team** | `contributions.md` | One line per person |
| **Demo** | — | Screenshots, and a screen recording if there is time |

## Home page copy

Something close to this, so the first screen says what the project *is* rather
than what stack it uses:

> **HiveFit** is a resume optimisation and job-matching platform. It scores a
> resume against real job postings, shows exactly which requirements are met
> and which are missing, and — unlike the tools it was benchmarked against —
> refuses to write a qualification the user does not have.
>
> Built for CSCI 456 at NYIT by Alisha Karim, Rehman Khan, Egid Metalia and
> Xavier Perez, advised by Dr. Wenjia Li.

## What to lead the Findings page with

The [scoring ceiling](findings/scoring-ceiling.md). It is the strongest thing
in the project and it is a negative result: the industry-standard single match
percentage has a hard ceiling around 34% on real job postings, and we changed
what the interface claims rather than rescaling the bands to hide it.

A reader who sees that first will trust everything after it.

## Keeping it current

Update the Site in the same sitting as the `docs/` change — not "later". The
whole failure mode of a second location is that it becomes a snapshot of
whenever someone last had time.

Owner: _(assign one person, write their name here)_

## A note on the change log

The existing change log artifact covers v0.1–v0.4 and lives on one member's
Claude account, which has the same single-owner durability question as an NYIT
account. Its content is now in [timeline.md](timeline.md), so once the Site is
up the artifact is a convenience copy rather than the record.
