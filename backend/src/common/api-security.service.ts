import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { clearSessionCookieOptions, SESSION_COOKIE_NAME, sessionCookieOptions } from './session.constants';

export type AccountRole = 'client' | 'agent' | 'admin';
export type Session = {
  email: string;
  sessionVersion: number;
  expiresAt: number;
  role?: AccountRole;
  userId?: string;
  sessionId?: string;
};
type StoredSession = { email?: string; role?: AccountRole; userId?: string; sessionVersion?: number };

const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
const MAX_SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

function configNumber(value: unknown, fallback: number) {
  if (value === null || value === undefined) return fallback;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = value; }
  }
  const number = Number(parsed);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

@Injectable()
export class ApiSecurityService {
  private readonly attempts = new Map<string, { started: number; count: number }>();
  private readonly secret = process.env.HELPDESK_API_TOKEN || '';
  private readonly ttlCache = new Map<string, { value: number; expiresAt: number }>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  clean(value: unknown, max = 10000) { return String(value ?? '').trim().slice(0, max); }
  email(value: unknown) { return this.clean(value, 254).toLowerCase(); }
  validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
  mask(value: string) { const at = value.indexOf('@'); return at > 0 ? value[0] + '***' + value.slice(at) : value.length > 2 ? value[0] + '***' + value.slice(-1) : '***'; }

  rateLimit(ip: string, key: string, limit: number) {
    const now = Date.now(), bucketKey = key + ':' + (ip || 'unknown');
    const bucket = this.attempts.get(bucketKey) || { started: now, count: 0 };
    if (now - bucket.started > 60000) { bucket.started = now; bucket.count = 0; }
    bucket.count += 1; this.attempts.set(bucketKey, bucket);
    return bucket.count <= limit;
  }

  authorized(given: unknown) {
    const a = Buffer.from(String(given || '')), b = Buffer.from(this.secret);
    return Boolean(this.secret) && a.length === b.length && timingSafeEqual(a, b);
  }

  /** SHA-256 is sufficient here: the token has 256 bits of entropy and is never stored. */
  private sessionId(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sessionTimeoutMs(role?: AccountRole) {
    const key = role === 'agent' || role === 'admin' ? 'staff_session_timeout' : 'client_session_timeout';
    const cached = this.ttlCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const row = await this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'core', key } } }).catch(() => null);
    const minutes = configNumber(row?.value, DEFAULT_SESSION_TIMEOUT_MINUTES);
    const value = Math.min(minutes * 60_000, MAX_SESSION_TIMEOUT_MS);
    this.ttlCache.set(key, { value, expiresAt: Date.now() + 60_000 });
    return value;
  }

  /**
   * Creates a server-side session. Returns the opaque token for the HTTP-only
   * cookie; only its hash is persisted in ost_session.
   */
  async issueSession(
    input: { email: string; role: AccountRole; userId: string | number; sessionVersion?: number },
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const token = randomBytes(32).toString('base64url');
    const id = this.sessionId(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + await this.sessionTimeoutMs(input.role));
    const data: StoredSession = {
      email: input.email.toLowerCase(),
      role: input.role,
      userId: String(input.userId),
      sessionVersion: Number(input.sessionVersion || 0),
    };
    await this.prisma.session.create({
      data: {
        session_id: id,
        session_data: JSON.stringify(data),
        session_expire: expiresAt,
        session_updated: now,
        user_id: String(input.userId).slice(0, 16),
        user_ip: String(meta.ip || '').slice(0, 64),
        user_agent: String(meta.userAgent || '').slice(0, 255),
      },
    });
    void this.purgeExpiredSessions().catch(() => undefined);
    return { token, expiresAt };
  }

  /**
   * Resolves an opaque cookie/header token against the session store. Expired
   * sessions are removed; active sessions get a sliding idle expiration.
   */
  async readSession(token: unknown): Promise<Session | null> {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const id = this.sessionId(raw);
    const row = await this.prisma.session.findUnique({ where: { session_id: id } });
    if (!row || row.revoked_at) return null;

    const now = new Date();
    if (!row.session_expire || row.session_expire.getTime() <= now.getTime()) {
      await this.prisma.session.delete({ where: { session_id: id } }).catch(() => undefined);
      return null;
    }
    const currentExpire = row.session_expire;

    let data: StoredSession;
    try { data = JSON.parse(row.session_data || '{}') as StoredSession; } catch { return null; }
    if (!data.email || !this.validEmail(data.email)) return null;

    const timeoutMs = await this.sessionTimeoutMs(data.role);
    const nextExpire = new Date(now.getTime() + timeoutMs);
    // Sliding expiration: update at most once per minute to avoid a write on
    // every request while keeping active sessions alive.
    const shouldSlide = !row.session_updated || now.getTime() - row.session_updated.getTime() > 60_000;
    if (shouldSlide) {
      await this.prisma.session.update({
        where: { session_id: id },
        data: { session_expire: nextExpire, session_updated: now },
      }).catch(() => undefined);
    }

    return {
      email: data.email.toLowerCase(),
      sessionVersion: Number(data.sessionVersion || 0),
      expiresAt: (shouldSlide ? nextExpire : currentExpire).getTime(),
      role: data.role,
      userId: data.userId,
      sessionId: id,
    };
  }

  /** Marks a single session revoked (logout). Safe to call for unknown tokens. */
  async revokeSession(token: unknown) {
    const raw = String(token || '').trim();
    if (!raw) return;
    await this.prisma.session.updateMany({
      where: { session_id: this.sessionId(raw), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  /** Revokes every live session belonging to an account (password change/reset). */
  async revokeAllForEmail(email: string) {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return;
    const rows = await this.prisma.session.findMany({
      where: { revoked_at: null, session_data: { contains: '"email":"' + needle + '"' } },
      select: { session_id: true },
    });
    if (!rows.length) return;
    await this.prisma.session.updateMany({
      where: { session_id: { in: rows.map((row) => row.session_id) } },
      data: { revoked_at: new Date() },
    });
  }

  /** Removes expired sessions and revoked rows that are past their retention. */
  async purgeExpiredSessions() {
    const now = new Date();
    const revokedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.session.deleteMany({
      where: { OR: [{ session_expire: { lt: now } }, { revoked_at: { lt: revokedCutoff } }] },
    });
  }

  setSessionCookie(res: any, token: string, expiresAt?: Date) {
    if (!res?.cookie) return;
    // Keep the browser cookie lifetime in step with the server-side session so
    // an idle client does not keep sending a token that is already expired.
    const maxAge = expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : undefined;
    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(maxAge));
  }

  clearSessionCookie(res: any) {
    if (res?.clearCookie) res.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions());
  }

  jsonSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as T;
  }
}
