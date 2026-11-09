import { Injectable, NestMiddleware } from '@nestjs/common';
import { sessionTokenFromCookieHeader } from './session.constants';

/**
 * Promotes the HTTP-only session cookie into the x-user-session header used by
 * the existing controllers. A cookie always wins over a caller-supplied header
 * so a stale/forged header cannot override a valid browser session.
 *
 * The token is still verified against ost_session by ApiSecurityService on the
 * first authenticated access; this middleware only normalizes request input.
 */
export function sessionCookieMiddleware(req: any, _res: any, next: () => void) {
  const cookieToken = sessionTokenFromCookieHeader(req.headers?.cookie);
  if (cookieToken) {
    req.headers['x-user-session'] = cookieToken;
    req.sessionToken = cookieToken;
  }
  next();
}

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    sessionCookieMiddleware(req, res, next);
  }
}
