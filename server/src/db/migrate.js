// Idempotent column/index additions for databases created before a feature
// landed.
//
// schema.sql is all CREATE TABLE IF NOT EXISTS, which silently does nothing
// when the table already exists — so a teammate who ran db:setup last month
// would otherwise never get the job-listing lifecycle columns, and would hit
// "Unknown column 'expired_at'" at runtime instead. MySQL has no
// ADD COLUMN IF NOT EXISTS, so the check happens here.

import { config } from '../config/env.js';

const COLUMNS = [
  ['job_postings', 'posted_at', 'DATETIME NULL AFTER url'],
  ['job_postings', 'closes_at', 'DATETIME NULL AFTER posted_at'],
  ['job_postings', 'first_seen_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at'],
  ['job_postings', 'last_seen_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER first_seen_at'],
  ['job_postings', 'expired_at', 'DATETIME NULL AFTER last_seen_at'],
  ['ats_analyses', 'underhighlighted', 'JSON NULL AFTER keyword_gap'],
  ['ats_analyses', 'retrieval', 'DECIMAL(5,2) NULL AFTER score'],
  ['ats_analyses', 'similarity', 'DECIMAL(5,2) NULL AFTER retrieval'],
  ['job_postings', 'latitude', 'DECIMAL(9,6) NULL AFTER url'],
  ['job_postings', 'longitude', 'DECIMAL(9,6) NULL AFTER latitude'],
  ['job_postings', 'geo_source', 'VARCHAR(20) NULL AFTER longitude'],
  ['job_postings', 'unavailable_at', 'DATETIME NULL AFTER expired_at'],
  ['job_postings', 'checked_at', 'DATETIME NULL AFTER unavailable_at'],
];

const INDEXES = [
  ['job_postings', 'idx_posting_active', '(expired_at, last_seen_at)'],
  ['job_postings', 'idx_posting_checked', '(unavailable_at, checked_at)'],
  ['job_postings', 'idx_posting_geo', '(latitude, longitude)'],
];

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [config.db.database, table, column]
  );
  return rows.length > 0;
}

async function hasIndex(conn, table, index) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [config.db.database, table, index]
  );
  return rows.length > 0;
}

async function hasTable(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [config.db.database, table]
  );
  return rows.length > 0;
}

/**
 * Bring an existing database up to date. Safe to run repeatedly.
 * @returns {Promise<string[]>} what it changed, for logging
 */
export async function migrate(conn) {
  const applied = [];

  for (const [table, column, definition] of COLUMNS) {
    if (!(await hasTable(conn, table))) continue;
    if (await hasColumn(conn, table, column)) continue;
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    applied.push(`${table}.${column}`);
  }

  for (const [table, index, definition] of INDEXES) {
    if (!(await hasTable(conn, table))) continue;
    if (await hasIndex(conn, table, index)) continue;
    await conn.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${definition}`);
    applied.push(`${table}:${index}`);
  }

  return applied;
}
