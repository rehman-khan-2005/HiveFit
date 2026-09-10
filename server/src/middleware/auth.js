// Process 1.0 — User Authentication.
//
// Credentials are validated against the database, a signed token is issued,
// and protected routes attach the resolved user to the request.

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { unauthorized } from './error.js';

const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.auth.jwtSecret,
    { expiresIn: config.auth.expiresIn }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    // Expired, malformed, and wrong-signature all mean the same thing to a
    // caller: this token is not usable. Distinguishing them leaks information.
    throw unauthorized('Session expired or invalid. Please sign in again.');
  }
}

/** Require a valid bearer token; attaches req.user = { id, email }. */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(unauthorized('Missing bearer token'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    return next(err);
  }
}
