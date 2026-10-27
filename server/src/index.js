import express from 'express';
import cors from 'cors';

import { config, assertProductionSafe } from './config/env.js';
import { pool } from './db/pool.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { resumeRouter } from './routes/resumes.js';
import { analysisRouter } from './routes/analyses.js';
import { suggestionRouter } from './routes/suggestions.js';
import { jobRouter } from './routes/jobs.js';
import { savedRouter } from './routes/saved.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Landing route. Opening the API port in a browser is a natural thing to try,
  // and a bare 404 there reads like the server is broken rather than like it is
  // an API with no UI at this address.
  app.get('/', (req, res) => {
    res.json({
      service: 'HiveFit API',
      note: 'This is the backend. The app interface runs separately — see uiHint.',
      uiHint: 'Run `npm run mobile`, then press w for web (usually http://localhost:8081).',
      health: '/api/health',
      endpoints: {
        '1.0 auth': ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me'],
        '2.0 resumes': ['POST /api/resumes', 'GET /api/resumes', 'GET /api/resumes/:id'],
        '2.0 analysis': ['POST /api/analyses', 'GET /api/analyses', 'GET /api/analyses/:id'],
        '3.0 suggestions': ['POST /api/suggestions', 'PATCH /api/suggestions/:id'],
        '4.0 jobs': ['GET /api/jobs/search', 'GET /api/jobs/:id'],
        '5.0 tracker': ['GET/POST /api/saved-jobs', 'PATCH/DELETE /api/saved-jobs/:id'],
      },
    });
  });

  app.get('/api/health', async (req, res) => {
    let database = 'down';
    try {
      await pool.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      jobsProvider: config.jobs.providers.join('+'),
      aiProvider: config.ai.provider,
    });
  });

  // The five DFD Level 1 processes.
  app.use('/api/auth', authRouter);          // 1.0 Authentication
  app.use('/api/resumes', resumeRouter);     // 2.0 Resume input and parsing
  app.use('/api/analyses', analysisRouter);  // 2.0 Analysis
  app.use('/api/suggestions', suggestionRouter); // 3.0 AI Recommendations
  app.use('/api/jobs', jobRouter);           // 4.0 Job Search
  app.use('/api/saved-jobs', savedRouter);   // 5.0 Application Tracker

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Start only when run directly, so tests can import createApp without binding
// a port.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  assertProductionSafe();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`HiveFit API listening on http://localhost:${config.port}`);
    console.log(`  jobs: ${config.jobs.providers.join('+')}   ai: ${config.ai.provider}   db: ${config.db.database}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
