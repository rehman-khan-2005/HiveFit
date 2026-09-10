// Seeds a demo account and the fixture job postings so the app is explorable
// immediately. Safe to re-run: everything is upserted.
// Run with: npm run db:seed

import { pool, query, execute } from './pool.js';
import { hashPassword } from '../middleware/auth.js';
import { FIXTURE_JOBS } from '../jobs/fixtures.js';
import { explainDbError } from './preflight.js';

const DEMO = {
  email: 'demo@hivefit.app',
  password: 'hivefit-demo',
  fullName: 'Demo Student',
};

const DEMO_RESUME = `Rehman Khan
New York, NY | rehman@example.com

EDUCATION
B.S. Computer Science, New York Institute of Technology

EXPERIENCE
Software Engineering Intern, Northwind Systems
• Built REST API endpoints in Node.js and Express serving 10,000 requests per day
• Migrated legacy reporting queries to indexed MySQL tables, cutting p95 latency by 40%
• Shipped a React dashboard used daily by the twelve-person support team
• Wrote unit tests and configured a CI/CD pipeline in GitHub Actions

Teaching Assistant, Data Structures
• Led weekly lab sections for 30 students on algorithms and Python
• Graded assignments and held office hours, improving average lab scores by 12%

SKILLS
JavaScript, Python, SQL, React, Node.js, Express, Git, Linux, MySQL`;

async function main() {
  const existing = await query('SELECT id FROM users WHERE email = ?', [DEMO.email]);
  let userId;

  if (existing.length > 0) {
    userId = existing[0].id;
    console.log(`demo user already exists (id ${userId})`);
  } else {
    const hash = await hashPassword(DEMO.password);
    const result = await execute(
      'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
      [DEMO.email, hash, DEMO.fullName]
    );
    userId = result.insertId;
    console.log(`created demo user ${DEMO.email} / ${DEMO.password} (id ${userId})`);
  }

  const resumes = await query('SELECT id FROM resumes WHERE user_id = ?', [userId]);
  if (resumes.length === 0) {
    const r = await execute(
      'INSERT INTO resumes (user_id, title, file_name, file_type, raw_text) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Demo resume', 'demo-resume.txt', 'txt', DEMO_RESUME]
    );
    console.log(`seeded demo resume (id ${r.insertId})`);
  } else {
    console.log('demo resume already present');
  }

  let inserted = 0;
  for (const job of FIXTURE_JOBS) {
    const result = await execute(
      `INSERT INTO job_postings
         (source, external_id, title, company, location, description, salary_min, salary_max, url)
       VALUES ('fixtures', ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), description = VALUES(description)`,
      [
        job.external_id, job.title, job.company, job.location,
        job.description.replace(/\s+/g, ' ').trim(),
        job.salary_min, job.salary_max, job.url,
      ]
    );
    if (result.affectedRows === 1) inserted += 1;
  }
  console.log(`job postings upserted (${inserted} new, ${FIXTURE_JOBS.length - inserted} existing)`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(`\ndb:seed failed.\n\n${explainDbError(err)}\n`);
  await pool.end().catch(() => {});
  process.exit(1);
});
