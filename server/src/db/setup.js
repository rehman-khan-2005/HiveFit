// Creates the database (if absent) and applies schema.sql.
// Run with: npm run db:setup

import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { explainDbError } from './preflight.js';
import { migrate } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const { database, ...connectionConfig } = config.db;

  const root = await mysql.createConnection({ ...connectionConfig, multipleStatements: true });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await root.end();
  console.log(`database "${database}" ready`);

  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  const sql = await readFile(resolve(here, 'schema.sql'), 'utf8');
  await conn.query(sql);

  // schema.sql only creates what is missing, so an existing database needs the
  // additive migrations applied on top.
  const applied = await migrate(conn);

  const [tables] = await conn.query('SHOW TABLES');
  await conn.end();

  console.log(`applied schema.sql — ${tables.length} tables:`);
  for (const row of tables) console.log(`  - ${Object.values(row)[0]}`);

  if (applied.length > 0) {
    console.log(`migrated ${applied.length} existing column(s)/index(es):`);
    for (const change of applied) console.log(`  + ${change}`);
  }
}

main().catch((err) => {
  console.error(`\ndb:setup failed.\n\n${explainDbError(err)}\n`);
  process.exit(1);
});
