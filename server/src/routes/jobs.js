// Process 4.0 — Job Search.

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, badRequest, notFound } from '../middleware/error.js';
import { searchJobs, hasLiveProvider } from '../jobs/index.js';
import { classifyRole, ROLE_FAMILIES } from '../jobs/roles.js';
import { classifyField, FIELDS, fieldLabel, fieldQuery } from '../jobs/fields.js';
import { MAX_POSTINGS_PER_ANALYSIS } from '../config/limits.js';
import { filterBySkills, filterByLocation, skillsInPool } from '../jobs/filters.js';
import {
  upsertPostings, expireStale, freshnessSummary, unavailableIds,
  postingsInBounds, geoCoverage,
} from '../jobs/store.js';
import { intParam, optionalString } from '../utils/validate.js';

export const jobRouter = Router();
jobRouter.use(requireAuth);

/** Tag each posting with its broad field and, within tech, its role family. */
function tag(jobs) {
  return jobs.map((job) => {
    const field = classifyField(job);
    return {
      ...job,
      field,
      // Role families are tech-shaped, so they only mean anything inside
      // Technology. Null elsewhere rather than a misleading "Other".
      role: field.id === 'technology' ? classifyRole(job) : null,
    };
  });
}

/** Count postings per field, so the picker can show real numbers. */
function fieldCounts(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    const { id, label } = job.field;
    const entry = counts.get(id) ?? { id, label, count: 0 };
    entry.count += 1;
    counts.set(id, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

const REMOTE_REQUEST = /\b(remote|work from home|wfh|telecommute)\b/i;

/**
 * GET /api/jobs/search?query=&location=&limit=&field=&skills=&skillMode=
 *
 * Results are persisted to job_postings so an analysis can reference them by
 * id, and so a saved job survives the search that found it.
 *
 * Every search is also a sighting: postings returned here have their
 * last_seen_at bumped, which is what keeps them out of the expiry sweep. A
 * pool refreshed only by searching drifts towards whatever the user searches
 * for, so `npm run jobs:refresh` exists to sweep the roles nobody looked at.
 *
 * Results are then filtered against what we know is dead. This matters more
 * than it sounds: the response is the provider's answer, not a database read,
 * so without this step a board that keeps serving a listing whose page has
 * already 404'd keeps putting it in front of the user no matter how many
 * times the pool has been refreshed.
 */
jobRouter.get('/search', asyncRoute(async (req, res) => {
  const search = optionalString(req.query.query, 'query', 200) ?? '';
  const location = optionalString(req.query.location, 'location', 200) ?? '';
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const field = optionalString(req.query.field, 'field', 40)?.toLowerCase() ?? null;

  const skills = (optionalString(req.query.skills, 'skills', 300) ?? '')
    .split(',').map((skill) => skill.trim()).filter(Boolean).slice(0, 12);
  const skillMode = req.query.skillMode === 'all' ? 'all' : 'any';

  if (field && !FIELDS.some((f) => f.id === field)) {
    throw badRequest(`Unknown field "${field}". One of: ${FIELDS.map((f) => f.id).join(', ')}`);
  }

  // No provider can filter by field or by required skill, so that narrowing
  // happens here — which means fetching well past the page size first, or
  // asking for Technology on a pool that is half nursing returns four jobs.
  const narrowing = Boolean(field) || skills.length > 0 || REMOTE_REQUEST.test(location);
  const fetchLimit = narrowing ? Math.min(200, Math.max(limit * 4, 100)) : limit;

  // A chosen field with no query of its own steers the board's keyword search,
  // rather than leaving the filter to sieve a pool that holds nothing matching.
  const effectiveQuery = search || (field ? fieldQuery(field) : '');

  const { provider, providers, jobs, live, degraded } = await searchJobs({
    query: effectiveQuery, location, limit: fetchLimit,
  });

  const { jobs: persisted, added, refreshed } = await upsertPostings(jobs);

  // One indexed UPDATE, on the read path on purpose: it is what makes the pool
  // shrink as well as grow for someone who only ever opens the app, never the
  // refresh script.
  if (live) await expireStale();

  const hidden = await unavailableIds(persisted.map((job) => job.id));
  const available = persisted.filter((job) => !hidden.has(job.id));

  // Field and role are derived, not stored: they are view concerns, and a
  // stored copy would go stale the moment the patterns are tuned.
  const tagged = tag(available);

  // Counts describe the whole fetched pool, not the slice being returned, so
  // the picker can offer "Healthcare (31)" as something to switch to rather
  // than only showing what survived the current filter.
  const counts = fieldCounts(tagged);

  // Skills the pool actually asks for, offered as filter options so the user
  // picks from what is there rather than guessing into an empty result.
  const skillOptions = skillsInPool(tagged);

  let matching = field ? tagged.filter((job) => job.field.id === field) : tagged;
  matching = filterBySkills(matching, skills, skillMode);

  // Location is already sent to the provider, which knows about metro areas —
  // asking Adzuna for New York correctly returns Jersey City, and re-filtering
  // on the literal string would throw that away. Remote is the exception: the
  // boards handle it badly enough to be worth enforcing here.
  if (REMOTE_REQUEST.test(location)) {
    matching = filterByLocation(matching, 'remote');
  }

  res.json({
    provider,
    providers,
    live,
    degraded,
    count: Math.min(matching.length, limit),
    added,
    refreshed,
    // Listings the provider returned that we already know are gone. Surfaced
    // so a thin result set is explained rather than looking like a bug.
    hidden: hidden.size,
    field,
    fieldLabel: field ? fieldLabel(field) : null,
    skills,
    skillMode,
    // What the pool asks for, with how many postings want each.
    skillOptions,
    // How much of the pool can be shown on a map at all.
    coverage: await geoCoverage(),
    // Echoed so the UI can show what was actually asked of the board when it
    // filled in a query on the user's behalf.
    query: effectiveQuery,
    jobs: matching.slice(0, limit),
    fields: FIELDS,
    fieldCounts: counts,
    roleFamilies: ROLE_FAMILIES,
    // The picker has to respect the comparison cap, so it has to know it.
    maxComparable: MAX_POSTINGS_PER_ANALYSIS,
    freshness: await freshnessSummary(),
  });
}));

/**
 * GET /api/jobs/map?bbox=minLng,minLat,maxLng,maxLat&field=&skills=
 *
 * Postings inside the viewport, for the map view. Reads the stored pool, so
 * panning is free — a board request per pan would exhaust the rate limit in a
 * minute, and the user is moving around jobs already found rather than
 * searching again.
 *
 * bbox order is minLng,minLat,maxLng,maxLat — the same order Leaflet's
 * toBBoxString() emits, so the client can pass it through untouched.
 */
jobRouter.get('/map', asyncRoute(async (req, res) => {
  const bbox = (optionalString(req.query.bbox, 'bbox', 120) ?? '')
    .split(',').map(Number);

  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    throw badRequest('bbox must be four numbers: minLng,minLat,maxLng,maxLat');
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (minLat > maxLat || minLng > maxLng) {
    throw badRequest('bbox is inverted: expected minLng,minLat,maxLng,maxLat');
  }

  const field = optionalString(req.query.field, 'field', 40)?.toLowerCase() ?? null;
  if (field && !FIELDS.some((f) => f.id === field)) {
    throw badRequest(`Unknown field "${field}"`);
  }

  const skills = (optionalString(req.query.skills, 'skills', 300) ?? '')
    .split(',').map((skill) => skill.trim()).filter(Boolean).slice(0, 12);

  // One more than the cap, so hitting the cap is detectable rather than a
  // silent truncation the user reads as "that is all there is".
  const CAP = 300;
  const rows = await postingsInBounds({ minLat, maxLat, minLng, maxLng }, { limit: CAP + 1 });
  const truncated = rows.length > CAP;

  // The same two narrowings the list view applies, so switching to the map
  // does not silently widen what the user is looking at.
  let jobs = tag(rows.slice(0, CAP));
  if (field) jobs = jobs.filter((job) => job.field.id === field);
  jobs = filterBySkills(jobs, skills);

  res.json({
    count: jobs.length,
    // At this zoom there are more listings than were returned.
    truncated,
    // Descriptions are only needed for skill filtering, which has happened.
    // Shipping them to a map would be megabytes of payload per pan.
    jobs: jobs.map(({ description, ...job }) => job),
    coverage: await geoCoverage(),
  });
}));

/**
 * GET /api/jobs/freshness
 *
 * How the pool has moved lately. Declared before /:id — Express matches in
 * order, and "freshness" is a perfectly good :id as far as the router cares.
 */
jobRouter.get('/freshness', asyncRoute(async (req, res) => {
  res.json({ freshness: await freshnessSummary(), live: hasLiveProvider() });
}));

jobRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = intParam(req.params.id, 'id');
  const rows = await query('SELECT * FROM job_postings WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound('Job posting not found');
  res.json({ job: rows[0] });
}));
