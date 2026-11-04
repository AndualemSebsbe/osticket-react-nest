import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { PrismaService } from '../prisma/prisma.service';

const CORE = 'core';
const CORE_KEYS = [
  'isonline',
  'helpdesk_url',
  'helpdesk_title',
  'default_dept_id',
  'force_https',
  'autolock_minutes',
  'max_page_size',
  'log_level',
  'log_graceperiod',
  'enable_avatars',
  'enable_richtext',
  'allow_iframes',
  'embedded_domain_whitelist',
  'acl',
  'acl_backend',
  'default_locale',
  'default_timezone',
  'date_formats',
  'time_format',
  'date_format',
  'datetime_format',
  'daydatetime_format',
  'schedule_id',
  'default_schedule',
  'system_language',
  'secondary_langs',
  'default_storage_bk',
  'max_file_size',
  'files_req_auth',
] as const;

type CoreKey = (typeof CORE_KEYS)[number];

const PAGE_SIZES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const LOG_LEVELS = [
  { value: 'none', label: 'None (disable logging)', number: 0 },
  { value: 'debug', label: 'Debug (all events)', number: 3 },
  { value: 'warning', label: 'Warning (warnings and errors)', number: 2 },
  { value: 'error', label: 'Error (errors only)', number: 1 },
];
const LOG_GRACE_PERIODS = Array.from({ length: 13 }, (_, months) => ({
  value: months,
  label: months === 0 ? 'Never purge logs' : months === 1 ? 'After 1 month' : `After ${months} months`,
}));
const ACL_BACKENDS = [
  { value: '0', label: 'Disabled' },
  { value: '1', label: 'All' },
  { value: '2', label: 'Client Portal' },
  { value: '3', label: 'Staff Panel' },
];
const STORAGE_BACKENDS = [{ value: 'D', label: 'Database (ost_file / ost_file_chunk)' }];
const MAX_FILE_SIZES = [
  { value: 262144, label: '256 KB' },
  { value: 524288, label: '512 KB' },
  { value: 1048576, label: '1 MB' },
  { value: 2097152, label: '2 MB' },
  { value: 5242880, label: '5 MB' },
  { value: 10485760, label: '10 MB' },
  { value: 20971520, label: '20 MB' },
];
const LANGUAGE_CODES = [
  'en_US', 'en_GB', 'en_CA', 'en_AU', 'es_ES', 'es_MX', 'fr_FR', 'fr_CA', 'de_DE', 'it_IT',
  'pt_BR', 'pt_PT', 'nl_NL', 'ru_RU', 'pl_PL', 'tr_TR', 'ar_SA', 'he_IL', 'hi_IN', 'ja_JP',
  'ko_KR', 'zh_CN', 'zh_TW', 'th_TH', 'vi_VN', 'id_ID', 'uk_UA', 'cs_CZ', 'sv_SE', 'da_DK',
  'fi_FI', 'nb_NO', 'el_GR', 'hu_HU', 'ro_RO', 'bg_BG', 'sk_SK', 'sl_SI', 'hr_HR', 'sr_RS',
];
const DEFAULT_EMBEDDED_DOMAINS = 'youtube.com, dailymotion.com, vimeo.com, player.vimeo.com, web.microsoftstream.com';
const DEFAULT_HELPDESK_URL = 'http://localhost:5173';

function stringValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

function boolValue(value: unknown, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'on', 'true', 'yes', 'enabled'].includes(normalized);
}

function intValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function legacyLogLevel(value: unknown) {
  switch (String(value || '').toLowerCase()) {
    case 'debug': return '3';
    case 'info': return '3';
    case 'warning': return '2';
    case 'error': return '1';
    case 'none': return '0';
    default: return '';
  }
}

function logLevelText(value: unknown) {
  switch (intValue(value, 2)) {
    case 0: return 'none';
    case 3: return 'debug';
    case 1: return 'error';
    default: return 'warning';
  }
}

function logLevelNumber(value: unknown) {
  const found = LOG_LEVELS.find((level) => level.value === String(value || '').toLowerCase());
  return found ? found.number : 2;
}

function languageLabel(code: string) {
  const [language, region] = code.split('_');
  try {
    const languages = new Intl.DisplayNames(['en'], { type: 'language' });
    const regions = new Intl.DisplayNames(['en'], { type: 'region' });
    const languageName = languages.of(language) || language;
    const regionName = region ? regions.of(region) : '';
    return regionName ? `${languageName} (${regionName})` : languageName;
  } catch {
    return code;
  }
}

function timezoneOptions() {
  let zones: string[] = [];
  try {
    zones = typeof (Intl as any).supportedValuesOf === 'function' ? (Intl as any).supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  if (!zones.length) {
    zones = [
      'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
      'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
      'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
    ];
  }
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
}

function validateUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('Enter a valid Helpdesk URL, including http:// or https://.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('The Helpdesk URL must use http:// or https://.');
  }
  return value;
}

function validateIframeSources(value: string) {
  if (!value.trim()) return '';
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (/[\s;]/.test(entry)) throw new BadRequestException(`The iFrame source "${entry}" is not valid.`);
  }
  return entries.join(', ');
}

function validateDomains(value: string) {
  if (!value.trim()) return '';
  const entries = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  for (const entry of entries) {
    if (entry.includes('://') || entry.startsWith('www.')) {
      throw new BadRequestException('Enter domains only in the Embedded Domain Whitelist (for example domain.tld).');
    }
    if (!/^[a-z0-9*]([a-z0-9*.-]*[a-z0-9*])?$/.test(entry)) {
      throw new BadRequestException(`The domain "${entry}" is not valid.`);
    }
  }
  return entries.join(', ');
}

function validateAcl(value: string) {
  if (!value.trim()) return '';
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    if (!isIP(address)) throw new BadRequestException(`The IP address "${entry}" is not valid.`);
    if (prefix !== undefined) {
      const bits = Number(prefix);
      const maximum = isIP(address) === 6 ? 128 : 32;
      if (!Number.isInteger(bits) || bits < 0 || bits > maximum) {
        throw new BadRequestException(`The IP address range "${entry}" is not valid.`);
      }
    }
  }
  return entries.join(', ');
}

@Injectable()
export class SystemSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private stamp() {
    return new Date();
  }

  private async legacySettings() {
    const row = await this.prisma.config.findUnique({
      where: { namespace_key: { namespace: 'react_app_state', key: 'settings' } },
    }).catch(() => null);
    if (!row) return {} as Record<string, any>;
    try {
      const parsed = JSON.parse(row.value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {} as Record<string, any>;
    }
  }

  private async metadata() {
    const [departments, schedules] = await Promise.all([
      this.prisma.department.findMany({ orderBy: [{ name: 'asc' }], select: { id: true, name: true, ispublic: true, flags: true } }),
      this.prisma.schedule.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, timezone: true, flags: true } }),
    ]);
    return {
      departments: departments.map((department) => ({
        id: String(department.id),
        name: department.name,
        isPublic: Boolean(department.ispublic),
        active: Boolean(Number(department.flags) & 4) || !Number(department.flags),
      })),
      schedules: schedules
        .filter((schedule) => Number(schedule.flags) & 1)
        .map((schedule) => ({ id: String(schedule.id), name: schedule.name, timezone: schedule.timezone || '' })),
    };
  }

  private async stats() {
    const now = new Date();
    const [files, attachments, chunks, locks, expiredLocks, logs, logGroups, newestLog, oldestLog] = await Promise.all([
      this.prisma.file.aggregate({ _count: { _all: true }, _sum: { size: true } }),
      this.prisma.attachment.count(),
      this.prisma.fileChunk.count(),
      this.prisma.lock.count(),
      this.prisma.lock.count({ where: { expire: { lt: now } } }),
      this.prisma.syslog.count(),
      this.prisma.syslog.groupBy({ by: ['log_type'], _count: { _all: true } }),
      this.prisma.syslog.findFirst({ orderBy: { created: 'desc' }, select: { created: true } }),
      this.prisma.syslog.findFirst({ orderBy: { created: 'asc' }, select: { created: true } }),
    ]);
    const byType = new Map(logGroups.map((group) => [String(group.log_type).toLowerCase(), group._count._all]));
    return {
      attachments: {
        files: files._count._all,
        links: attachments,
        chunks,
        bytes: Number(files._sum.size || 0),
        storage: 'ost_file / ost_file_chunk',
      },
      locks: {
        total: locks,
        active: Math.max(0, locks - expiredLocks),
        expired: expiredLocks,
        table: 'ost_lock',
      },
      logs: {
        total: logs,
        debug: byType.get('debug') || 0,
        warning: byType.get('warning') || 0,
        error: byType.get('error') || 0,
        newest: newestLog?.created ? newestLog.created.toISOString() : null,
        oldest: oldestLog?.created ? oldestLog.created.toISOString() : null,
        table: 'ost_syslog',
      },
    };
  }

  private async readValues() {
    const [rows, legacy, metadata, stats] = await Promise.all([
      this.prisma.config.findMany({ where: { namespace: CORE, key: { in: [...CORE_KEYS] } } }),
      this.legacySettings(),
      this.metadata(),
      this.stats(),
    ]);
    const config = new Map<string, string>(rows.map((row) => [row.key, stringValue(row.value)]));

    const findDepartment = (value: unknown) => {
      const id = stringValue(value);
      return metadata.departments.find((department) => department.id === id) || null;
    };
    const legacyDepartment = findDepartment(legacy.defaultDeptId);
    const fallbackDepartment = metadata.departments.find((department) => department.isPublic) || metadata.departments[0] || null;
    const currentDepartment = findDepartment(config.get('default_dept_id'));
    const defaultDepartment = currentDepartment || legacyDepartment || fallbackDepartment;

    const scheduleId = stringValue(config.get('default_schedule') || config.get('schedule_id') || '0');
    const scheduleExists = scheduleId !== '0' && metadata.schedules.some((schedule) => schedule.id === scheduleId);

    const storedLogLevel = config.get('log_level');
    const legacyLevel = legacyLogLevel(legacy.logLevel);
    const logLevelSource = storedLogLevel !== undefined ? storedLogLevel : legacyLevel !== '' ? legacyLevel : 2;

    const values = {
      isOnline: boolValue(config.get('isonline'), true),
      helpdeskUrl: config.get('helpdesk_url') || process.env.HELPDESK_URL || DEFAULT_HELPDESK_URL,
      helpdeskTitle: config.get('helpdesk_title') || stringValue(legacy.helpdeskName) || 'IT Ticket Support Center',
      defaultDeptId: defaultDepartment?.id || '',
      forceHttps: boolValue(config.get('force_https'), false),
      autolockMinutes: intValue(config.get('autolock_minutes'), legacy.autolock === false ? 0 : 3),
      maxPageSize: intValue(config.get('max_page_size'), 25),
      logLevel: logLevelText(logLevelSource),
      logGracePeriod: intValue(config.get('log_graceperiod'), 12),
      showAvatars: boolValue(config.get('enable_avatars'), true),
      enableRichText: boolValue(config.get('enable_richtext'), true),
      allowIframes: config.get('allow_iframes') || '',
      embeddedDomainWhitelist: config.get('embedded_domain_whitelist') || DEFAULT_EMBEDDED_DOMAINS,
      acl: config.get('acl') || '',
      aclBackend: stringValue(config.get('acl_backend') || '0'),
      defaultLocale: config.get('default_locale') || '',
      defaultTimezone: config.get('default_timezone') || stringValue(legacy.timezone) || 'UTC',
      dateFormats: config.get('date_formats') || '',
      timeFormat: config.get('time_format') || 'hh:mm a',
      dateFormat: config.get('date_format') || 'MM/dd/y',
      datetimeFormat: config.get('datetime_format') || 'MM/dd/y h:mm a',
      daydatetimeFormat: config.get('daydatetime_format') || 'EEE, MMM d y h:mm a',
      scheduleId: scheduleExists ? scheduleId : '0',
      systemLanguage: config.get('system_language') || stringValue(legacy.language) || 'en_US',
      secondaryLanguages: stringValue(config.get('secondary_langs')).split(',').map((lang) => lang.trim()).filter(Boolean),
      defaultStorageBk: config.get('default_storage_bk') || 'D',
      maxFileSize: intValue(config.get('max_file_size'), 1048576),
      filesRequireAuth: boolValue(config.get('files_req_auth'), true),
    };

    return {
      values,
      departments: metadata.departments,
      schedules: metadata.schedules,
      options: {
        pageSizes: PAGE_SIZES,
        logLevels: LOG_LEVELS.map(({ value, label }) => ({ value, label })),
        logGracePeriods: LOG_GRACE_PERIODS,
        aclBackends: ACL_BACKENDS,
        storageBackends: STORAGE_BACKENDS,
        maxFileSizes: MAX_FILE_SIZES,
        languages: LANGUAGE_CODES.map((code) => ({ value: code, label: languageLabel(code) })),
        timezones: timezoneOptions(),
      },
      stats,
    };
  }

  async getSettings() {
    return this.readValues();
  }

  async saveSettings(body: any) {
    const input = body && typeof body === 'object' && body.values && typeof body.values === 'object' ? body.values : body;
    if (!input || typeof input !== 'object') throw new BadRequestException('No system settings were submitted.');
    const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
    const existing = await this.readValues();
    const values: any = { ...existing.values };

    if (has('isOnline')) values.isOnline = boolValue(input.isOnline, true);
    if (has('helpdeskUrl')) values.helpdeskUrl = validateUrl(stringValue(input.helpdeskUrl).trim());
    if (has('helpdeskTitle')) {
      const title = stringValue(input.helpdeskTitle).trim();
      if (!title) throw new BadRequestException('Helpdesk Name/Title is required.');
      if (title.length > 255) throw new BadRequestException('Helpdesk Name/Title must be 255 characters or fewer.');
      values.helpdeskTitle = title;
    }
    if (has('defaultDeptId')) {
      const id = stringValue(input.defaultDeptId);
      const department = existing.departments.find((item) => item.id === id);
      if (!department) throw new BadRequestException('Choose a valid default department.');
      if (existing.departments.some((item) => item.isPublic) && !department.isPublic) {
        throw new BadRequestException('The default department must be a public department.');
      }
      values.defaultDeptId = department.id;
    }
    if (has('forceHttps')) values.forceHttps = boolValue(input.forceHttps, false);
    if (has('autolockMinutes')) {
      const minutes = Number(input.autolockMinutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
        throw new BadRequestException('Collision Avoidance Duration must be a whole number from 0 to 1440 minutes.');
      }
      values.autolockMinutes = minutes;
    }
    if (has('maxPageSize')) {
      const size = Number(input.maxPageSize);
      if (!PAGE_SIZES.includes(size)) throw new BadRequestException('Choose a valid default page size.');
      values.maxPageSize = size;
    }
    if (has('logLevel')) {
      if (!LOG_LEVELS.some((level) => level.value === stringValue(input.logLevel))) {
        throw new BadRequestException('Choose a valid default log level.');
      }
      values.logLevel = stringValue(input.logLevel);
    }
    if (has('logGracePeriod')) {
      const months = Number(input.logGracePeriod);
      if (!Number.isInteger(months) || months < 0 || months > 12) {
        throw new BadRequestException('Purge Logs must be between 0 and 12 months.');
      }
      values.logGracePeriod = months;
    }
    if (has('showAvatars')) values.showAvatars = boolValue(input.showAvatars, true);
    if (has('enableRichText')) values.enableRichText = boolValue(input.enableRichText, true);
    if (has('allowIframes')) values.allowIframes = validateIframeSources(stringValue(input.allowIframes));
    if (has('embeddedDomainWhitelist')) values.embeddedDomainWhitelist = validateDomains(stringValue(input.embeddedDomainWhitelist));
    if (has('acl')) values.acl = validateAcl(stringValue(input.acl));
    if (has('aclBackend')) {
      if (!ACL_BACKENDS.some((backend) => backend.value === stringValue(input.aclBackend))) {
        throw new BadRequestException('Choose a valid ACL scope.');
      }
      values.aclBackend = stringValue(input.aclBackend);
    }
    if (has('defaultLocale')) values.defaultLocale = stringValue(input.defaultLocale).trim().slice(0, 20);
    if (has('defaultTimezone')) {
      const timezone = stringValue(input.defaultTimezone).trim();
      if (!timezone) throw new BadRequestException('Default Time Zone is required.');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        throw new BadRequestException('Choose a valid default time zone.');
      }
      values.defaultTimezone = timezone;
    }
    if (has('dateFormats')) {
      if (!['', '24', 'custom'].includes(stringValue(input.dateFormats))) {
        throw new BadRequestException('Choose a valid Date and Time Format option.');
      }
      values.dateFormats = stringValue(input.dateFormats);
    }
    for (const [field, key, label] of [
      ['timeFormat', 'timeFormat', 'Time Format'],
      ['dateFormat', 'dateFormat', 'Date Format'],
      ['datetimeFormat', 'datetimeFormat', 'Date and Time Format'],
      ['daydatetimeFormat', 'daydatetimeFormat', 'Day, Date and Time Format'],
    ] as const) {
      if (!has(field)) continue;
      const value = stringValue(input[field]).trim();
      if (value.length > 64) throw new BadRequestException(`${label} must be 64 characters or fewer.`);
      values[key] = value;
    }
    if (has('scheduleId')) {
      const id = stringValue(input.scheduleId || '0');
      if (id !== '0' && !existing.schedules.some((schedule) => schedule.id === id)) {
        throw new BadRequestException('Choose a valid business hours schedule.');
      }
      values.scheduleId = id;
    }
    if (has('systemLanguage')) {
      const language = stringValue(input.systemLanguage).trim();
      if (!language) throw new BadRequestException('Choose a primary system language.');
      if (language.length > 16) throw new BadRequestException('Choose a valid primary system language.');
      values.systemLanguage = language;
    }
    if (has('secondaryLanguages')) {
      const raw = Array.isArray(input.secondaryLanguages) ? input.secondaryLanguages : [];
      const secondary = [...new Set(raw.map((lang: unknown) => stringValue(lang).trim()).filter(Boolean))];
      if (secondary.length > 50) throw new BadRequestException('Too many secondary languages were selected.');
      values.secondaryLanguages = secondary;
    }
    if (has('defaultStorageBk')) {
      const backend = stringValue(input.defaultStorageBk).trim().toUpperCase();
      if (!STORAGE_BACKENDS.some((storage) => storage.value === backend)) {
        throw new BadRequestException('Choose a valid attachment storage backend.');
      }
      values.defaultStorageBk = backend;
    }
    if (has('maxFileSize')) {
      const size = Number(input.maxFileSize);
      if (!MAX_FILE_SIZES.some((option) => option.value === size)) {
        throw new BadRequestException('Choose a valid maximum file size.');
      }
      values.maxFileSize = size;
    }
    if (has('filesRequireAuth')) values.filesRequireAuth = boolValue(input.filesRequireAuth, true);

    validateUrl(values.helpdeskUrl);
    if (!String(values.helpdeskTitle || '').trim()) throw new BadRequestException('Helpdesk Name/Title is required.');
    if (values.dateFormats === 'custom') {
      for (const key of ['timeFormat', 'dateFormat', 'datetimeFormat', 'daydatetimeFormat']) {
        if (!String(values[key] || '').trim()) throw new BadRequestException('All Advanced date and time formats are required.');
      }
    }
    if (values.aclBackend !== '0' && !String(values.acl || '').trim()) {
      throw new BadRequestException('Enter at least one IP address when ACL is applied to a panel.');
    }
    if (values.secondaryLanguages.includes(values.systemLanguage)) {
      values.secondaryLanguages = values.secondaryLanguages.filter((lang: string) => lang !== values.systemLanguage);
    }

    const stored: Record<CoreKey, string> = {
      isonline: values.isOnline ? '1' : '0',
      helpdesk_url: values.helpdeskUrl,
      helpdesk_title: values.helpdeskTitle,
      default_dept_id: values.defaultDeptId,
      force_https: values.forceHttps ? '1' : '0',
      autolock_minutes: String(values.autolockMinutes),
      max_page_size: String(values.maxPageSize),
      log_level: String(logLevelNumber(values.logLevel)),
      log_graceperiod: String(values.logGracePeriod),
      enable_avatars: values.showAvatars ? '1' : '0',
      enable_richtext: values.enableRichText ? '1' : '0',
      allow_iframes: values.allowIframes,
      embedded_domain_whitelist: values.embeddedDomainWhitelist,
      acl: values.acl,
      acl_backend: String(values.aclBackend),
      default_locale: values.defaultLocale,
      default_timezone: values.defaultTimezone,
      date_formats: values.dateFormats,
      time_format: values.timeFormat,
      date_format: values.dateFormat,
      datetime_format: values.datetimeFormat,
      daydatetime_format: values.daydatetimeFormat,
      schedule_id: values.scheduleId,
      default_schedule: values.scheduleId,
      system_language: values.systemLanguage,
      secondary_langs: values.secondaryLanguages.join(','),
      default_storage_bk: values.defaultStorageBk,
      max_file_size: String(values.maxFileSize),
      files_req_auth: values.filesRequireAuth ? '1' : '0',
    };

    const stamp = this.stamp();
    await this.prisma.$transaction(
      CORE_KEYS.map((key) => this.prisma.config.upsert({
        where: { namespace_key: { namespace: CORE, key } },
        create: { namespace: CORE, key, value: stored[key], updated: stamp },
        update: { value: stored[key], updated: stamp },
      })),
    );

    return this.getSettings();
  }

  async purgeLogs() {
    const row = await this.prisma.config.findUnique({ where: { namespace_key: { namespace: CORE, key: 'log_graceperiod' } } });
    const months = intValue(row?.value, 12);
    if (months <= 0) throw new ConflictException('Log purging is disabled. Choose a purge period before running this action.');
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const result = await this.prisma.syslog.deleteMany({ where: { created: { lt: cutoff } } });
    return { deleted: result.count, cutoff: cutoff.toISOString(), months };
  }

  async purgeExpiredLocks() {
    const result = await this.prisma.lock.deleteMany({ where: { expire: { lt: this.stamp() } } });
    return { deleted: result.count };
  }
}
