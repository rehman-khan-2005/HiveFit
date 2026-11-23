// Where a posting is, for the "United States only" preference.
//
// The gazetteer's own tables cannot answer this: REGIONS holds Ontario and
// British Columbia next to the states, and STATE_ABBR maps "ON" to Ontario, so
// a domestic set derived from either classes Toronto as domestic. The tests
// below are mostly about not doing that.

import test from 'node:test';
import assert from 'node:assert/strict';

import { locationScope } from '../src/jobs/gazetteer.js';
import { filterByScope } from '../src/jobs/filters.js';

test('a named state is domestic, written either way', () => {
  for (const location of ['New York, NY', 'Austin, TX', 'Seattle, Washington', 'Chicago, IL']) {
    assert.equal(locationScope(location), 'us', location);
  }
});

test('DC and Puerto Rico are domestic', () => {
  assert.equal(locationScope('Washington, DC'), 'us');
  assert.equal(locationScope('San Juan, PR'), 'us');
});

test('a named country outside the US is recognized as such', () => {
  for (const location of ['Toronto, Canada', 'London, United Kingdom', 'Bangalore, India',
    'Berlin, Germany', 'Paris, France', 'Mexico City, Mexico']) {
    assert.equal(locationScope(location), 'other', location);
  }
});

test('a Canadian province code is not mistaken for a state', () => {
  // "ON" resolves to Ontario in the gazetteer's own abbreviation table, which
  // is in REGIONS, which is how this reads as domestic if the US set is
  // derived rather than stated.
  assert.notEqual(locationScope('Toronto, ON'), 'us');
  assert.notEqual(locationScope('Vancouver, BC'), 'us');
});

test('a colliding two-letter code reads as the state', () => {
  // IN, IL, DE and CA are Indiana, Illinois, Delaware and California as often
  // as they are India, Israel, Germany and Canada — and on a US job board,
  // far more often.
  assert.equal(locationScope('Indianapolis, IN'), 'us');
  assert.equal(locationScope('Chicago, IL'), 'us');
  assert.equal(locationScope('Wilmington, DE'), 'us');
  assert.equal(locationScope('San Francisco, CA'), 'us');
});

test('remote is its own answer, not a place', () => {
  for (const location of ['Remote', 'Remote - US', 'Remote (Canada)', 'Work from home']) {
    assert.equal(locationScope(location), 'remote', location);
  }
});

test('a bare city name decides nothing', () => {
  // There is a London in Ontario and a Paris in Texas, and the gazetteer's
  // city table is not US-only, so a city match cannot stand in for a country.
  assert.equal(locationScope('Zurich'), 'unknown');
  assert.equal(locationScope('Nowhereville, ZZ'), 'unknown');
});

test('nothing at all is unknown, not domestic', () => {
  assert.equal(locationScope(''), 'unknown');
  assert.equal(locationScope(null), 'unknown');
  assert.equal(locationScope(undefined), 'unknown');
});

const POOL = [
  { id: 1, location: 'New York, NY' },
  { id: 2, location: 'Toronto, Canada' },
  { id: 3, location: 'Remote' },
  { id: 4, location: 'Zurich' },
  { id: 5, location: 'London, United Kingdom' },
];

test('"any" filters nothing', () => {
  assert.equal(filterByScope(POOL, 'any').length, 5);
  assert.equal(filterByScope(POOL, undefined).length, 5);
});

test('"domestic" drops only what is confidently elsewhere', () => {
  const kept = filterByScope(POOL, 'domestic').map((job) => job.id);
  // Zurich stays: an unparsed location is not evidence the job is abroad, and
  // losing a usable job that way is worse than showing one extra.
  assert.deepEqual(kept, [1, 3, 4]);
});

test('"remote" keeps only postings that say so', () => {
  assert.deepEqual(filterByScope(POOL, 'remote').map((job) => job.id), [3]);
});
