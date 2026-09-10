// Process 1.0 — User Authentication.

import { Router } from 'express';
import { query, execute } from '../db/pool.js';
import { hashPassword, verifyPassword, issueToken, requireAuth } from '../middleware/auth.js';
import { asyncRoute, conflict, unauthorized } from '../middleware/error.js';
import { requireFields, validEmail, validPassword, optionalString } from '../utils/validate.js';

export const authRouter = Router();

authRouter.post('/register', asyncRoute(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const email = validEmail(req.body.email);
  const password = validPassword(req.body.password);
  const fullName = optionalString(req.body.fullName, 'fullName', 120);

  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) throw conflict('An account with that email already exists');

  const passwordHash = await hashPassword(password);
  const result = await execute(
    'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
    [email, passwordHash, fullName]
  );

  const user = { id: result.insertId, email, fullName };
  res.status(201).json({ user, token: issueToken({ id: user.id, email }) });
}));

authRouter.post('/login', asyncRoute(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const email = validEmail(req.body.email);

  const rows = await query(
    'SELECT id, email, password_hash, full_name FROM users WHERE email = ?', [email]
  );
  const account = rows[0];

  // Same message and roughly the same work whether the account exists or the
  // password is wrong, so the response cannot be used to enumerate accounts.
  const ok = account
    ? await verifyPassword(req.body.password, account.password_hash)
    : await verifyPassword(req.body.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');

  if (!account || !ok) throw unauthorized('Incorrect email or password');

  res.json({
    user: { id: account.id, email: account.email, fullName: account.full_name },
    token: issueToken({ id: account.id, email: account.email }),
  });
}));

authRouter.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const rows = await query(
    'SELECT id, email, full_name, created_at FROM users WHERE id = ?', [req.user.id]
  );
  if (rows.length === 0) throw unauthorized('Account no longer exists');
  const u = rows[0];
  res.json({ user: { id: u.id, email: u.email, fullName: u.full_name, createdAt: u.created_at } });
}));
