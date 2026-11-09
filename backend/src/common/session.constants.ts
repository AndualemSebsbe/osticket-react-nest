/**
 * Shared session cookie helpers.
 *
 * The browser only ever sees an opaque, high-entropy token. The database
 * stores its SHA-256 hash, so a leaked session table cannot be replayed.
 */
export const SESSION_COOKIE_NAME = (process.env.SESSION_COOKIE_NAME || 'OSTSESSID').trim() || 'OSTSESSID';

const DEFAULT_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cookieMaxAgeMs() {
  const configured = Number(process.env.SESSION_COOKIE_MAX_AGE_MS || '');
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COOKIE_MAX_AGE_MS;
}

export function sessionCookieOptions(maxAgeMs = cookieMaxAgeMs()) {
  const sameSite = String(process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();
  return {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: (sameSite === 'strict' || sameSite === 'none' ? sameSite : 'lax') as 'strict' | 'lax' | 'none',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function clearSessionCookieOptions() {
  const options = sessionCookieOptions();
  return { httpOnly: options.httpOnly, secure: options.secure, sameSite: options.sameSite, path: options.path };
}

export function parseCookieHeader(header: unknown): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    let value = part.slice(separator + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    cookies[name] = value;
  }
  return cookies;
}

export function sessionTokenFromCookieHeader(header: unknown) {
  return parseCookieHeader(header)[SESSION_COOKIE_NAME] || '';
}
