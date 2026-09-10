// Small request-validation helpers. Deliberately dependency-free: the shapes
// here are simple enough that a schema library would be more machinery than
// the project needs.

import { badRequest } from '../middleware/error.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body?.[f];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length > 0) {
    throw badRequest(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }
}

export function validEmail(email) {
  if (!EMAIL.test(String(email ?? '').trim())) throw badRequest('That does not look like a valid email address');
  return String(email).trim().toLowerCase();
}

export function validPassword(password) {
  const p = String(password ?? '');
  if (p.length < 8) throw badRequest('Password must be at least 8 characters');
  if (p.length > 200) throw badRequest('Password must be under 200 characters');
  return p;
}

/** Parse a positive integer path/query parameter. */
export function intParam(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${name} must be a positive integer`);
  return n;
}

export function optionalString(value, name, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s.length > maxLength) throw badRequest(`${name} must be under ${maxLength} characters`);
  return s || null;
}
