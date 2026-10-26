import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type AccountRole = 'client' | 'agent' | 'admin';
export type Session = { email: string; sessionVersion: number; expiresAt: number };

@Injectable()
export class ApiSecurityService {
  private readonly attempts = new Map<string, { started: number; count: number }>();
  private readonly secret = process.env.HELPDESK_API_TOKEN || '';

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

  issueSession(email: string, sessionVersion = 0) {
    if (!this.secret) return '';
    const payload = Buffer.from(JSON.stringify({ email, sessionVersion, expiresAt: Date.now() + 30 * 86400000 })).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return payload + '.' + signature;
  }

  readSession(token: unknown): Session | null {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature || !this.secret) return null;
    const expected = Buffer.from(createHmac('sha256', this.secret).update(payload).digest('base64url'));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
      return session.expiresAt > Date.now() && this.validEmail(session.email) ? session : null;
    } catch { return null; }
  }

  jsonSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)) as T;
  }
}
