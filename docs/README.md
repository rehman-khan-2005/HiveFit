# HiveFit project record

The archive of what was built, when, and why. Source of truth for the public
site, the final report and the presentation.

**Published at:** _(paste the Google Sites URL here once it exists)_

## Why this lives in the repo

The published site is a Google Site, on a personal Google account, per the
advisor's instruction on 23 November 2026: a free service that outlasts an NYIT
account, and not `github.io`.

The *content* lives here because a record kept somewhere other than the thing
it describes drifts within weeks — nobody updates two places. Here, a commit
that changes behaviour can update the record in the same commit, and `git log`
dates every claim.

That makes the Site a published copy rather than a second original. If it turns
out the advisor meant a literally separate repository, this whole folder moves
with one `git mv` — the choice is cheap to reverse.

## Layout

```
docs/
  timeline.md        every period, newest first — the spine of the site
  meetings/          one file per advisor meeting: notes, then what was done
  findings/          the measured results; the actual research contribution
  job-sources.md     what each board permits (predates this folder)
  contributions.md   who did what, for the final presentation slide
  site-plan.md       the Google Sites page map, and what goes on each page
```

## How to add an entry

Do this at the **end of each advisor meeting**, not at the end of the semester.
Ten minutes four times beats a reconstruction in December.

1. **Create `meetings/YYYY-MM-DD.md`** from the template below. Paste the notes
   verbatim first, before interpreting them. Verbatim notes are evidence; a
   summary written later is recollection.
2. **Add a `timeline.md` section** for the period that just closed. Group by
   area, one short paragraph per change, and say what problem it solved — not
   just what was added.
3. **If something was measured, write it up in `findings/`** with the numbers
   and the command that reproduces them. A number nobody can re-derive is an
   anecdote.
4. **Update `contributions.md`** while you still remember who did what.
5. **Mirror the change onto the Site.** See `site-plan.md`.

### Meeting file template

```markdown
# Advisor meeting — DD Month YYYY

Present: ...
Advisor: Dr. Wenjia Li

## Notes as taken

> (verbatim, unedited — including the bits that turned out to be wrong)

## Action items

- [ ] item — owner

## What was done

...

## Raised but not built, and why

...
```

## Honesty rule

Record what was measured, including the measurements that went against us —
the scoring ceiling in `findings/scoring-ceiling.md` is the clearest example,
and it is the most defensible thing in this archive precisely because it says
what did not work. A record that only lists wins is a brochure, and a reader
who finds one overstated claim stops trusting the rest.

---

HiveFit · CSCI 456 Senior Project · Alisha Karim, Rehman Khan, Egid Metalia,
Xavier Perez · Advisor: Dr. Wenjia Li
