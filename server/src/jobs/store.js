// Persistence and lifecycle for job postings.
//
// A job board is a moving target, but a database table is not: without the
// bookkeeping here the pool only ever grows, and a resume analysed on Monday
// and again on Thursday is scored against an identical, steadily staler set of
// postings. Three facts are tracked per listing — when we first saw it, when
// we last saw it, and when we concluded it was gone — and the rules that read
// them live here rather than in the route, because the search path and the
// refresh script have to agree on what "still listed" means.

import { query, execute } from '../db/pool.js';
import { config } from '../config/env.js';
import { locate } from './gazetteer.js';

// Sources that are never expired.
//
//   manual    the user pasted this posting themselves. It is theirs, it is
//             attached to analyses they ran, and no sweep will ever return it,
//             so a staleness rule would delete their own input from under them.
//   fixtures  the offline demo set is not a live board. Expiring it would empty
//             the no-API-key experience after a week.
const IMMORTAL_SOURCES = ['manual', 'fixtures'];

/**
 * Insert or refresh postings, maintaining the lifecycle columns.
 *
 * A posting seen again has its last_seen_at bumped and its expiry cleared —
 * boards do pull a listing and put it back, and treating the second sighting
 * as a brand new job would lose the saved-job link and the analysis history
 * hanging off the original row.
 *
 * @param {object[]} jobs  normalized postings from a provider
 * @returns {Promise<{jobs: object[], added: number, refreshed: number}>}
 */
export async function upsertPostings(jobs) {
  if (jobs.length === 0) return { jobs: [], added: 0, refreshed: 0 };

  // Which of these we have seen before, asked once rather than per row.
  // affectedRows cannot answer this: MySQL reports 2 for an update that
  // changed something and 0 for one that did not, so a re-seen posting whose
  // title is unchanged is indistinguishable from a brand new one.
  const pairs = jobs.map((job) => [job.source, String(job.external_id)]);
  const placeholders = pairs.map(() => '(?, ?)').join(', ');
  const existingRows = await query(
    `SELECT source, external_id FROM job_postings WHERE (source, external_id) IN (${placeholders})`,
    pairs.flat()
  );
  const known = new Set(existingRows.map((r) => `${r.source}:${r.external_id}`));

  const persisted = [];
  let added = 0;
  let refreshed = 0;

  for (const job of jobs) {
    const isNew = !known.has(`${job.source}:${String(job.external_id)}`);

    // Only Adzuna hands us coordinates. Everything else gets resolved here, in
    // one place, so a provider client never has to care about the map.
    let { latitude = null, longitude = null, geo_source: geoSource = null } = job;
    if (latitude == null || longitude == null) {
      const found = locate(job.location, job.area);
      if (found) {
        latitude = found.latitude;
        longitude = found.longitude;
        geoSource = `gazetteer:${found.precision}`;
      }
    }

    const result = await execute(
      `INSERT INTO job_postings
         (source, external_id, title, company, location, description,
          salary_min, salary_max, url, latitude, longitude, geo_source,
          posted_at, closes_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         title = VALUES(title),
         description = VALUES(description),
         salary_min = VALUES(salary_min),
         salary_max = VALUES(salary_max),
         url = VALUES(url),
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         geo_source = VALUES(geo_source),
         closes_at = VALUES(closes_at),
         last_seen_at = CURRENT_TIMESTAMP,
         -- Clearing expired_at is right: the board is serving it again, so the
         -- inference that it had gone was wrong. unavailable_at is deliberately
         -- NOT cleared — that one was established by fetching the listing, and
         -- a board still listing a page that 404s does not make it live again.
         expired_at = NULL`,
      [
        job.source, String(job.external_id), job.title, job.company ?? null,
        job.location ?? null, job.description, job.salary_min ?? null,
        job.salary_max ?? null, job.url ?? null,
        latitude, longitude, geoSource,
        job.posted_at ?? null, job.closes_at ?? null,
      ]
    );

    if (isNew) added += 1; else refreshed += 1;
    persisted.push({ ...job, id: result.insertId, isNew, latitude, longitude, geo_source: geoSource });
  }

  return { jobs: persisted, added, refreshed };
}

/**
 * Active postings with coordinates inside a bounding box.
 *
 * Reads the stored pool rather than calling a provider, because a map pan is
 * not a new search — the user is moving around the jobs already found, and
 * firing a board request per pan would burn the rate limit in a minute.
 *
 * @param {object} box {minLat, maxLat, minLng, maxLng}
 * @param {object} [options] { limit, field, skills }
 */
export async function postingsInBounds(
  { minLat, maxLat, minLng, maxLng },
  { limit = 300 } = {}
) {
  return query(
    `SELECT id, source, title, company, location, url, latitude, longitude,
            geo_source, salary_min, salary_max, posted_at, description
       FROM job_postings
      WHERE expired_at IS NULL
        AND unavailable_at IS NULL
        AND latitude  BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      ORDER BY COALESCE(posted_at, first_seen_at) DESC
      LIMIT ?`,
    [Number(minLat), Number(maxLat), Number(minLng), Number(maxLng), Number(limit)]
  );
}

/**
 * Resolve coordinates for stored postings that have none.
 *
 * Free to run: the gazetteer is offline, so this is pure CPU over rows already
 * in the table. Worth doing because postings ingested before the map existed —
 * or whose provider gave no coordinates — would otherwise never appear on it.
 *
 * A row that still cannot be resolved is marked `geo_source = 'none'` rather
 * than left null, so the next run skips it instead of retrying the same
 * unresolvable string forever.
 */
export async function backfillCoordinates({ limit = 1000 } = {}) {
  const rows = await query(
    `SELECT id, location FROM job_postings
      WHERE latitude IS NULL AND geo_source IS NULL
      ORDER BY expired_at IS NOT NULL, last_seen_at DESC
      LIMIT ?`,
    [Number(limit)]
  );

  let located = 0;
  let unresolved = 0;

  for (const row of rows) {
    const found = locate(row.location);
    if (found) {
      await execute(
        'UPDATE job_postings SET latitude = ?, longitude = ?, geo_source = ? WHERE id = ?',
        [found.latitude, found.longitude, `gazetteer:${found.precision}`, row.id]
      );
      located += 1;
    } else {
      await execute("UPDATE job_postings SET geo_source = 'none' WHERE id = ?", [row.id]);
      unresolved += 1;
    }
  }

  return { examined: rows.length, located, unresolved };
}

/** How much of the pool can be mapped at all, for the UI to be honest about it. */
export async function geoCoverage() {
  const [row] = await query(
    `SELECT
       SUM(expired_at IS NULL AND unavailable_at IS NULL) AS available,
       SUM(expired_at IS NULL AND unavailable_at IS NULL AND latitude IS NOT NULL) AS mappable
     FROM job_postings`
  );
  return {
    available: Number(row?.available ?? 0),
    mappable: Number(row?.mappable ?? 0),
  };
}

/**
 * Mark listings we have reason to believe are gone.
 *
 * Two independent signals, because only one of them is trustworthy. A stated
 * close date in the past is ground truth. No provider currently wired supplies
 * one — Adzuna and The Muse both publish a posting date and no deadline — but
 * the check is kept because the column is populated per-provider and a board
 * that does state a deadline should be believed over any heuristic.
 *
 * Everywhere else the only evidence is silence: a posting that sweeps stopped
 * returning. The TTL on that is deliberately generous, since a board dropping
 * a listing for a day is far more common than a job actually closing.
 *
 * @returns {Promise<{expired: number, byDeadline: number}>}
 */
export async function expireStale({ ttlHours = config.jobs.ttlHours } = {}) {
  const immortal = IMMORTAL_SOURCES.map(() => '?').join(', ');

  const deadline = await execute(
    `UPDATE job_postings
        SET expired_at = CURRENT_TIMESTAMP
      WHERE expired_at IS NULL
        AND source NOT IN (${immortal})
        AND closes_at IS NOT NULL
        AND closes_at < CURRENT_TIMESTAMP`,
    IMMORTAL_SOURCES
  );

  const stale = await execute(
    `UPDATE job_postings
        SET expired_at = CURRENT_TIMESTAMP
      WHERE expired_at IS NULL
        AND source NOT IN (${immortal})
        AND last_seen_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR)`,
    [...IMMORTAL_SOURCES, Number(ttlHours)]
  );

  return {
    expired: (deadline.affectedRows ?? 0) + (stale.affectedRows ?? 0),
    byDeadline: deadline.affectedRows ?? 0,
  };
}

/**
 * Postings worth checking for liveness, least recently checked first.
 *
 * Only ones we would still show: already-dead rows are not worth the request.
 * Ordering by checked_at with NULLs first means a run works through the pool
 * round-robin instead of re-checking the same few rows every time.
 */
export async function postingsToVerify({ limit = 40, recheckAfterHours = 24 } = {}) {
  return query(
    `SELECT id, source, title, url FROM job_postings
      WHERE expired_at IS NULL
        AND unavailable_at IS NULL
        AND url IS NOT NULL
        AND source NOT IN (${IMMORTAL_SOURCES.map(() => '?').join(', ')})
        AND (checked_at IS NULL OR checked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR))
      ORDER BY checked_at IS NOT NULL, checked_at ASC, last_seen_at DESC
      LIMIT ?`,
    [...IMMORTAL_SOURCES, Number(recheckAfterHours), Number(limit)]
  );
}

/** Record that these listings were confirmed gone. */
export async function markUnavailable(ids) {
  if (ids.length === 0) return 0;
  const result = await execute(
    `UPDATE job_postings
        SET unavailable_at = CURRENT_TIMESTAMP, checked_at = CURRENT_TIMESTAMP
      WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  return result.affectedRows ?? 0;
}

/** Record that these listings were checked and nothing conclusive came back. */
export async function markChecked(ids) {
  if (ids.length === 0) return 0;
  const result = await execute(
    `UPDATE job_postings SET checked_at = CURRENT_TIMESTAMP
      WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  return result.affectedRows ?? 0;
}

/**
 * Of these posting ids, which must never be shown again.
 *
 * Asked on the search path because search answers with what the provider just
 * returned, and a provider will happily keep returning a listing we have
 * already proven is gone.
 */
export async function unavailableIds(ids) {
  if (ids.length === 0) return new Set();
  const rows = await query(
    `SELECT id FROM job_postings
      WHERE id IN (${ids.map(() => '?').join(', ')})
        AND (unavailable_at IS NOT NULL OR expired_at IS NOT NULL)`,
    ids
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Hard-delete long-dead postings nothing refers to.
 *
 * Expiry is enough to keep them out of the UI, but the table grows forever
 * otherwise. Rows a user saved or analysed are kept regardless of age — those
 * belong to them, and the foreign keys would cascade the history away.
 */
export async function prunePostings({ olderThanHours = 720 } = {}) {
  const result = await execute(
    `DELETE p FROM job_postings p
      LEFT JOIN saved_jobs s   ON s.job_posting_id = p.id
      LEFT JOIN ats_analyses a ON a.job_posting_id = p.id
      WHERE s.id IS NULL AND a.id IS NULL
        AND p.source NOT IN (${IMMORTAL_SOURCES.map(() => '?').join(', ')})
        AND (p.unavailable_at IS NOT NULL OR p.expired_at IS NOT NULL)
        AND COALESCE(p.unavailable_at, p.expired_at) < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR)`,
    [...IMMORTAL_SOURCES, Number(olderThanHours)]
  );
  return result.affectedRows ?? 0;
}

/**
 * What changed in the pool lately — the numbers that make "run it on two
 * different days and the listings differ" visible rather than merely true.
 */
export async function freshnessSummary() {
  const [row] = await query(
    `SELECT
       SUM(expired_at IS NULL AND unavailable_at IS NULL)                             AS active,
       SUM(unavailable_at IS NOT NULL)                                                AS confirmedGone,
       SUM(checked_at IS NOT NULL)                                                     AS everChecked,
       SUM(expired_at IS NULL AND unavailable_at IS NULL AND first_seen_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY))  AS addedToday,
       SUM(expired_at IS NULL AND unavailable_at IS NULL AND first_seen_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY))  AS addedThisWeek,
       SUM(expired_at IS NOT NULL AND expired_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)) AS delistedThisWeek,
       SUM(expired_at IS NOT NULL)                                                    AS delistedTotal,
       MAX(last_seen_at)                                                              AS lastSweep
     FROM job_postings`
  );

  const count = (value) => Number(value ?? 0);
  return {
    active: count(row?.active),
    confirmedGone: count(row?.confirmedGone),
    everChecked: count(row?.everChecked),
    addedToday: count(row?.addedToday),
    addedThisWeek: count(row?.addedThisWeek),
    delistedThisWeek: count(row?.delistedThisWeek),
    delistedTotal: count(row?.delistedTotal),
    lastSweep: row?.lastSweep ?? null,
    ttlHours: Number(config.jobs.ttlHours),
  };
}
