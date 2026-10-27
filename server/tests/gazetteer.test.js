import test from 'node:test';
import assert from 'node:assert/strict';

import { locate, gazetteerSize } from '../src/jobs/gazetteer.js';

const near = (actual, expected, tolerance = 0.5) =>
  Math.abs(actual - expected) <= tolerance;

test('a city with a state resolves to that city', () => {
  const r = locate('Seattle, WA');
  assert.equal(r.precision, 'city');
  assert.ok(near(r.latitude, 47.61) && near(r.longitude, -122.33), JSON.stringify(r));
});

test('a bare city name resolves', () => {
  assert.equal(locate('Dublin').precision, 'city');
  assert.equal(locate('Austin').precision, 'city');
});

test("a provider's own ordering is handled whichever way round it is", () => {
  // Amazon writes "AU, NSW, Sydney"; its normalized field writes
  // "Sydney, New South Wales, AUS". Both must land on Sydney.
  for (const form of ['AU, NSW, Sydney', 'Sydney, New South Wales, AUS']) {
    const r = locate(form);
    assert.equal(r.precision, 'city', form);
    assert.ok(near(r.latitude, -33.87) && near(r.longitude, 151.21), `${form} -> ${JSON.stringify(r)}`);
  }
});

test('a structured area array is read most-specific first', () => {
  // Adzuna's area is coarse-to-fine, so the city is last.
  const r = locate('Mountain View', ['US', 'California', 'Santa Clara County', 'Mountain View']);
  assert.equal(r.precision, 'city');
  assert.ok(near(r.latitude, 37.39), JSON.stringify(r));
});

test('an unknown town falls back to its region, not to nothing', () => {
  const r = locate('Comotara, Sedgwick County', ['US', 'Kansas', 'Sedgwick County', 'Comotara']);
  assert.equal(r.precision, 'region');
  assert.ok(near(r.latitude, 38.5, 1), JSON.stringify(r));
});

test('a country-only location resolves no finer than the country', () => {
  const r = locate('Ireland');
  assert.equal(r.precision, 'country');
});

test('remote is not a place and gets no pin', () => {
  // Pinning remote work to a country centroid would invent a cluster in the
  // middle of Kansas that no job is actually in.
  for (const form of ['Remote', 'Remote - US', 'Work from home', 'Fully remote (WFH)', 'Anywhere']) {
    assert.equal(locate(form), null, form);
  }
});

test('a place mentioning remote alongside a city still gets no pin', () => {
  // "New York (Remote)" is a remote role, not a New York one.
  assert.equal(locate('New York (Remote)'), null);
});

test('an unresolvable or empty location returns null rather than guessing', () => {
  for (const form of ['Nowhere Township, Fakeland', '', null, undefined, '—']) {
    assert.equal(locate(form), null, String(form));
  }
});

test('state abbreviations and full names both work', () => {
  const abbr = locate('Nowhereville, TX');
  const full = locate('Nowhereville, Texas');
  assert.equal(abbr.precision, 'region');
  assert.equal(full.precision, 'region');
  assert.deepEqual([abbr.latitude, abbr.longitude], [full.latitude, full.longitude]);
});

test('Washington the city and Washington the state do not collide', () => {
  const dc = locate('Washington, DC');
  const state = locate('Nowhereville, WA');

  assert.equal(dc.precision, 'city');
  assert.ok(near(dc.latitude, 38.91), JSON.stringify(dc));
  assert.equal(state.precision, 'region');
  assert.ok(near(state.latitude, 47.4), JSON.stringify(state));
});

test('coordinates are plausible everywhere in the gazetteer', () => {
  const { cities, regions } = gazetteerSize();
  assert.ok(cities > 150, `only ${cities} cities`);
  assert.ok(regions > 40, `only ${regions} regions`);

  for (const name of ['Tokyo', 'Sao Paulo', 'Cape Town', 'Bangalore', 'Toronto']) {
    const r = locate(name);
    assert.ok(r, `${name} missing`);
    assert.ok(r.latitude >= -90 && r.latitude <= 90, `${name} latitude ${r.latitude}`);
    assert.ok(r.longitude >= -180 && r.longitude <= 180, `${name} longitude ${r.longitude}`);
  }
});
