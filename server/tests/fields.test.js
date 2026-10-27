import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyField, fieldQuery, fieldLabel, FIELDS } from '../src/jobs/fields.js';

const label = (title, description = '') => classifyField({ title, description }).label;

test('each field is recognized from its own vocabulary', () => {
  const cases = [
    ['Registered Nurse (RN)', 'Healthcare & Medicine'],
    ['Occupational Therapist', 'Healthcare & Medicine'],
    ['Paralegal', 'Legal'],
    ['Staff Accountant', 'Finance & Accounting'],
    ['High School Math Teacher', 'Education'],
    ['Technical Recruiter', 'HR & Recruiting'],
    ['Software Engineer', 'Technology'],
    ['UX Designer', 'Design & Creative'],
    ['Electrician Apprentice', 'Construction & Trades'],
    ['Mechanical Engineer', 'Engineering (non-software)'],
    ['Research Scientist, Chemistry', 'Science & Research'],
    ['Account Executive', 'Sales & Marketing'],
    ['Line Cook', 'Hospitality & Food'],
    ['CDL A Roll-Off Driver', 'Operations & Logistics'],
    ['Administrative Assistant', 'Admin & Support'],
    ['Police Officer', 'Government & Public'],
  ];
  for (const [title, expected] of cases) {
    assert.equal(label(title), expected, title);
  }
});

test('an occupation outranks the industry it sits in', () => {
  // The whole point: a software job at a hospital is a software job, and a
  // student filtering to Technology needs to see it.
  assert.equal(label('Healthcare Software Engineer'), 'Technology');
  assert.equal(label('Financial Software Developer'), 'Technology');
  assert.equal(label('Clinical Data Analyst'), 'Technology');

  // But a clinical role that merely mentions software stays clinical.
  assert.equal(label('Nurse Informatics Specialist'), 'Healthcare & Medicine');
});

test('a trade is not mistaken for the engineering discipline it shares a word with', () => {
  assert.equal(label('Electrician'), 'Construction & Trades');
  assert.equal(label('Electrical Engineer'), 'Engineering (non-software)');
  assert.equal(label('Chief Engineer - Electrical'), 'Engineering (non-software)');
});

test('"engineer" alone never decides a field', () => {
  // Half a dozen fields use the word; matching it would collapse them all
  // into whichever rule happened to be listed first.
  assert.equal(label('Engineer'), 'Other');
  assert.equal(label('Engineering Manager'), 'Other');
});

test('a silent title falls back to the description, but only for safe fields', () => {
  assert.equal(
    label('Team Member', 'You will care for patients as a registered nurse on our ward.'),
    'Healthcare & Medicine'
  );
  // Sales is excluded from description matching: nearly every posting mentions it.
  assert.equal(
    label('Team Member', 'Support our sales organisation with scheduling.'),
    'Other'
  );
});

test('every field has a seed query, and it points at that field', () => {
  for (const { id } of FIELDS) {
    if (id === 'other') continue;
    const seed = fieldQuery(id);
    assert.ok(seed.length > 0, `${id} has no seed query`);
    // A seed that classifies as a different field would fetch the wrong pool.
    assert.equal(classifyField({ title: seed }).id, id, `seed "${seed}" does not read as ${id}`);
  }
});

test('an unknown field id has no label and no seed', () => {
  assert.equal(fieldLabel('nonsense'), null);
  assert.equal(fieldQuery('nonsense'), '');
});

test('classifying is case and punctuation tolerant', () => {
  assert.equal(label('SOFTWARE ENGINEER'), 'Technology');
  assert.equal(label('full-stack developer'), 'Technology');
  assert.equal(label('Registered Nurse, ICU'), 'Healthcare & Medicine');
});

test('missing input does not throw', () => {
  assert.equal(classifyField().id, 'other');
  assert.equal(classifyField({}).id, 'other');
});
