import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyslogLogTypeEnum } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { ApiSecurityService } from '../common/api-security.service';

const CORE = 'core';

export interface SystemLogsFilterParams {
  type?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number | string;
  limit?: number | string;
}

export interface SerializedSyslog {
  id: string;
  type: 'Error' | 'Warning' | 'Debug';
  title: string;
  log: string;
  logger: string;
  ipAddress: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeType(type?: string): SyslogLogTypeEnum | null {
  if (!type || type.toLowerCase() === 'all') return null;
  const lower = type.toLowerCase();
  if (lower === 'error') return SyslogLogTypeEnum.ERROR;
  if (lower === 'warning' || lower === 'warn') return SyslogLogTypeEnum.WARNING;
  if (lower === 'debug') return SyslogLogTypeEnum.DEBUG;
  return null;
}

function formatType(type: SyslogLogTypeEnum): 'Error' | 'Warning' | 'Debug' {
  if (type === SyslogLogTypeEnum.ERROR) return 'Error';
  if (type === SyslogLogTypeEnum.WARNING) return 'Warning';
  return 'Debug';
}

@Injectable()
export class SystemLogsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ApiSecurityService) private readonly security: ApiSecurityService,
  ) {}

  /**
   * Validate that the current caller session belongs to an active staff administrator.
   * osTicket restricts System Logs exclusively to Administrators.
   */
  async checkAdminAuthorization(token?: string, throwOnUnauthorized = true) {
    if (!token) {
      if (throwOnUnauthorized) throw new ForbiddenException('Access denied: Authentication session required.');
      return {
        authorized: false,
        role: 'guest',
        isAdmin: false,
        username: '',
        email: '',
        deptId: '',
        canView: false,
        canDelete: false,
        canPurge: false,
        canConfigure: false,
        reason: 'Authentication session required.',
      };
    }
    const session = this.security.readSession(token);
    const account = session ? await this.auth.validateStaff(session.email) : null;
    if (!account || !this.auth.sessionAccount(account, session, 'staff')) {
      if (throwOnUnauthorized) throw new ForbiddenException('Access denied: Valid staff session required.');
      return {
        authorized: false,
        role: 'guest',
        isAdmin: false,
        username: '',
        email: '',
        deptId: '',
        canView: false,
        canDelete: false,
        canPurge: false,
        canConfigure: false,
        reason: 'Active staff session required.',
      };
    }
    const isAdmin = account.role === 'admin';
    if (!isAdmin) {
      // Log unauthorized attempt in syslog if possible
      try {
        await this.prisma.syslog.create({
          data: {
            log_type: SyslogLogTypeEnum.WARNING,
            title: `Unauthorized System Logs Access Attempt`,
            log: `Agent ${account.user.name} (${account.user.email}) attempted to access System Logs without Administrator role.`,
            logger: 'security.auth',
            ip_address: '127.0.0.1',
            created: new Date(),
            updated: new Date(),
          },
        });
      } catch {
        // ignore logging error
      }
      if (throwOnUnauthorized) {
        throw new ForbiddenException('Access denied: Administrator privileges required to access System Logs.');
      }
      return {
        authorized: false,
        role: account.role,
        isAdmin: false,
        username: account.user.name,
        email: account.user.email,
        deptId: account.user.deptId,
        canView: false,
        canDelete: false,
        canPurge: false,
        canConfigure: false,
        reason: 'Staff account has Agent role. Administrator status is required to access System Logs.',
      };
    }

    return {
      authorized: true,
      role: account.role,
      isAdmin: true,
      username: account.user.name,
      email: account.user.email,
      deptId: account.user.deptId,
      canView: true,
      canDelete: true,
      canPurge: true,
      canConfigure: true,
    };
  }

  /**
   * Ensure initial sample logs exist if the table is completely fresh.
   */
  private async ensureInitialLogs() {
    const count = await this.prisma.syslog.count();
    if (count > 0) return;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const threeHoursAgo = new Date(now.getTime() - 10800000);
    const oneDayAgo = new Date(now.getTime() - 86400000);

    await this.prisma.syslog.createMany({
      data: [
        {
          log_type: SyslogLogTypeEnum.DEBUG,
          title: 'System Startup: Database connection pool initialized',
          log: 'PostgreSQL connection established successfully. Connection pool capacity: 10 connections.\nosTicket compatibility schema verified.',
          logger: 'core.system',
          ip_address: '127.0.0.1',
          created: oneDayAgo,
          updated: oneDayAgo,
        },
        {
          log_type: SyslogLogTypeEnum.WARNING,
          title: 'Cron Job: Mail fetch task skipped due to idle status',
          log: 'Cron job #42 (mail_fetch) reported no incoming POP3/IMAP accounts configured in active polling mode.\nStatus: IDLE\nCheck Admin Panel > Emails for configuration.',
          logger: 'cron.mail',
          ip_address: '127.0.0.1',
          created: threeHoursAgo,
          updated: threeHoursAgo,
        },
        {
          log_type: SyslogLogTypeEnum.DEBUG,
          title: 'API Authentication: Token validation completed',
          log: 'Admin staff session verified. Permissions: Full Administrator Access.\nInterface: React Admin Panel\nEndpoint: /api/v1/dashboard/overview',
          logger: 'auth.api',
          ip_address: '127.0.0.1',
          created: oneHourAgo,
          updated: oneHourAgo,
        },
      ],
    });
  }

  /**
   * Retrieve list of logs with filtering, sorting, pagination, and system log configuration.
   */
  async listLogs(params: SystemLogsFilterParams) {
    await this.ensureInitialLogs();

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 25));
    const skip = (page - 1) * limit;

    const typeEnum = normalizeType(params.type);
    const where: any = {};

    if (typeEnum) {
      where.log_type = typeEnum;
    }

    if (params.startDate || params.endDate) {
      where.created = {};
      if (params.startDate) {
        const start = new Date(params.startDate);
        if (!isNaN(start.getTime())) {
          where.created.gte = start;
        }
      }
      if (params.endDate) {
        const end = new Date(params.endDate);
        if (!isNaN(end.getTime())) {
          // If date has no explicit time, default to end of that day
          if (params.endDate.length <= 10) {
            end.setHours(23, 59, 59, 999);
          }
          where.created.lte = end;
        }
      }
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { log: { contains: q, mode: 'insensitive' } },
        { ip_address: { contains: q, mode: 'insensitive' } },
        { logger: { contains: q, mode: 'insensitive' } },
      ];
    }

    const sortField = (params.sort || 'date').toLowerCase();
    const sortOrder = (params.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    let orderBy: any = { created: sortOrder };
    if (sortField === 'title') {
      orderBy = { title: sortOrder };
    } else if (sortField === 'type') {
      orderBy = { log_type: sortOrder };
    } else if (sortField === 'ip') {
      orderBy = { ip_address: sortOrder };
    } else if (sortField === 'id') {
      orderBy = { log_id: sortOrder };
    } else if (sortField === 'logger') {
      orderBy = { logger: sortOrder };
    }

    const [total, rows, countsGroup, configRows] = await Promise.all([
      this.prisma.syslog.count({ where }),
      this.prisma.syslog.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.syslog.groupBy({
        by: ['log_type'],
        _count: { _all: true },
      }),
      this.prisma.config.findMany({
        where: {
          namespace: CORE,
          key: { in: ['log_level', 'log_graceperiod', 'max_page_size'] },
        },
      }),
    ]);

    const counts = {
      total: 0,
      error: 0,
      warning: 0,
      debug: 0,
    };

    for (const group of countsGroup) {
      const count = group._count._all;
      counts.total += count;
      if (group.log_type === SyslogLogTypeEnum.ERROR) counts.error = count;
      if (group.log_type === SyslogLogTypeEnum.WARNING) counts.warning = count;
      if (group.log_type === SyslogLogTypeEnum.DEBUG) counts.debug = count;
    }

    const configMap = new Map(configRows.map(c => [c.key, c.value]));
    const rawLogLevel = configMap.get('log_level') || '2';
    const rawGrace = configMap.get('log_graceperiod') || '12';

    let logLevelText = 'warning';
    if (rawLogLevel === '0') logLevelText = 'none';
    else if (rawLogLevel === '1') logLevelText = 'error';
    else if (rawLogLevel === '3') logLevelText = 'debug';

    const logs: SerializedSyslog[] = rows.map(row => ({
      id: String(row.log_id),
      type: formatType(row.log_type),
      title: row.title,
      log: row.log,
      logger: row.logger,
      ipAddress: row.ip_address,
      createdAt: row.created.toISOString(),
      updatedAt: row.updated.toISOString(),
    }));

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      counts,
      config: {
        logLevel: logLevelText,
        logLevelRaw: rawLogLevel,
        logGracePeriodMonths: Number(rawGrace) || 0,
      },
    };
  }

  /**
   * Get single log details by ID.
   */
  async getLog(id: string) {
    const logId = BigInt(id);
    const row = await this.prisma.syslog.findUnique({
      where: { log_id: logId },
    });
    if (!row) {
      throw new NotFoundException(`System log entry #${id} not found.`);
    }

    return {
      id: String(row.log_id),
      type: formatType(row.log_type),
      title: row.title,
      log: row.log,
      logger: row.logger,
      ipAddress: row.ip_address,
      createdAt: row.created.toISOString(),
      updatedAt: row.updated.toISOString(),
    };
  }

  /**
   * Delete a single log entry.
   */
  async deleteLog(id: string) {
    const logId = BigInt(id);
    const existing = await this.prisma.syslog.findUnique({ where: { log_id: logId } });
    if (!existing) {
      throw new NotFoundException(`System log entry #${id} not found.`);
    }

    await this.prisma.syslog.delete({
      where: { log_id: logId },
    });

    return { success: true, id };
  }

  /**
   * Mass delete multiple log entries by IDs.
   */
  async massDelete(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('You must select at least one log entry to delete.');
    }

    const bigIntIds = ids.map(id => BigInt(id));
    const result = await this.prisma.syslog.deleteMany({
      where: {
        log_id: { in: bigIntIds },
      },
    });

    return {
      success: true,
      deleted: result.count,
      requested: ids.length,
    };
  }

  /**
   * Purge logs older than log_graceperiod months as configured in ost_config.
   */
  async purgeLogs() {
    const row = await this.prisma.config.findUnique({
      where: { namespace_key: { namespace: CORE, key: 'log_graceperiod' } },
    });
    const months = Number(row?.value ?? 12);
    if (months <= 0) {
      throw new BadRequestException('Log purging is disabled. Set a grace period in System Settings.');
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const result = await this.prisma.syslog.deleteMany({
      where: {
        created: { lt: cutoff },
      },
    });

    return {
      deleted: result.count,
      cutoff: cutoff.toISOString(),
      months,
    };
  }

  /**
   * Create a new system log entry (respects configured log level).
   */
  async createLog(input: {
    type: 'Error' | 'Warning' | 'Debug';
    title: string;
    log: string;
    logger?: string;
    ipAddress?: string;
  }) {
    const typeEnum = normalizeType(input.type) || SyslogLogTypeEnum.DEBUG;

    // Check system log level threshold
    const configRow = await this.prisma.config.findUnique({
      where: { namespace_key: { namespace: CORE, key: 'log_level' } },
    });
    const threshold = Number(configRow?.value ?? 2); // 0=none, 1=error, 2=warn, 3=debug

    const levelSeverity = {
      [SyslogLogTypeEnum.ERROR]: 1,
      [SyslogLogTypeEnum.WARNING]: 2,
      [SyslogLogTypeEnum.DEBUG]: 3,
    };

    if (threshold < levelSeverity[typeEnum]) {
      return { skipped: true, reason: 'Configured log level threshold filtered this event.' };
    }

    const created = await this.prisma.syslog.create({
      data: {
        log_type: typeEnum,
        title: input.title,
        log: input.log,
        logger: input.logger || 'system',
        ip_address: input.ipAddress || '127.0.0.1',
        created: new Date(),
        updated: new Date(),
      },
    });

    return {
      id: String(created.log_id),
      type: formatType(created.log_type),
      title: created.title,
    };
  }
}
