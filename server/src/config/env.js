import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../../../.env') });

/** Parse a comma-separated env var into a lowercase list. */
function list(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

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
    // Comma-separated, in priority order: "adzuna,muse". A single name
    // still works, so an existing .env keeps running unchanged.
    providers: list(process.env.JOBS_PROVIDER ?? 'fixtures'),

    // How long a posting survives without being returned by a sweep before it
    // is treated as delisted. A week is deliberately generous: boards drop and
    // re-list the same posting, and a short TTL would churn the pool with
    // postings that never actually went away.
    ttlHours: Number(process.env.JOBS_TTL_HOURS ?? 168),

    // How many listings each refresh fetches to confirm they are still there.
    // Bounded because this is one HTTP request per listing against someone
    // else's site; the pool is worked through round-robin across runs.
    verifyLimit: Number(process.env.JOBS_VERIFY_LIMIT ?? 40),

    // What `npm run jobs:refresh` sweeps for when given no arguments.
    refreshQueries: list(
      process.env.JOBS_REFRESH_QUERIES
      ?? 'software engineer,data analyst,machine learning,devops,full stack developer'
    ),

    adzuna: {
      appId: process.env.ADZUNA_APP_ID ?? '',
      appKey: process.env.ADZUNA_APP_KEY ?? '',
      country: process.env.ADZUNA_COUNTRY ?? 'us',
    },
    // Company career boards hosted on Greenhouse, by board token. Public,
    // documented, unauthenticated — adding a company is a .env change.
    greenhouseBoards: list(
      process.env.GREENHOUSE_BOARDS
      ?? 'stripe,databricks,discord,reddit,figma'
    ),

    // The Muse works with no key at all; a key only raises the rate limit.
    muse: {
      apiKey: process.env.MUSE_API_KEY ?? '',
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
