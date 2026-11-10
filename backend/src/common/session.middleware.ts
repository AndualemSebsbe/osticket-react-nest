import { Injectable, NestMiddleware } from '@nestjs/common';
import { SESSION_COOKIE_NAME, sessionCookieOptions, sessionTokenFromCookieHeader } from './session.constants';

/**
 * Promotes the HTTP-only session cookie into the x-user-session header used by
 * the existing controllers. A cookie always wins over a caller-supplied header
 * so a stale/forged header cannot override a valid browser session.
 *
 * The token is still verified against ost_session by ApiSecurityService on the
 * first authenticated access; this middleware only normalizes request input.
 */
export function sessionCookieMiddleware(req: any, res: any, next: () => void) {
  const cookieToken = sessionTokenFromCookieHeader(req.headers?.cookie);
  if (cookieToken) {
    req.headers['x-user-session'] = cookieToken;
    req.sessionToken = cookieToken;
    // Keep the browser cookie alive while the client is active. The server-side
    // idle timeout in ost_session is the authority on expiration; without this
    // refresh the cookie would expire on the original login lifetime even
    // though readSession() keeps sliding the stored session forward.
    if (res?.cookie) res.cookie(SESSION_COOKIE_NAME, cookieToken, sessionCookieOptions());
  }
  next();
}

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    sessionCookieMiddleware(req, res, next);
  }
}
