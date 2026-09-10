// Central error handling. Routes throw errors carrying a `status`; anything
// without one is an unexpected fault and becomes a 500 with the detail logged
// but not returned.

import { config } from '../config/env.js';

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `No route for ${req.method} ${req.originalUrl}`,
    hint: 'This server only serves /api/* routes. Open / for the endpoint list.',
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifies the error
// handler by arity; `next` must stay in the signature.
export function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err?.status) ? err.status : 500;

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }

  const body = {
    error: status >= 500 && config.nodeEnv === 'production'
      ? 'Internal server error'
      : err.message ?? 'Internal server error',
  };
  if (err.details) body.details = err.details;
  if (status >= 500 && config.nodeEnv !== 'production' && err.stack) body.stack = err.stack;

  res.status(status).json(body);
}
