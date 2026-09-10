import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../../../.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'hivefit',
  },

  auth: {
    // Dev-only fallback so `npm run dev` works before .env exists. Production
    // start-up refuses to boot without a real secret (see assertProductionSafe).
    jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  jobs: {
    provider: process.env.JOBS_PROVIDER ?? 'fixtures',
    adzuna: {
      appId: process.env.ADZUNA_APP_ID ?? '',
      appKey: process.env.ADZUNA_APP_KEY ?? '',
      country: process.env.ADZUNA_COUNTRY ?? 'us',
    },
  },

  ai: {
    provider: process.env.AI_PROVIDER ?? 'heuristic',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
  },
};

/** Refuse to run in production with development placeholders still in place. */
export function assertProductionSafe() {
  if (config.nodeEnv !== 'production') return;
  if (config.auth.jwtSecret === 'dev-only-insecure-secret') {
    throw new Error('JWT_SECRET must be set to a real secret in production');
  }
  required('DB_PASSWORD', undefined);
}
