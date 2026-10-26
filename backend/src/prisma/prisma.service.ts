import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required. Configure PostgreSQL before starting the API.');
  const url = new URL(value);
  url.searchParams.set('schema', 'osticket');
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({ datasources: { db: { url: databaseUrl() } } });
  }

  async onModuleInit() {
    await this.$connect();
    const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
    if (!email || !password) return;

    const existing = await this.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existing) return;

    const salt = randomBytes(16);
    const encoded = 'scrypt$' + salt.toString('base64url') + '$' + scryptSync(password, salt, 64).toString('base64url');
    const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator';
    const [firstname, ...lastname] = name.split(' ');
    await this.staff.create({
      data: {
        username: email.slice(0, 32),
        email,
        firstname,
        lastname: lastname.join(' '),
        passwd: encoded,
        backend: 'local',
        isadmin: 1,
        isactive: 1,
        extra: JSON.stringify({ authVersion: 0 }),
        created: new Date(),
        updated: new Date(),
      },
    });
    console.log('Created initial administrator account for ' + email);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
