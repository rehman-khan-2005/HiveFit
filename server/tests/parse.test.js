import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseResume, extractBullets, extractBulletsWithContext } from '../src/nlp/parse.js';
import { classifyTerms, suggestForBullet, buildPlacementQuestion } from '../src/ai/suggest.js';
import { heuristicProvider } from '../src/ai/provider.js';

const here = dirname(fileURLToPath(import.meta.url));
// A real-world LaTeX-template resume ("Jake's Resume" lineage), which is the
// dominant format among CS students and the one this parser must handle.
const RESUME = readFileSync(resolve(here, 'fixtures/latex-style-resume.txt'), 'utf8');

test('recognizes the document header without treating it as content', () => {
  const parsed = parseResume(RESUME);
  assert.equal(parsed.name, 'Rehman Khan');
  assert.ok(parsed.contact?.includes('linkedin.com'), 'contact line should be captured');
  assert.ok(!extractBullets(RESUME).some((b) => b.includes('linkedin.com')),
    'the contact line must never be offered as a bullet to improve');
});

test('detects section headers set in title case, not just all caps', () => {
  const kinds = parseResume(RESUME).sections.map((s) => s.kind);
  for (const expected of ['education', 'skills', 'projects', 'experience']) {
    assert.ok(kinds.includes(expected), `expected a ${expected} section, got ${kinds.join(', ')}`);
  }
});

test('parses labelled skill lines into groups instead of bullets', () => {
  const { skills } = parseResume(RESUME);
  assert.ok(skills.groups.Languages?.includes('Python'));
  assert.ok(skills.groups.Frameworks?.includes('React'));
  assert.ok(skills.groups.Libraries?.includes('NumPy'));
  assert.ok(skills.all.includes('MySQL'));

  assert.ok(!extractBullets(RESUME).some((b) => /^Languages:/.test(b)),
    'a skills list is not something the user can rewrite as an accomplishment');
});

test('splits an entry header into title, org, location, tech and dates', () => {
  const parsed = parseResume(RESUME);
  const entries = parsed.sections.flatMap((s) => s.entries);

  const project = entries.find((e) => e.title.startsWith('Ease-On'));
  assert.ok(project, 'project entry should be found');
  assert.deepEqual(project.tech, ['React', 'Node.js', 'PostgreSQL', 'Firebase', 'Capacitor']);
  assert.equal(project.dates, 'May 2026');

  const job = entries.find((e) => e.title.startsWith('Computer Aide'));
  assert.equal(job.org, 'Con Edison');
  assert.equal(job.location, 'New York, NY');
  assert.deepEqual(job.tech, [], 'a location must not be mistaken for a tech stack');
});

test('extracts only genuine accomplishment bullets', () => {
  const bullets = extractBullets(RESUME);
  assert.equal(bullets.length, 7, `expected 7 bullets, got ${bullets.length}`);
  assert.ok(bullets.every((b) => /^[A-Z]/.test(b)), 'each bullet should start with a verb');

  for (const noise of ['Languages:', 'linkedin', 'GPA', '| Python, Scikit-learn']) {
    assert.ok(!bullets.some((b) => b.includes(noise)), `"${noise}" must not appear as a bullet`);
  }
});

test('rejoins a bullet that PDF extraction wrapped onto a second line', () => {
  const bullets = extractBullets(RESUME);
  const wrapped = bullets.find((b) => b.startsWith('Engineered a supervised learning'));
  assert.ok(wrapped.includes('Forest and gradient boosting'),
    'the continuation line should be rejoined, not dropped or split off');
  assert.ok(wrapped.endsWith('attack categories.'));
});

test('each bullet carries the entry it belongs to', () => {
  const withContext = extractBulletsWithContext(RESUME);
  const firebase = withContext.find((b) => b.text.includes('Firebase'));
  assert.equal(firebase.entryTitle, 'Ease-On');
  assert.equal(firebase.sectionKind, 'projects');
  assert.ok(firebase.entryTech.includes('React'));
});

test('evidence tiers separate bullet, entry, resume and nothing', () => {
  const parsed = parseResume(RESUME);
  // The second Ease-On bullet, which names Firebase in its own text.
  const bullet = parsed.bullets.find(
    (b) => b.entryTitle === 'Ease-On' && b.text.includes('Firebase')
  );
  const context = {
    entryTitle: bullet.entryTitle,
    entryTech: bullet.entryTech,
    skills: parsed.skills.all,
  };

  const out = classifyTerms(bullet.text, ['Firebase', 'React', 'MatLab', 'Kubernetes'], context);
  assert.ok(out.evidenced.includes('Firebase'), 'named in the bullet itself');
  assert.ok(out.fromEntry.includes('React'), "declared in the entry's stack");
  assert.ok(out.fromResume.includes('MatLab'), 'listed under Skills but not used here');
  assert.ok(out.unsupported.includes('Kubernetes'), 'absent from the resume entirely');
});

test('a skill the entry declares is written without interrogating the user', async () => {
  const parsed = parseResume(RESUME);
  const bullet = parsed.bullets.find((b) => b.entryTitle === 'Ease-On');

  const result = await suggestForBullet({
    bullet: bullet.text, targetTerms: ['React'],
    context: { entryTitle: bullet.entryTitle, entryTech: bullet.entryTech, skills: parsed.skills.all },
    provider: heuristicProvider,
  });

  assert.equal(result.status, 'suggested');
  assert.ok(result.termsAddressed.includes('React'));
});

test('a skill listed only under Skills asks about placement, not existence', async () => {
  const parsed = parseResume(RESUME);
  const bullet = parsed.bullets.find((b) => /desktop and application support/.test(b.text));

  const result = await suggestForBullet({
    bullet: bullet.text, targetTerms: ['Python'],
    context: { entryTitle: bullet.entryTitle, entryTech: bullet.entryTech, skills: parsed.skills.all },
    provider: heuristicProvider,
  });

  assert.equal(result.status, 'needs_input');
  assert.match(result.question, /already lists/i,
    'must acknowledge the skill is on the resume rather than doubting it');
  assert.ok(!/Have you actually worked with/i.test(result.question),
    'accusing a user of not having a skill their resume lists is the bug this fixes');
});

test('placement question names the entry it would land in', () => {
  const q = buildPlacementQuestion(['Docker'], 'Ease-On');
  assert.match(q, /your work on Ease-On/);
  assert.match(q, /wrong project/);
});

test('a plain prose resume still parses', () => {
  const plain = `Jane Doe
jane@example.com
EXPERIENCE
Software Engineer, Acme
• Built an API in Python serving 1,000 requests per day
• Wrote tests and improved coverage to 85%
EDUCATION
State University`;
  const bullets = extractBullets(plain);
  assert.equal(bullets.length, 2);
  assert.ok(bullets[0].startsWith('Built an API'));
});

test('empty and malformed input does not throw', () => {
  for (const input of ['', null, undefined, 'x', '\n\n\n']) {
    const parsed = parseResume(input);
    assert.ok(Array.isArray(parsed.bullets));
    assert.deepEqual(extractBullets(input), []);
  }
});

test('coursework counts as evidence but awards do not', () => {
  const parsed = parseResume(RESUME);

  assert.ok(parsed.coursework.includes('Data Structures'));
  assert.ok(parsed.coursework.includes('Computer Organization & Architecture'),
    'a coursework line wrapped across two lines should rejoin');

  assert.ok(parsed.awards.some((a) => /National Honor Society/.test(a)));

  // The separation is the point: an award name matching a posting term is a
  // coincidence, and must never be treated as a demonstrated skill.
  for (const award of parsed.awards) {
    assert.ok(!parsed.skills.all.includes(award), `"${award}" must not be a skill`);
  }
  assert.equal(parsed.skills.all.length, 17, 'only real skills belong in skills.all');
});

test('a following entry is not swallowed by the list above it', () => {
  const parsed = parseResume(RESUME);
  assert.ok(!parsed.coursework.some((c) => /Google/.test(c)),
    'the Google certificate entry must not be absorbed into coursework');
});
