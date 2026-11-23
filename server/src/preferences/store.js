// Reading and writing one user's display preferences.

import { query, execute } from '../db/pool.js';
import { PREFERENCES, DEFAULTS, sanitize } from './options.js';

/**
 * One user's preferences, with defaults for anything unset.
 *
 * A user who has never opened the dropdown has no row, which is not an error —
 * it means the defaults, and the defaults live in code rather than in the
 * schema so changing one does not need a migration or a backfill.
 */
export async function getPreferences(userId) {
  const rows = await query('SELECT * FROM user_preferences WHERE user_id = ?', [userId]);
  if (rows.length === 0) return { ...DEFAULTS };

  const row = rows[0];
  const stored = {};
  for (const pref of PREFERENCES) {
    const value = row[pref.column];
    // A value stored before an option was renamed is no longer valid, so it
    // reads as the default rather than as something the UI cannot render.
    stored[pref.key] = pref.options.some((option) => option.value === value)
      ? value
      : pref.default;
  }
  return stored;
}

/**
 * Merge changes into a user's preferences.
 *
 * @returns {Promise<object>} the full set as stored, so the client never has to
 *   guess whether a value it sent was accepted.
 */
export async function savePreferences(userId, changes) {
  const clean = sanitize(changes);
  const current = await getPreferences(userId);
  const next = { ...current, ...clean };

  const columns = PREFERENCES.map((pref) => pref.column);
  const values = PREFERENCES.map((pref) => next[pref.key]);

  // One statement, so a half-saved set is not possible.
  await execute(
    `INSERT INTO user_preferences (user_id, ${columns.join(', ')})
     VALUES (?${', ?'.repeat(columns.length)})
     ON DUPLICATE KEY UPDATE ${columns.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
    [userId, ...values]
  );

  // Anything sent that was not stored: an unknown key, or a value this server
  // does not offer. Reported rather than silently dropped.
  const ignored = Object.keys(changes ?? {}).filter((key) => !(key in clean));

  return { preferences: next, ignored };
}
