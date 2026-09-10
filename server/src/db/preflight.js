// Turns the most common local-setup failures into an instruction rather than
// a raw driver error. "Access denied ... (using password: NO)" does not tell a
// first-time user that DB_PASSWORD is blank in .env.

import { config } from '../config/env.js';

export function explainDbError(err) {
  const code = err?.code ?? '';
  const usingPassword = config.db.password !== '';

  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
    if (!usingPassword) {
      return [
        `MySQL rejected user "${config.db.user}" and no password was sent.`,
        '',
        'DB_PASSWORD is empty in your .env. Set it to your local MySQL password:',
        '',
        '    DB_PASSWORD=your-mysql-password',
        '',
        'If you do not know it, see the "Database setup" section of README.md.',
      ].join('\n');
    }
    return [
      `MySQL rejected user "${config.db.user}" with the password in .env.`,
      '',
      'Check DB_USER and DB_PASSWORD. Verify the same values work directly:',
      `    mysql -u ${config.db.user} -p`,
    ].join('\n');
  }

  if (code === 'ECONNREFUSED') {
    return [
      `Nothing is listening on ${config.db.host}:${config.db.port}.`,
      '',
      'Start MySQL, then try again:',
      '    brew services start mysql',
    ].join('\n');
  }

  if (code === 'ER_BAD_DB_ERROR') {
    return [
      `Database "${config.db.database}" does not exist.`,
      '',
      'Create it and apply the schema first:',
      '    npm run db:setup',
    ].join('\n');
  }

  return err?.message ?? String(err);
}
