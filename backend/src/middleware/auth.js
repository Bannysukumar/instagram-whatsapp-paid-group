import crypto from 'node:crypto';
import { HttpError } from '../httpError.js';

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function signToken({ username, secret, ttlHours }) {
  const body = Buffer.from(JSON.stringify({
    sub: username,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function passwordsMatch(input, expected) {
  const actual = crypto.createHash('sha256').update(String(input)).digest();
  const stored = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(actual, stored);
}

export function requireAdmin(config) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = verifyToken(token, config.tokenSecret);
    if (!payload || payload.sub !== config.adminUsername) {
      return next(new HttpError(401, 'unauthorized', 'Administrator sign-in is required.'));
    }
    req.admin = payload;
    return next();
  };
}
