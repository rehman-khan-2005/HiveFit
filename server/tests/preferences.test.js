// Display preferences. The option list is the contract between the server's
// validation and the dropdown the client builds, so it is tested as one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PREFERENCES, DEFAULTS, sanitize, preferenceSchema } from '../src/preferences/options.js';

test('every preference has the shape the UI builds from', () => {
  for (const pref of PREFERENCES) {
    assert.ok(pref.key, 'has a key');
    assert.ok(pref.column, `${pref.key} names a column`);
    assert.ok(pref.label, `${pref.key} has a label`);
    assert.ok(pref.options.length >= 2, `${pref.key} offers a choice`);
    for (const option of pref.options) {
      assert.ok(option.value, `${pref.key} option has a value`);
      assert.ok(option.label, `${pref.key}=${option.value} has a label`);
      assert.ok(option.help, `${pref.key}=${option.value} explains itself`);
    }
  }
});

test('every default is one of the offered options', () => {
  // A default outside the option list renders as a blank dropdown.
  for (const pref of PREFERENCES) {
    assert.ok(
      pref.options.some((option) => option.value === pref.default),
      `${pref.key} defaults to one of its own options`
    );
  }
});

test('keys and columns are unique', () => {
  assert.equal(new Set(PREFERENCES.map((p) => p.key)).size, PREFERENCES.length);
  assert.equal(new Set(PREFERENCES.map((p) => p.column)).size, PREFERENCES.length);
});

test('match strength defaults to colour rather than a percentage', () => {
  // Measured, not a style choice: the percentage cannot support an absolute
  // reading on real listings, so it is not what the user sees first.
  assert.equal(DEFAULTS.scoreDisplay, 'band');
});

test('nothing is hidden by default', () => {
  // The user opts into a shorter list. Hiding postings on a first run would
  // look like the search found less than it did.
  assert.equal(DEFAULTS.hideBelow, 'nothing');
  assert.equal(DEFAULTS.locationScope, 'any');
});

test('a valid change is kept', () => {
  assert.deepEqual(sanitize({ scoreDisplay: 'percentage' }), { scoreDisplay: 'percentage' });
});

test('an unknown key is dropped, not stored', () => {
  assert.deepEqual(sanitize({ nonsense: 'x' }), {});
});

test('a value this server does not offer is dropped', () => {
  // Rejecting the request instead would stop a client built against an older
  // option list from saving the choices it does understand.
  assert.deepEqual(sanitize({ hideBelow: 'everything-above-50' }), {});
});

test('a partial change touches only what was sent', () => {
  const clean = sanitize({ detailLevel: 'summary', locationScope: 'bogus' });
  assert.deepEqual(clean, { detailLevel: 'summary' });
});

test('nothing sent is nothing changed', () => {
  assert.deepEqual(sanitize({}), {});
  assert.deepEqual(sanitize(), {});
});

test('the advertised schema carries no column names', () => {
  // Column names are storage detail. Publishing them invites a client to
  // depend on the table shape.
  for (const pref of preferenceSchema()) {
    assert.equal(pref.column, undefined);
    assert.ok(pref.options.length >= 2);
  }
});
