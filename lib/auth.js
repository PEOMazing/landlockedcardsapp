// lib/auth.js - Magic link auth using JWT + Resend email
import jwt from 'jsonwebtoken';

// Refuse to run in production without a real secret. The old fallback string
// meant a missing env var silently signed every session with a value anyone
// could read in the repo. Resolved lazily (not at import) so `next build`
// doesn't need the env var — only actual sign/verify calls do.
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'dev-only-secret-not-for-production';
}

// Token types: 'magic' (one-time login link, 15 min) or 'session' (logged-in session, 30 days)

export function signMagicToken(email) {
  return jwt.sign({ email, type: 'magic' }, getSecret(), { expiresIn: '15m' });
}

export function signSessionToken(payload) {
  return jwt.sign({ ...payload, type: 'session' }, getSecret(), { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch (err) {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `peolens_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'peolens_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}

export function getSessionFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [key, ...v] = c.trim().split('=');
      return [key, v.join('=')];
    })
  );
  const token = cookies.peolens_session;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'session') return null;
  return payload;
}
