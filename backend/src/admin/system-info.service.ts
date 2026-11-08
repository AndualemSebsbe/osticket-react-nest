import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { arch, freemem, hostname, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

const CORE = 'core';
const FILE_CHUNK_TABLE = 'ost_file_chunk';
const CONFIG_KEYS = [
  'schema_signature',
  'db_timezone',
  'default_timezone',
  'default_storage_bk',
  'force_https',
  'system_language',
  'secondary_langs',
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

type DatabaseMetaRow = {
  database: string;
  schema: string;
  username: string;
  timezone: string;
  version: string;
};

type SizeRow = {
  total_bytes: bigint | null;
  data_bytes: bigint | null;
  index_bytes: bigint | null;
};

type TableRow = {
  table_name: string;
  total_bytes: bigint | null;
  data_bytes: bigint | null;
  index_bytes: bigint | null;
  row_estimate: bigint | null;
};

type CountRow = { count: bigint | null };
type SignatureRow = { signature: string | null };

function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function truthy(value?: string) {
  return ['1', 'on', 'true', 'yes', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

function parseVersion(version: string) {
  const match = version.match(/PostgreSQL\s+([0-9]+(?:\.[0-9]+)*)/i);
  return match ? match[1] : version.split(/\s+/)[0] || 'unknown';
}

function packageInfo(): { name?: string; version?: string } {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { name?: string; version?: string };
  } catch {
    return {};
  }
}

function databaseEndpoint() {
  const raw = process.env.DATABASE_URL || '';
  try {
    const url = new URL(raw);
    return {
      host: url.hostname || '',
      port: url.port || '5432',
      username: decodeURIComponent(url.username || ''),
    };
  } catch {
    return { host: '', port: '', username: '' };
  }
}

@Injectable()
export class SystemInfoService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Read-only System Information module (Admin Panel > Dashboard > Information).
   *
   * Everything is collected live at request time from the process environment,
   * PostgreSQL catalogs, information_schema.TABLES and ost_config. No new
   * database tables or duplicated metadata records are created.
   */
  async getInformation() {
    const metaRows = await this.prisma.$queryRaw<DatabaseMetaRow[]>(Prisma.sql`
      SELECT
        current_database() AS database,
        current_schema() AS schema,
        current_user AS username,
        current_setting('TimeZone') AS timezone,
        version() AS version
    `);
    const meta = metaRows[0] || {
      database: '',
      schema: 'public',
      username: '',
      timezone: 'UTC',
      version: '',
    };

    const [configRows, sizeRows, tableRows, tableCountRows, attachmentRows, chunkRows, computedSignatureRows] =
      await Promise.all([
        this.prisma.config.findMany({
          where: { namespace: CORE, key: { in: [...CONFIG_KEYS] } },
          select: { key: true, value: true },
        }),
        this.prisma.$queryRaw<SizeRow[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(pg_total_relation_size(quote_ident(n.nspname) || '.' || quote_ident(c.relname))), 0) AS total_bytes,
            COALESCE(SUM(pg_table_size(quote_ident(n.nspname) || '.' || quote_ident(c.relname))), 0) AS data_bytes,
            COALESCE(SUM(pg_indexes_size(quote_ident(n.nspname) || '.' || quote_ident(c.relname))), 0) AS index_bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${meta.schema}
            AND c.relkind IN ('r', 'm')
        `),
        this.prisma.$queryRaw<TableRow[]>(Prisma.sql`
          SELECT
            t.table_name,
            pg_total_relation_size(format('%I.%I', t.table_schema, t.table_name)::regclass) AS total_bytes,
            pg_table_size(format('%I.%I', t.table_schema, t.table_name)::regclass) AS data_bytes,
            pg_indexes_size(format('%I.%I', t.table_schema, t.table_name)::regclass) AS index_bytes,
            GREATEST(c.reltuples, 0)::bigint AS row_estimate
          FROM information_schema.tables t
          JOIN pg_namespace n ON n.nspname = t.table_schema
          JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
          WHERE t.table_schema = ${meta.schema}
            AND t.table_type = 'BASE TABLE'
          ORDER BY total_bytes DESC, t.table_name ASC
        `),
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT count(*)::bigint AS count
          FROM information_schema.tables
          WHERE table_schema = ${meta.schema}
            AND table_type = 'BASE TABLE'
        `),
        this.prisma.$queryRaw<SizeRow[]>(Prisma.sql`
          SELECT
            COALESCE(pg_total_relation_size(to_regclass(format('%I.%I', ${meta.schema}, ${FILE_CHUNK_TABLE}))), 0) AS total_bytes,
            COALESCE(pg_table_size(to_regclass(format('%I.%I', ${meta.schema}, ${FILE_CHUNK_TABLE}))), 0) AS data_bytes,
            COALESCE(pg_indexes_size(to_regclass(format('%I.%I', ${meta.schema}, ${FILE_CHUNK_TABLE}))), 0) AS index_bytes
        `),
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT count(*)::bigint AS count FROM ost_file_chunk
        `),
        this.prisma.$queryRaw<SignatureRow[]>(Prisma.sql`
          SELECT md5(string_agg(
            table_name || '.' || column_name || ':' || data_type,
            '|' ORDER BY table_name, ordinal_position
          )) AS signature
          FROM information_schema.columns
          WHERE table_schema = ${meta.schema}
        `),
      ]);

    const config = new Map<ConfigKey, string>();
    for (const row of configRows) {
      if ((CONFIG_KEYS as readonly string[]).includes(row.key)) {
        config.set(row.key as ConfigKey, row.value);
      }
    }

    const storedTimezone = config.get('db_timezone') || null;
    const storedSignature = config.get('schema_signature') || null;
    const computedSignature = computedSignatureRows[0]?.signature || null;
    const sizes = sizeRows[0];
    const attachment = attachmentRows[0];
    const pkg = packageInfo();
    const endpoint = databaseEndpoint();
    const storageBackend = config.get('default_storage_bk') || 'D';
    const defaultTimezone = config.get('default_timezone') || '';
    const forceHttps = truthy(config.get('force_https'));
    const primaryLanguage = config.get('system_language') || 'en_US';
    const secondaryLanguages = (config.get('secondary_langs') || '')
      .split(',')
      .map((language) => language.trim())
      .filter(Boolean);
    const memory = process.memoryUsage();
    const timezoneMatches = !storedTimezone || storedTimezone === meta.timezone;

    const checks: Array<{ key: string; label: string; status: 'ok' | 'warning'; detail: string }> = [
      {
        key: 'database',
        label: 'Database connectivity',
        status: meta.version ? 'ok' : 'warning',
        detail: meta.version ? `Connected to PostgreSQL ${parseVersion(meta.version)}` : 'Database version could not be determined.',
      },
      {
        key: 'timezone',
        label: 'Database timezone',
        status: timezoneMatches ? 'ok' : 'warning',
        detail: storedTimezone
          ? timezoneMatches
            ? `Session and stored timezone both report ${meta.timezone}.`
            : `Session reports ${meta.timezone}; ost_config stores ${storedTimezone}.`
          : `Session reports ${meta.timezone}; no stored timezone is recorded in ost_config.`,
      },
      {
        key: 'schema_signature',
        label: 'Schema signature',
        status: storedSignature ? 'ok' : 'warning',
        detail: storedSignature
          ? `Recorded in ost_config (core.schema_signature).`
          : 'No schema signature is recorded in ost_config; a live signature was computed from information_schema.',
      },
      {
        key: 'attachments',
        label: 'Attachment storage',
        status: storageBackend === 'D' ? 'ok' : 'warning',
        detail:
          storageBackend === 'D'
            ? `Database-backed storage using ${FILE_CHUNK_TABLE}.`
            : `Configured backend "${storageBackend}" does not use ${FILE_CHUNK_TABLE}; attachment usage may be reported by an external plugin.`,
      },
      {
        key: 'timezone_setting',
        label: 'Default timezone',
        status: defaultTimezone ? 'ok' : 'warning',
        detail: defaultTimezone ? `Default timezone is set to ${defaultTimezone}.` : 'No default timezone is configured in ost_config.',
      },
      {
        key: 'https',
        label: 'HTTPS enforcement',
        status: forceHttps ? 'ok' : 'warning',
        detail: forceHttps ? 'Force HTTPS is enabled.' : 'Force HTTPS is disabled; enable it for production installations.',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      application: {
        name: process.env.APP_NAME || 'IT Ticket Management System',
        packageName: pkg.name || 'osticket-react-nest',
        version: pkg.version || process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        runtime: `Node.js ${process.version}`,
        platform: `${platform()} ${release()}`,
        architecture: arch(),
        hostname: hostname(),
        serverTime: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          hostTotal: totalmem(),
          hostFree: freemem(),
        },
      },
      database: {
        engine: 'PostgreSQL',
        version: meta.version,
        versionShort: parseVersion(meta.version),
        host: endpoint.host,
        port: endpoint.port,
        username: endpoint.username || meta.username,
        database: meta.database,
        schema: meta.schema,
        timezone: meta.timezone,
        storedTimezone,
        timezoneSource: storedTimezone ? 'config' : 'server',
        schemaSignature: storedSignature || computedSignature,
        schemaSignatureSource: storedSignature ? 'config' : 'computed',
        totalBytes: toNumber(sizes?.total_bytes),
        dataBytes: toNumber(sizes?.data_bytes),
        indexBytes: toNumber(sizes?.index_bytes),
        tableCount: toNumber(tableCountRows[0]?.count),
        attachment: {
          table: FILE_CHUNK_TABLE,
          totalBytes: toNumber(attachment?.total_bytes),
          dataBytes: toNumber(attachment?.data_bytes),
          indexBytes: toNumber(attachment?.index_bytes),
          chunks: toNumber(chunkRows[0]?.count),
          storageBackend,
        },
      },
      tables: tableRows.map((row) => ({
        name: row.table_name,
        totalBytes: toNumber(row.total_bytes),
        dataBytes: toNumber(row.data_bytes),
        indexBytes: toNumber(row.index_bytes),
        rowEstimate: toNumber(row.row_estimate),
      })),
      checks,
      languages: {
        primary: primaryLanguage,
        secondary: secondaryLanguages,
      },
    };
  }
}

export type SystemInformation = Awaited<ReturnType<SystemInfoService['getInformation']>>;
