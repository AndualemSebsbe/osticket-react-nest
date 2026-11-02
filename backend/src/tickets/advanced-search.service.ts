import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_FLAG_DISABLED,
  QUEUE_FLAG_INHERIT_COLUMNS,
  QUEUE_FLAG_INHERIT_CRITERIA,
  QUEUE_FLAG_INHERIT_SORTING,
  builtinTicketQueue,
} from './queue-defaults';

type SearchFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';
type SearchFieldOption = { value: string; label: string };

type SearchFieldDef = {
  path: string;
  label: string;
  type: SearchFieldType;
  group: string;
  options?: SearchFieldOption[];
  hint?: string;
};

type FieldValue = { raw: unknown; label: string; text: string; type: SearchFieldType };

type SearchCriterion = { field: string; operator?: string; value?: unknown; value2?: unknown; legacy?: boolean };

type SearchRecord = {
  row: any;
  fields: Map<string, FieldValue>;
  values: Record<string, unknown>;
  custom: Record<string, Record<string, unknown>>;
  searchText: string;
  snippet: string;
  threadId: string;
};

type SearchBundle = {
  tickets: any[];
  ticketCdata: Map<string, any>;
  statusById: Map<string, any>;
  departmentById: Map<string, any>;
  topicById: Map<string, any>;
  staffById: Map<string, any>;
  teamById: Map<string, any>;
  slaById: Map<string, any>;
  branchById: Map<string, any>;
  statuses: any[];
  departments: any[];
  topics: any[];
  staff: any[];
  teams: any[];
  teamMembers: any[];
  teamIdsByStaff: Map<string, Set<string>>;
  teamMemberIdsByTeam: Map<string, Set<string>>;
  slas: any[];
  branches: any[];
  priorities: any[];
  users: Map<string, any>;
  userEmails: Map<string, any>;
  defaultEmailByUser: Map<string, any>;
  organizations: Map<string, any>;
  organizationCdata: Map<string, any>;
  threads: any[];
  threadById: Map<string, any>;
  threadByTicket: Map<string, any>;
  entriesByThread: Map<string, any[]>;
  attachmentsByTicket: Map<string, number>;
  collaboratorsByThread: Map<string, number>;
  searchIndexByTicket: Map<string, string>;
  ticketCustom: Map<string, Map<string, { values: unknown[]; field: any }>>;
  userCustom: Map<string, Map<string, { values: unknown[]; field: any }>>;
  orgCustom: Map<string, Map<string, { values: unknown[]; field: any }>>;
  listItemsByList: Map<string, any[]>;
  fields: SearchFieldDef[];
  fieldByPath: Map<string, SearchFieldDef>;
  queues: any[];
  queueColumns: any[];
  queueColumnLinks: any[];
  queueSorts: any[];
  queueSortLinks: any[];
  queueConfigs: any[];
  queueExports: any[];
};

const OPERATOR_LABELS: Record<string, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'is',
  not_equals: 'is not',
  starts_with: 'starts with',
  ends_with: 'ends with',
  in: 'is one of',
  not_in: 'is not one of',
  gt: 'greater than',
  gte: 'greater than or equal to',
  lt: 'less than',
  lte: 'less than or equal to',
  between: 'between',
  on: 'on',
  before: 'before',
  after: 'after',
  set: 'is set',
  not_set: 'is not set',
  empty: 'is empty',
  not_empty: 'is not empty',
};

const OPERATORS_BY_TYPE: Record<SearchFieldType, string[]> = {
  text: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'empty', 'not_empty'],
  select: ['equals', 'not_equals', 'in', 'not_in', 'empty', 'not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  date: ['on', 'before', 'after', 'gte', 'lte', 'between', 'empty', 'not_empty'],
  boolean: ['set', 'not_set', 'equals', 'not_equals'],
};

const DEFAULT_COLUMNS = ['number', 'subject', 'status', 'priority', 'department', 'assignee', 'updated'];
const QUICK_FILTERS = ['status', 'priority', 'assignee', 'department', 'topic'];

function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toLower(value: unknown): string {
  return toStr(value).toLocaleLowerCase();
}

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJson(value: unknown, fallback: any = null): any {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined && toStr(value).trim() !== '';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function valueList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toStr).filter(Boolean);
  return toStr(value).split(',').map((part) => part.trim()).filter(Boolean);
}

function dateMs(value: unknown): number {
  if (value === null || value === undefined || value === '') return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const text = toStr(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  return Date.parse(dateOnly ? `${text}T00:00:00.000Z` : text);
}

function dateBound(value: unknown, end = false): number {
  if (!isSet(value)) return Number.NaN;
  const text = toStr(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  return Date.parse(dateOnly ? `${text}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : text);
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(toStr(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

@Injectable()
export class AdvancedSearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private normalizeOperator(operator: unknown, type: SearchFieldType): string {
    const raw = toLower(operator).replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
      '': 'equals',
      is: 'equals',
      eq: 'equals',
      not: 'not_equals',
      ne: 'not_equals',
      neq: 'not_equals',
      like: 'contains',
      not_like: 'not_contains',
      greater: 'gt',
      greater_than: 'gt',
      greater_equal: 'gte',
      greater_than_or_equal: 'gte',
      less: 'lt',
      less_than: 'lt',
      less_equal: 'lte',
      less_than_or_equal: 'lte',
      before_date: 'before',
      after_date: 'after',
      notset: 'not_set',
      notempty: 'not_empty',
    };
    const normalized = aliases[raw] || raw;
    if (OPERATORS_BY_TYPE[type]?.includes(normalized)) return normalized;
    if (type === 'date' && normalized === 'equals') return 'on';
    if (type === 'boolean' && normalized === 'not_empty') return 'set';
    if (type === 'boolean' && normalized === 'empty') return 'not_set';
    return OPERATORS_BY_TYPE[type]?.[0] || 'equals';
  }

  private customFieldType(field: any): SearchFieldType {
    const type = toLower(field?.type);
    if (['datetime', 'date'].includes(type)) return 'date';
    if (['bool', 'boolean'].includes(type)) return 'boolean';
    if (['int', 'integer', 'number', 'numeric'].includes(type)) return 'number';
    if (['choice', 'list', 'select', 'radio', 'checkbox'].includes(type)) return 'select';
    return 'text';
  }

  private customFieldOptions(field: any, listItemsByList: Map<string, any[]>): SearchFieldOption[] {
    const configuration = parseObject(field?.configuration);
    const rawChoices = configuration.choices ?? configuration.options ?? configuration.items;
    let choices: any[] = [];
    if (Array.isArray(rawChoices)) choices = rawChoices;
    else if (rawChoices && typeof rawChoices === 'object') {
      choices = Object.entries(rawChoices).map(([value, label]) => ({ value, label }));
    }
    const listId = configuration.list_id ?? configuration.listId ?? (toLower(field?.type) === 'list' ? configuration.list : undefined);
    if (listId !== undefined && listId !== null && listId !== '') {
      const rows = listItemsByList.get(toStr(listId)) || [];
      choices = rows.map((item) => ({ value: item.value, label: item.extra || item.value }));
    }
    return choices.map((choice) => {
      if (choice && typeof choice === 'object') return { value: toStr(choice.value ?? choice.id), label: toStr(choice.label ?? choice.name ?? choice.value ?? choice.id) };
      return { value: toStr(choice), label: toStr(choice) };
    }).filter((choice) => choice.value !== '');
  }

  private addCustomValues(target: Map<string, Map<string, { values: unknown[]; field: any }>>, objectId: string, name: string, field: any, value: unknown) {
    if (!target.has(objectId)) target.set(objectId, new Map());
    const fields = target.get(objectId)!;
    if (!fields.has(name)) fields.set(name, { values: [], field });
    fields.get(name)!.values.push(value);
  }

  private async loadBundle(keyword: string): Promise<SearchBundle> {
    const includeKeyword = Boolean(keyword);
    const [
      tickets,
      ticketCdata,
      statuses,
      departments,
      topics,
      staff,
      teams,
      teamMembers,
      slas,
      branches,
      priorities,
      users,
      userEmails,
      organizations,
      organizationCdata,
      threads,
      forms,
      formFields,
      formEntries,
      formValues,
      listItems,
      queues,
      queueColumns,
      queueColumnLinks,
      queueSorts,
      queueSortLinks,
      queueConfigs,
      queueExports,
    ] = await Promise.all([
      this.prisma.ticket.findMany({ orderBy: { updated: 'desc' } }),
      this.prisma.ticketCdata.findMany(),
      this.prisma.ticketStatus.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.helpTopic.findMany({ orderBy: { topic: 'asc' } }),
      this.prisma.staff.findMany({ orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.teamMember.findMany(),
      this.prisma.sla.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.branch.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.ticketPriority.findMany({ orderBy: { priority_urgency: 'asc' } }),
      this.prisma.user.findMany(),
      this.prisma.userEmail.findMany(),
      this.prisma.organization.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.organizationCdata.findMany(),
      this.prisma.thread.findMany({ where: { object_type: 'T' } }),
      this.prisma.form.findMany(),
      this.prisma.formField.findMany(),
      this.prisma.formEntry.findMany(),
      this.prisma.formEntryValues.findMany(),
      this.prisma.listItems.findMany({ orderBy: [{ list_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.queue.findMany({ orderBy: [{ sort: 'asc' }, { title: 'asc' }] }),
      this.prisma.queueColumn.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.queueColumns.findMany({ orderBy: [{ queue_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.queueSort.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.queueSorts.findMany({ orderBy: [{ queue_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.queueConfig.findMany(),
      this.prisma.queueExport.findMany(),
    ]);

    const threadIds = threads.map((thread) => thread.id);
    const threadIdNumbers = threads.map((thread) => Number(thread.id));
    const [entries, attachments, collaborators, searchIndex] = await Promise.all([
      threadIds.length
        ? this.prisma.threadEntry.findMany({
            where: { thread_id: { in: threadIds } },
            select: { id: true, thread_id: true, type: true, title: true, created: true, ...(includeKeyword ? { body: true } : {}) },
          })
        : Promise.resolve([] as any[]),
      threadIds.length
        ? this.prisma.attachment.findMany({ where: { type: 'H' }, select: { object_id: true } })
        : Promise.resolve([] as any[]),
      threadIdNumbers.length
        ? this.prisma.threadCollaborator.groupBy({ by: ['thread_id'], where: { thread_id: { in: threadIdNumbers } }, _count: { _all: true } })
        : Promise.resolve([] as any[]),
      includeKeyword
        ? this.prisma.searchIndex.findMany({ where: { object_type: 'T' }, select: { object_id: true, content: true } })
        : Promise.resolve([] as any[]),
    ]);

    const statusById = new Map(statuses.map((row) => [toStr(row.id), row]));
    const departmentById = new Map(departments.map((row) => [toStr(row.id), row]));
    const topicById = new Map(topics.map((row) => [toStr(row.topic_id), row]));
    const staffById = new Map(staff.map((row) => [toStr(row.staff_id), row]));
    const teamById = new Map(teams.map((row) => [toStr(row.team_id), row]));
    const teamIdsByStaff = new Map<string, Set<string>>();
    const teamMemberIdsByTeam = new Map<string, Set<string>>();
    for (const member of teamMembers) {
      const staffId = toStr(member.staff_id);
      const teamId = toStr(member.team_id);
      if (!teamIdsByStaff.has(staffId)) teamIdsByStaff.set(staffId, new Set());
      teamIdsByStaff.get(staffId)!.add(teamId);
      if (!teamMemberIdsByTeam.has(teamId)) teamMemberIdsByTeam.set(teamId, new Set());
      teamMemberIdsByTeam.get(teamId)!.add(staffId);
    }
    const slaById = new Map(slas.map((row) => [toStr(row.id), row]));
    const branchById = new Map(branches.map((row) => [toStr(row.id), row]));
    const userById = new Map(users.map((row) => [toStr(row.id), row]));
    const userEmailById = new Map(userEmails.map((row) => [toStr(row.id), row]));
    const defaultEmailByUser = new Map<string, any>();
    for (const user of users) {
      const email = userEmails.find((row) => toStr(row.user_id) === toStr(user.id) && (toStr(row.id) === toStr(user.default_email_id) || !defaultEmailByUser.has(toStr(user.id))));
      if (email) defaultEmailByUser.set(toStr(user.id), email);
    }
    const organizationById = new Map(organizations.map((row) => [toStr(row.id), row]));
    const orgCdataById = new Map(organizationCdata.map((row) => [toStr(row.org_id), row]));
    const listItemsByList = new Map<string, any[]>();
    for (const item of listItems) {
      const listId = toStr(item.list_id);
      if (!listItemsByList.has(listId)) listItemsByList.set(listId, []);
      listItemsByList.get(listId)!.push(item);
    }

    const ticketCdataById = new Map(ticketCdata.map((row) => [toStr(row.ticket_id), row]));
    const threadByTicket = new Map<string, any>();
    const threadById = new Map<string, any>();
    for (const thread of threads) {
      threadById.set(toStr(thread.id), thread);
      threadByTicket.set(toStr(thread.object_id), thread);
    }

    const entriesByThread = new Map<string, any[]>();
    const entryToTicket = new Map<string, string>();
    for (const entry of entries) {
      const threadId = toStr(entry.thread_id);
      if (!entriesByThread.has(threadId)) entriesByThread.set(threadId, []);
      entriesByThread.get(threadId)!.push(entry);
      const thread = threadById.get(threadId);
      if (thread) entryToTicket.set(toStr(entry.id), toStr(thread.object_id));
    }

    const attachmentsByTicket = new Map<string, number>();
    for (const attachment of attachments) {
      const ticketId = entryToTicket.get(toStr(attachment.object_id));
      if (!ticketId) continue;
      attachmentsByTicket.set(ticketId, (attachmentsByTicket.get(ticketId) || 0) + 1);
    }

    const collaboratorsByThread = new Map<string, number>();
    for (const row of collaborators) collaboratorsByThread.set(toStr(row.thread_id), Number(row._count?._all || 0));

    const searchIndexByTicket = new Map<string, string>();
    for (const row of searchIndex) searchIndexByTicket.set(toStr(row.object_id), toStr(row.content));

    const fieldById = new Map(formFields.map((row) => [toStr(row.id), row]));
    const formEntryById = new Map(formEntries.map((row) => [toStr(row.id), row]));
    const ticketCustom = new Map<string, Map<string, { values: unknown[]; field: any }>>();
    const userCustom = new Map<string, Map<string, { values: unknown[]; field: any }>>();
    const orgCustom = new Map<string, Map<string, { values: unknown[]; field: any }>>();
    for (const value of formValues) {
      const entry = formEntryById.get(toStr(value.entry_id));
      const field = fieldById.get(toStr(value.field_id));
      if (!entry || !field) continue;
      const name = field.name || `field_${field.id}`;
      if (entry.object_type === 'T') this.addCustomValues(ticketCustom, toStr(entry.object_id), name, field, value.value);
      else if (entry.object_type === 'U') this.addCustomValues(userCustom, toStr(entry.object_id), name, field, value.value);
      else if (entry.object_type === 'O') this.addCustomValues(orgCustom, toStr(entry.object_id), name, field, value.value);
    }

    const sourceOptions: SearchFieldOption[] = [
      { value: 'web', label: 'Web' },
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Phone' },
      { value: 'api', label: 'API' },
      { value: 'other', label: 'Other' },
    ];
    const statusOptions = unique(statuses.map((row) => toStr(row.state || row.name).toLocaleLowerCase())).map((state) => {
      const row = statuses.find((status) => toStr(status.state || status.name).toLocaleLowerCase() === state);
      return { value: state, label: row?.name || state };
    });
    const priorityOptions = priorities.map((row) => ({ value: toLower(row.priority), label: row.priority || toStr(row.priority) }));
    const departmentOptions = departments.map((row) => ({ value: toStr(row.id), label: row.name }));
    const topicOptions = topics.map((row) => ({ value: toStr(row.topic_id), label: row.topic }));
    const staffOptions = [
      { value: '0', label: 'Unassigned' },
      ...staff.map((row) => ({ value: toStr(row.staff_id), label: [row.firstname, row.lastname].filter(Boolean).join(' ') || row.username || row.email || toStr(row.staff_id) })),
    ];
    const teamOptions = teams.map((row) => ({ value: toStr(row.team_id), label: row.name }));
    const slaOptions = slas.map((row) => ({ value: toStr(row.id), label: row.name }));
    const branchOptions = branches.map((row) => ({ value: toStr(row.id), label: row.name }));
    const organizationOptions = organizations.map((row) => ({ value: toStr(row.id), label: orgCdataById.get(toStr(row.id))?.name || row.name }));

    // Custom fields come from installed forms, including fields that have no values yet.
    const customDefs: SearchFieldDef[] = [];
    const seenCustom = new Set<string>();
    const groupByPrefix: Record<string, string> = {
      'cdata.': 'Ticket custom fields',
      'user.': 'Requester custom fields',
      'org.': 'Organization custom fields',
    };
    const pushCustomDef = (prefix: string, name: string, field: any) => {
      const path = prefix + name;
      if (!name || seenCustom.has(path)) return;
      seenCustom.add(path);
      customDefs.push({
        path,
        label: field.label || name,
        type: this.customFieldType(field),
        group: groupByPrefix[prefix] || 'Custom fields',
        options: this.customFieldOptions(field, listItemsByList),
      });
    };
    const formTypePrefix: Record<string, string> = { T: 'cdata.', U: 'user.', O: 'org.' };
    const formTypeById = new Map(forms.map((form) => [toStr(form.id), toStr(form.type)]));
    for (const field of formFields) {
      const prefix = formTypePrefix[formTypeById.get(toStr(field.form_id)) || ''];
      if (prefix) pushCustomDef(prefix, field.name || `field_${field.id}`, field);
    }
    const addCustomDefs = (source: Map<string, Map<string, { values: unknown[]; field: any }>>, prefix: string) => {
      for (const fields of source.values()) {
        for (const [name, info] of fields) pushCustomDef(prefix, name, info.field);
      }
    };
    addCustomDefs(ticketCustom, 'cdata.');
    addCustomDefs(userCustom, 'user.');
    addCustomDefs(orgCustom, 'org.');

    const fields: SearchFieldDef[] = [
      { path: 'number', label: 'Ticket Number', type: 'text', group: 'Ticket' },
      { path: 'subject', label: 'Subject', type: 'text', group: 'Ticket' },
      { path: 'status', label: 'Status', type: 'select', group: 'Ticket', options: statusOptions },
      { path: 'priority', label: 'Priority', type: 'select', group: 'Ticket', options: priorityOptions },
      { path: 'source', label: 'Ticket Source', type: 'select', group: 'Ticket', options: sourceOptions },
      { path: 'department', label: 'Department', type: 'select', group: 'Ticket', options: departmentOptions },
      { path: 'topic', label: 'Help Topic', type: 'select', group: 'Ticket', options: topicOptions },
      { path: 'assignee', label: 'Assigned Staff', type: 'select', group: 'Ticket', options: staffOptions },
      { path: 'team', label: 'Assigned Team', type: 'select', group: 'Ticket', options: teamOptions },
      { path: 'sla', label: 'SLA Plan', type: 'select', group: 'Ticket', options: slaOptions },
      { path: 'branch', label: 'Branch', type: 'select', group: 'Ticket', options: branchOptions },
      { path: 'ip_address', label: 'IP Address', type: 'text', group: 'Ticket' },
      { path: 'created', label: 'Create Date', type: 'date', group: 'Dates' },
      { path: 'updated', label: 'Last Updated', type: 'date', group: 'Dates' },
      { path: 'duedate', label: 'Due Date', type: 'date', group: 'Dates' },
      { path: 'est_duedate', label: 'SLA Due Date', type: 'date', group: 'Dates' },
      { path: 'reopened', label: 'Reopen Date', type: 'date', group: 'Dates' },
      { path: 'closed', label: 'Close Date', type: 'date', group: 'Dates' },
      { path: 'lastupdate', label: 'Last Response', type: 'date', group: 'Dates' },
      { path: 'requester', label: 'Requester', type: 'text', group: 'Requester' },
      { path: 'email', label: 'Requester Email', type: 'text', group: 'Requester' },
      { path: 'org', label: 'Organization', type: 'select', group: 'Requester', options: organizationOptions },
      { path: 'org_name', label: 'Organization Name', type: 'text', group: 'Organization' },
      { path: 'org_domain', label: 'Organization Domain', type: 'text', group: 'Organization' },
      { path: 'org_phone', label: 'Organization Phone', type: 'text', group: 'Organization' },
      { path: 'org_website', label: 'Organization Website', type: 'text', group: 'Organization' },
      { path: 'org_address', label: 'Organization Address', type: 'text', group: 'Organization' },
      { path: 'org_notes', label: 'Organization Notes', type: 'text', group: 'Organization' },
      { path: 'employee_id', label: 'Employee ID', type: 'text', group: 'Requester' },
      { path: 'isoverdue', label: 'Overdue', type: 'boolean', group: 'Status flags' },
      { path: 'isanswered', label: 'Answered', type: 'boolean', group: 'Status flags' },
      { path: 'isassigned', label: 'Assigned', type: 'boolean', group: 'Status flags' },
      { path: 'ismerged', label: 'Merged', type: 'boolean', group: 'Status flags' },
      { path: 'thread_count', label: 'Thread Count', type: 'number', group: 'Thread' },
      { path: 'attachment_count', label: 'Attachment Count', type: 'number', group: 'Thread' },
      { path: 'collaborator_count', label: 'Collaborator Count', type: 'number', group: 'Thread' },
      ...customDefs,
    ];
    const fieldByPath = new Map(fields.map((field) => [field.path, field]));

    return {
      tickets,
      ticketCdata: ticketCdataById,
      statusById,
      departmentById,
      topicById,
      staffById,
      teamById,
      slaById,
      branchById,
      statuses,
      departments,
      topics,
      staff,
      teams,
      teamMembers,
      teamIdsByStaff,
      teamMemberIdsByTeam,
      slas,
      branches,
      priorities,
      users: userById,
      userEmails: userEmailById,
      defaultEmailByUser,
      organizations: organizationById,
      organizationCdata: orgCdataById,
      threads,
      threadById,
      threadByTicket,
      entriesByThread,
      attachmentsByTicket,
      collaboratorsByThread,
      searchIndexByTicket,
      ticketCustom,
      userCustom,
      orgCustom,
      listItemsByList,
      fields,
      fieldByPath,
      queues,
      queueColumns,
      queueColumnLinks,
      queueSorts,
      queueSortLinks,
      queueConfigs,
      queueExports,
    };
  }

  private lookupMaps(bundle: SearchBundle) {
    return {
      statusById: bundle.statusById,
      departmentById: bundle.departmentById,
      topicById: bundle.topicById,
      staffById: bundle.staffById,
      teamById: bundle.teamById,
      slaById: bundle.slaById,
      branchById: bundle.branchById,
    };
  }

  private setField(map: Map<string, FieldValue>, path: string, raw: unknown, label: string, type: SearchFieldType, text?: string) {
    const rawText = isSet(raw) ? toStr(raw) : '';
    map.set(path, { raw, label: label || rawText, text: (text ?? `${rawText} ${label || ''}`).toLocaleLowerCase(), type });
  }

  private displayValue(value: FieldValue | undefined): unknown {
    if (!value) return '';
    if (value.type === 'boolean') return Boolean(value.raw);
    if (value.type === 'number' && isSet(value.raw)) return numeric(value.raw);
    return value.label;
  }

  private customDisplay(field: SearchFieldDef, values: unknown[]): { raw: unknown; label: string } {
    const options = field.options || [];
    const raw = values.length > 1 ? values.map(toStr).join(', ') : values[0];
    const label = values.map((value) => {
      const text = toStr(value);
      return options.find((option) => option.value === text)?.label || text;
    }).filter(Boolean).join(', ');
    return { raw, label };
  }

  private buildRecord(row: any, bundle: SearchBundle, keyword = '', staffId = 0): SearchRecord {
    const maps = this.lookupMaps(bundle);
    const ticketId = toStr(row.ticket_id);
    const cdata = bundle.ticketCdata.get(ticketId) || {};
    const user = bundle.users.get(toStr(row.user_id));
    const userEmail = bundle.userEmails.get(toStr(row.user_email_id)) || (user ? bundle.defaultEmailByUser.get(toStr(user.id)) : null);
    const status = maps.statusById.get(toStr(row.status_id));
    const department = maps.departmentById.get(toStr(row.dept_id));
    const topic = maps.topicById.get(toStr(row.topic_id));
    const assignee = maps.staffById.get(toStr(row.staff_id));
    const team = maps.teamById.get(toStr(row.team_id));
    const sla = maps.slaById.get(toStr(row.sla_id));
    const branch = maps.branchById.get(toStr(cdata.branch_id));
    const org = user ? bundle.organizations.get(toStr(user.org_id)) : null;
    const orgData = org ? bundle.organizationCdata.get(toStr(org.id)) : null;
    const thread = bundle.threadByTicket.get(ticketId);
    const threadId = thread ? toStr(thread.id) : '';
    const entries = bundle.entriesByThread.get(threadId) || [];
    const source = toLower(row.source);
    const statusState = toLower(status?.state || status?.name || 'open');
    const priority = toLower(cdata.priority || 'normal');
    const assigneeName = assignee ? [assignee.firstname, assignee.lastname].filter(Boolean).join(' ') || assignee.username || assignee.email || '' : 'Unassigned';

    const fields = new Map<string, FieldValue>();
    this.setField(fields, 'number', row.number || ticketId, toStr(row.number || ticketId), 'text');
    this.setField(fields, 'subject', cdata.subject || '', toStr(cdata.subject || '(no subject)'), 'text');
    this.setField(fields, 'status', statusState, status?.name || statusState, 'select');
    this.setField(fields, 'priority', priority, priority, 'select');
    this.setField(fields, 'source', source, source === 'api' ? 'API' : source ? source[0].toUpperCase() + source.slice(1) : 'Other', 'select');
    this.setField(fields, 'department', row.dept_id ? toStr(row.dept_id) : '', department?.name || '', 'select');
    this.setField(fields, 'topic', row.topic_id ? toStr(row.topic_id) : '', topic?.topic || '', 'select');
    this.setField(fields, 'assignee', toStr(row.staff_id || 0), assigneeName, 'select');
    this.setField(fields, 'team', row.team_id ? toStr(row.team_id) : '', team?.name || '', 'select');
    this.setField(fields, 'sla', row.sla_id ? toStr(row.sla_id) : '', sla?.name || '', 'select');
    this.setField(fields, 'branch', cdata.branch_id ? toStr(cdata.branch_id) : '', branch?.name || '', 'select');
    this.setField(fields, 'ip_address', row.ip_address || '', toStr(row.ip_address || ''), 'text');
    this.setField(fields, 'created', row.created?.toISOString?.() || row.created, row.created ? new Date(row.created).toISOString() : '', 'date');
    this.setField(fields, 'updated', row.updated?.toISOString?.() || row.updated, row.updated ? new Date(row.updated).toISOString() : '', 'date');
    this.setField(fields, 'duedate', row.duedate?.toISOString?.() || row.duedate || '', row.duedate ? new Date(row.duedate).toISOString() : '', 'date');
    this.setField(fields, 'est_duedate', row.est_duedate?.toISOString?.() || row.est_duedate || '', row.est_duedate ? new Date(row.est_duedate).toISOString() : '', 'date');
    this.setField(fields, 'reopened', row.reopened?.toISOString?.() || row.reopened || '', row.reopened ? new Date(row.reopened).toISOString() : '', 'date');
    this.setField(fields, 'closed', row.closed?.toISOString?.() || row.closed || '', row.closed ? new Date(row.closed).toISOString() : '', 'date');
    this.setField(fields, 'lastupdate', row.lastupdate?.toISOString?.() || row.lastupdate || row.updated?.toISOString?.() || row.updated, row.lastupdate ? new Date(row.lastupdate).toISOString() : (row.updated ? new Date(row.updated).toISOString() : ''), 'date');
    this.setField(fields, 'requester', user?.name || '', user?.name || '', 'text', `${user?.name || ''} ${userEmail?.address || ''}`);
    this.setField(fields, 'email', userEmail?.address || '', userEmail?.address || '', 'text');
    this.setField(fields, 'org', user?.org_id ? toStr(user.org_id) : '', orgData?.name || org?.name || '', 'select');
    this.setField(fields, 'org_name', orgData?.name || org?.name || '', orgData?.name || org?.name || '', 'text');
    this.setField(fields, 'org_domain', orgData?.domain || '', toStr(orgData?.domain || ''), 'text');
    this.setField(fields, 'org_phone', orgData?.phone || '', toStr(orgData?.phone || ''), 'text');
    this.setField(fields, 'org_website', orgData?.website || '', toStr(orgData?.website || ''), 'text');
    this.setField(fields, 'org_address', orgData?.address || '', toStr(orgData?.address || ''), 'text');
    this.setField(fields, 'org_notes', orgData?.notes || '', toStr(orgData?.notes || ''), 'text');
    this.setField(fields, 'employee_id', cdata.employee_id || '', toStr(cdata.employee_id || ''), 'text');
    this.setField(fields, 'isoverdue', Boolean(row.isoverdue), Boolean(row.isoverdue) ? 'Yes' : 'No', 'boolean');
    this.setField(fields, 'isanswered', Boolean(row.isanswered), Boolean(row.isanswered) ? 'Yes' : 'No', 'boolean');
    this.setField(fields, 'isassigned', Number(row.staff_id || 0) > 0, Number(row.staff_id || 0) > 0 ? 'Yes' : 'No', 'boolean');
    this.setField(fields, 'ismerged', Boolean(row.ticket_pid), Boolean(row.ticket_pid) ? 'Yes' : 'No', 'boolean');
    this.setField(fields, 'thread_count', entries.length, String(entries.length), 'number');
    this.setField(fields, 'attachment_count', bundle.attachmentsByTicket.get(ticketId) || 0, String(bundle.attachmentsByTicket.get(ticketId) || 0), 'number');
    this.setField(fields, 'collaborator_count', bundle.collaboratorsByThread.get(threadId) || 0, String(bundle.collaboratorsByThread.get(threadId) || 0), 'number');

    if (bundle.fieldByPath.has('queue_assignee')) {
      const scopes: string[] = [];
      if (staffId && Number(row.staff_id || 0) === staffId) scopes.push('me');
      const staffTeams = bundle.teamIdsByStaff.get(String(staffId));
      if (staffTeams && row.team_id && staffTeams.has(toStr(row.team_id))) scopes.push('team');
      fields.set('queue_assignee', { raw: scopes, label: scopes.length ? scopes.map((scope) => scope === 'me' ? 'Me' : 'One of my teams').join(', ') : 'Other', text: scopes.join(' '), type: 'select' });
    }

    const custom: Record<string, Record<string, unknown>> = { ticket: {}, requester: {}, organization: {} };
    const addCustom = (source: Map<string, Map<string, { values: unknown[]; field: any }>> | undefined, objectId: string, prefix: string, target: Record<string, unknown>) => {
      const values = source?.get(objectId);
      if (!values) return;
      for (const [name, info] of values) {
        const path = prefix + name;
        const definition = bundle.fieldByPath.get(path);
        if (!definition) continue;
        const { raw, label } = this.customDisplay(definition, info.values);
        this.setField(fields, path, raw, label, definition.type);
        target[name] = label;
      }
    };
    addCustom(bundle.ticketCustom, ticketId, 'cdata.', custom.ticket);
    addCustom(bundle.userCustom, toStr(row.user_id), 'user.', custom.requester);
    addCustom(bundle.orgCustom, toStr(user?.org_id || 0), 'org.', custom.organization);

    const threadText = entries.map((entry) => `${entry.title || ''} ${entry.body || ''}`).join(' ');
    const indexText = bundle.searchIndexByTicket.get(ticketId) || '';
    const searchText = [...fields.values()].map((value) => value.text).join(' ').toLocaleLowerCase() + ' ' + toLower(threadText) + ' ' + toLower(indexText);

    let snippet = '';
    const snippetTerm = toLower(keyword).split(/\s+/).filter(Boolean)[0];
    if (snippetTerm && toLower(threadText).includes(snippetTerm)) {
      const entry = entries.find((item) => toLower(`${item.title || ''} ${item.body || ''}`).includes(snippetTerm));
      if (entry) {
        const body = toStr(entry.body || entry.title || '');
        const index = toLower(body).indexOf(snippetTerm);
        const start = Math.max(0, index - 70);
        snippet = (start > 0 ? '…' : '') + body.slice(start, start + 180).trim() + (body.length > start + 180 ? '…' : '');
      }
    }

    const values: Record<string, unknown> = {};
    for (const [path, value] of fields) values[path] = this.displayValue(value);

    return {
      row,
      fields,
      values,
      custom,
      searchText,
      snippet,
      threadId,
    };
  }

  private normalizeCriteria(input: any, bundle: SearchBundle): SearchCriterion[] {
    const criteria: SearchCriterion[] = [];
    const rawCriteria = input?.criteria;
    if (Array.isArray(rawCriteria)) {
      for (const item of rawCriteria) {
        if (!item || typeof item !== 'object') continue;
        const field = toStr(item.field || item.path || item.name);
        if (!field) continue;
        criteria.push({ field, operator: toStr(item.operator || item.method || item.op), value: item.value ?? item.search ?? '', value2: item.value2 ?? item.search2 ?? '' });
      }
    } else if (rawCriteria && typeof rawCriteria === 'object') {
      for (const [field, value] of Object.entries(rawCriteria)) criteria.push({ field, operator: 'equals', value });
    }

    const filters = input?.filters && typeof input.filters === 'object' ? input.filters : {};
    const dateFilters: Record<string, [string, string]> = {
      createdFrom: ['created', 'gte'],
      createdTo: ['created', 'lte'],
      updatedFrom: ['updated', 'gte'],
      updatedTo: ['updated', 'lte'],
      closedFrom: ['closed', 'gte'],
      closedTo: ['closed', 'lte'],
      dueFrom: ['duedate', 'gte'],
      dueTo: ['duedate', 'lte'],
    };
    for (const [key, value] of Object.entries(filters)) {
      if (!isSet(value)) continue;
      const mapped = dateFilters[key];
      if (mapped) criteria.push({ field: mapped[0], operator: mapped[1], value });
      else if (bundle.fieldByPath.has(key)) criteria.push({ field: key, operator: 'contains', value, legacy: true });
    }

    const quickFilters = input?.quickFilters;
    if (quickFilters && typeof quickFilters === 'object' && !Array.isArray(quickFilters)) {
      for (const [field, value] of Object.entries(quickFilters)) {
        if (!isSet(value)) continue;
        if (bundle.fieldByPath.has(field)) criteria.push({ field, operator: 'equals', value });
      }
    }
    if (isSet(input?.quickFilter) && isSet(input?.quickFilterValue) && bundle.fieldByPath.has(toStr(input.quickFilter))) {
      criteria.push({ field: toStr(input.quickFilter), operator: 'equals', value: input.quickFilterValue });
    }

    return criteria;
  }

  private fieldCandidates(value: FieldValue | undefined): string[] {
    if (!value) return [];
    return unique([toLower(value.raw), toLower(value.label), value.text].filter(Boolean));
  }

  private matchesCriterion(record: SearchRecord, definition: SearchFieldDef, criterion: SearchCriterion): boolean {
    const value = record.fields.get(definition.path);
    const raw = value?.raw;
    const operator = this.normalizeOperator(criterion.operator, definition.type);
    if (['set', 'not_set', 'empty', 'not_empty'].includes(operator)) {
      const present = definition.type === 'boolean' ? Boolean(raw) : isSet(raw);
      return operator === 'set' || operator === 'not_empty' ? present : !present;
    }
    const expected = criterion.value;
    if (!isSet(expected)) return true;
    const expectedText = toLower(expected);

    if (definition.path === 'queue_assignee') {
      const current = Array.isArray(raw) ? raw.map(toLower) : toLower(raw).split(/[\s,]+/).filter(Boolean);
      const expectedScopes = valueList(expected).map(toLower);
      const found = expectedScopes.some((scope) => current.includes(scope));
      return ['not_in', 'not_equals', 'not_contains'].includes(operator) ? !found : found;
    }

    // Legacy /tickets/advanced-search filters matched every field as a substring.
    if (criterion.legacy) {
      const candidates = this.fieldCandidates(value);
      return candidates.some((candidate) => candidate.includes(expectedText));
    }

    if (definition.type === 'date') {
      const actual = dateMs(raw);
      if (!Number.isFinite(actual)) return operator === 'not_equals';
      if (operator === 'between') {
        const start = dateBound(expected ?? (criterion.value2 as any), false);
        const end = dateBound(criterion.value2 ?? expected, true);
        return Number.isFinite(start) && Number.isFinite(end) && actual >= start && actual <= end;
      }
      if (operator === 'on') {
        const start = dateBound(expected, false);
        const end = dateBound(expected, true);
        return Number.isFinite(start) && Number.isFinite(end) && actual >= start && actual <= end;
      }
      const bound = dateBound(expected, operator === 'lte' || operator === 'before');
      if (!Number.isFinite(bound)) return true;
      if (operator === 'before' || operator === 'lt') return actual < bound;
      if (operator === 'after' || operator === 'gt') return actual > bound;
      if (operator === 'lte') return actual <= bound;
      if (operator === 'gte') return actual >= bound;
      if (operator === 'not_equals') return Math.abs(actual - bound) > 86400000;
      return Math.abs(actual - bound) <= 86400000;
    }

    if (definition.type === 'number') {
      const actual = numeric(raw);
      if (!Number.isFinite(actual)) return operator === 'not_equals';
      if (operator === 'between') {
        const start = numeric(expected);
        const end = numeric(criterion.value2);
        return Number.isFinite(start) && Number.isFinite(end) && actual >= start && actual <= end;
      }
      const target = numeric(expected);
      if (!Number.isFinite(target)) return true;
      if (operator === 'gt') return actual > target;
      if (operator === 'gte') return actual >= target;
      if (operator === 'lt') return actual < target;
      if (operator === 'lte') return actual <= target;
      if (operator === 'not_equals') return actual !== target;
      return actual === target;
    }

    if (definition.type === 'boolean') {
      const actual = Boolean(raw);
      const truthy = ['1', 'true', 'yes', 'y', 'on', 'set'].includes(expectedText);
      const falsy = ['0', 'false', 'no', 'n', 'off', 'not_set'].includes(expectedText);
      if (!truthy && !falsy) return true;
      return operator === 'not_equals' ? actual !== truthy : actual === truthy;
    }

    const candidates = this.fieldCandidates(value);
    if (!candidates.length) return ['not_equals', 'not_in', 'not_contains'].includes(operator);
    if (operator === 'in' || operator === 'not_in') {
      const list = valueList(expected).map(toLower);
      const found = list.some((item) => candidates.some((candidate) => candidate === item || candidate.split(' ').includes(item)));
      return operator === 'in' ? found : !found;
    }
    if (operator === 'contains') return candidates.some((candidate) => candidate.includes(expectedText));
    if (operator === 'not_contains') return !candidates.some((candidate) => candidate.includes(expectedText));
    if (operator === 'starts_with') return candidates.some((candidate) => candidate.startsWith(expectedText));
    if (operator === 'ends_with') return candidates.some((candidate) => candidate.endsWith(expectedText));
    if (operator === 'not_equals') return !candidates.some((candidate) => candidate === expectedText || candidate.split(' ').includes(expectedText));
    return candidates.some((candidate) => candidate === expectedText || candidate.split(' ').includes(expectedText));
  }

  private normalizeSort(input: any, bundle: SearchBundle): { field: string; direction: 'asc' | 'desc' } {
    if (typeof input === 'string' && bundle.fieldByPath.has(input)) return { field: input, direction: 'desc' };
    if (input && typeof input === 'object') {
      const field = toStr(input.field || input.path || input.name);
      if (bundle.fieldByPath.has(field)) return { field, direction: toLower(input.direction || input.dir) === 'asc' ? 'asc' : 'desc' };
    }
    return { field: 'updated', direction: 'desc' };
  }

  private compareValues(a: FieldValue | undefined, b: FieldValue | undefined, type: SearchFieldType): number {
    const aSet = isSet(a?.raw), bSet = isSet(b?.raw);
    if (!aSet && !bSet) return 0;
    if (!aSet) return 1;
    if (!bSet) return -1;
    if (type === 'number') {
      const left = numeric(a!.raw), right = numeric(b!.raw);
      return left === right ? 0 : left < right ? -1 : 1;
    }
    if (type === 'date') {
      const left = dateMs(a!.raw), right = dateMs(b!.raw);
      return left === right ? 0 : left < right ? -1 : 1;
    }
    if (type === 'boolean') return Number(Boolean(a!.raw)) - Number(Boolean(b!.raw));
    return toLower(a!.label).localeCompare(toLower(b!.label));
  }

  private async savedSearchConfig(queue: any): Promise<any> {
    const config = parseObject(queue.config);
    return {
      q: toStr(config.q ?? queue.search ?? ''),
      criteria: Array.isArray(config.criteria) ? config.criteria : [],
      columns: Array.isArray(config.columns) ? config.columns : [],
      sort: config.sort && typeof config.sort === 'object' ? config.sort : null,
      pageSize: Number(config.pageSize || 25),
      quickFilter: toStr(config.quickFilter ?? queue.filter ?? ''),
      settings: config.settings && typeof config.settings === 'object' ? config.settings : {},
      exportConfig: config.exportConfig && typeof config.exportConfig === 'object' ? config.exportConfig : {},
    };
  }

  private savedSearchView(queue: any, bundle: SearchBundle, staffId: number): any {
    const config = parseObject(queue.config);
    const linkedColumns = bundle.queueColumnLinks
      .filter((link) => toStr(link.queue_id) === toStr(queue.id))
      .map((link) => {
        const column = bundle.queueColumns.find((item) => toStr(item.id) === toStr(link.column_id));
        return column ? { path: toStr(column.name), label: toStr(column.heading || column.name), width: column.width ? Number(column.width) : undefined, sortable: true, sort: Number(link.sort) } : null;
      })
      .filter(Boolean);
    const configuredColumns = Array.isArray(config.columns) && config.columns.length ? config.columns : linkedColumns;
    const sortLinks = bundle.queueSortLinks.filter((link) => toStr(link.queue_id) === toStr(queue.id));
    const linkedSort = sortLinks.length
      ? bundle.queueSorts.find((item) => toStr(item.id) === toStr(sortLinks[0].sort_id))
      : null;
    const sortRecord = config.sort && typeof config.sort === 'object' ? config.sort : linkedSort ? { field: linkedSort.field, direction: 'desc' } : null;
    const queueConfigs = bundle.queueConfigs.filter((row) => toStr(row.queue_id) === toStr(queue.id));
    const agentConfig = queueConfigs.find((row) => toStr(row.key) === `staff:${staffId}`);
    const exportRow = bundle.queueExports.find((row) => toStr(row.queue_id) === toStr(queue.id));
    return {
      id: toStr(queue.id),
      title: queue.title || 'Untitled search',
      name: queue.title || 'Untitled search',
      parentId: toStr(queue.parent_id || 0),
      root: toStr(queue.root || 'Ticket'),
      filter: toStr(queue.filter || ''),
      sort: Number(queue.sort || 0),
      owner: Number(queue.staff_id || 0) === staffId,
      editable: Number(queue.staff_id || 0) === staffId,
      staffId: toStr(queue.staff_id || 0),
      createdAt: queue.created?.toISOString?.() || queue.created,
      updatedAt: queue.updated?.toISOString?.() || queue.updated,
      config: {
        q: toStr(config.q ?? ''),
        criteria: Array.isArray(config.criteria) ? config.criteria : [],
        columns: configuredColumns,
        sort: sortRecord,
        pageSize: Number(config.pageSize || 25),
        quickFilter: toStr(config.quickFilter ?? queue.filter ?? ''),
        settings: { ...(parseObject(config.settings)), ...(parseObject(agentConfig?.value)) },
        exportConfig: parseObject(exportRow?.config || config.exportConfig),
      },
      columns: configuredColumns,
      sorting: linkedSort ? [{ id: toStr(linkedSort.id), name: linkedSort.name, field: linkedSort.field, sort: Number(sortLinks[0].sort || 0) }] : [],
      exportConfig: parseObject(exportRow?.config || config.exportConfig),
    };
  }

  async options(staffId: number) {
    const bundle = await this.loadBundle('');
    const savedSearches = bundle.queues
      .filter((queue) => Number(queue.staff_id || 0) === staffId || Number(queue.staff_id || 0) === 0)
      .map((queue) => this.savedSearchView(queue, bundle, staffId));
    const fields = bundle.fields;
    const operators = Object.fromEntries(Object.entries(OPERATORS_BY_TYPE).map(([type, values]) => [type, values.map((value) => ({ value, label: OPERATOR_LABELS[value] || value }))]));
    const agentSettings = bundle.queueConfigs.find((row) => toStr(row.queue_id) === '0' && toStr(row.key) === `staff:${staffId}`);
    const settings = parseObject(agentSettings?.value);
    return {
      fields,
      operators,
      columns: fields.map((field) => ({ path: field.path, label: field.label, type: field.type, group: field.group, options: field.options })),
      sorts: fields.map((field) => ({ path: field.path, label: field.label, type: field.type, group: field.group })),
      quickFilters: QUICK_FILTERS.map((path) => {
        const field = bundle.fieldByPath.get(path);
        return field ? { path, label: field.label, options: field.options || [] } : null;
      }).filter(Boolean),
      statuses: unique(bundle.statuses.map((row) => toStr(row.state || row.name).toLocaleLowerCase())).map((state) => {
        const row = bundle.statuses.find((status) => toStr(status.state || status.name).toLocaleLowerCase() === state);
        return { id: toStr(row?.id || ''), name: row?.name || state, state };
      }),
      departments: bundle.departments.map((row) => ({ id: toStr(row.id), name: row.name })),
      topics: bundle.topics.map((row) => ({ id: toStr(row.topic_id), name: row.topic, deptId: toStr(row.dept_id) })),
      priorities: bundle.priorities.map((row) => toStr(row.priority).toLocaleLowerCase()),
      agents: bundle.staff.map((row) => ({ id: toStr(row.staff_id), name: [row.firstname, row.lastname].filter(Boolean).join(' ') || row.username || row.email || '', email: row.email || '' })),
      teams: bundle.teams.map((row) => ({ id: toStr(row.team_id), name: row.name })),
      slas: bundle.slas.map((row) => ({ id: toStr(row.id), name: row.name })),
      branches: bundle.branches.map((row) => ({ id: toStr(row.id), name: row.name })),
      organizations: [...bundle.organizations.values()].map((row) => ({ id: toStr(row.id), name: bundle.organizationCdata.get(toStr(row.id))?.name || row.name })),
      sources: [
        { id: 'web', name: 'Web' },
        { id: 'email', name: 'Email' },
        { id: 'phone', name: 'Phone' },
        { id: 'api', name: 'API' },
        { id: 'other', name: 'Other' },
      ],
      defaults: {
        columns: DEFAULT_COLUMNS.map((path) => fields.find((field) => field.path === path)).filter(Boolean),
        sort: { field: 'updated', direction: 'desc' },
        pageSize: 25,
        settings: {},
      },
      settings,
      savedSearches,
    };
  }

  private async searchWithBundle(input: any, bundle: SearchBundle, staffId: number) {
    let effectiveInput = input && typeof input === 'object' ? input : {};
    if (isSet(effectiveInput.savedSearchId)) {
      const queue = bundle.queues.find((row) => toStr(row.id) === toStr(effectiveInput.savedSearchId) && (Number(row.staff_id || 0) === staffId || Number(row.staff_id || 0) === 0));
      if (queue) {
        const savedConfig = parseObject(queue.config);
        effectiveInput = { ...savedConfig, ...effectiveInput, criteria: Array.isArray(effectiveInput.criteria) ? effectiveInput.criteria : savedConfig.criteria || [] };
      }
    }
    const keyword = toStr(effectiveInput.q || effectiveInput.keyword || '').trim();
    const terms = keyword.split(/\s+/).map(toLower).filter(Boolean);
    const criteria = this.normalizeCriteria(effectiveInput, bundle);
    const sort = this.normalizeSort(effectiveInput.sort, bundle);

    let records = bundle.tickets.map((row) => this.buildRecord(row, bundle, keyword, staffId));
    if (terms.length) {
      records = records.filter((record) => terms.every((term) => record.searchText.includes(term)));
      if (keyword && records.some((record) => !record.snippet)) {
        // Snippet generation is based on the first matching thread entry. The content may be in the search index.
        for (const record of records) {
          if (record.snippet) continue;
          const indexText = bundle.searchIndexByTicket.get(toStr(record.row.ticket_id)) || '';
          if (indexText) {
            const lowerIndex = toLower(indexText);
            const index = lowerIndex.indexOf(terms[0]);
            if (index >= 0) {
              const start = Math.max(0, index - 70);
              record.snippet = (start > 0 ? '…' : '') + indexText.slice(start, start + 180).trim() + (indexText.length > start + 180 ? '…' : '');
            }
          }
        }
      }
    }

    if (criteria.length) {
      records = records.filter((record) => criteria.every((criterion) => {
        const definition = bundle.fieldByPath.get(criterion.field);
        return definition ? this.matchesCriterion(record, definition, criterion) : true;
      }));
    }

    records.sort((left, right) => {
      const definition = bundle.fieldByPath.get(sort.field);
      const result = this.compareValues(left.fields.get(sort.field), right.fields.get(sort.field), definition?.type || 'text');
      if (result !== 0) return sort.direction === 'asc' ? result : -result;
      const leftId = Number(left.row.ticket_id || 0), rightId = Number(right.row.ticket_id || 0);
      return rightId - leftId;
    });

    const total = records.length;
    const requestedPageSize = Number(effectiveInput.pageSize ?? effectiveInput.limit ?? 25);
    const pageSize = Math.max(1, Math.min(200, Number.isFinite(requestedPageSize) ? requestedPageSize : 25));
    const requestedPage = Number(effectiveInput.page ?? 1);
    const pages = Math.ceil(total / pageSize);
    const page = Math.max(1, Math.min(Math.max(1, pages || 1), Number.isFinite(requestedPage) ? requestedPage : 1));
    const pageRecords = records.slice((page - 1) * pageSize, page * pageSize);
    const columnPaths = Array.isArray(effectiveInput.columns)
      ? effectiveInput.columns.map((column: any) => typeof column === 'string' ? column : toStr(column?.path || column?.field)).filter((path: string) => path && bundle.fieldByPath.has(path))
      : DEFAULT_COLUMNS.filter((path) => bundle.fieldByPath.has(path));
    const columns = columnPaths.map((path: string) => {
      const definition = bundle.fieldByPath.get(path)!;
      return { path, label: definition.label, type: definition.type, group: definition.group, options: definition.options };
    });

    const tickets = pageRecords.map((record) => this.resultRow(record, bundle));
    return {
      tickets,
      total,
      page,
      pageSize,
      pages,
      sort,
      columns,
      criteria,
      keyword,
      savedSearchId: isSet(effectiveInput.savedSearchId) ? toStr(effectiveInput.savedSearchId) : '',
      tookMs: 0,
    };
  }

  private resultRow(record: SearchRecord, bundle: SearchBundle) {
    const maps = this.lookupMaps(bundle);
    const row = record.row;
    const data = bundle.ticketCdata.get(toStr(row.ticket_id)) || {};
    const user = bundle.users.get(toStr(row.user_id));
    const userEmail = bundle.userEmails.get(toStr(row.user_email_id)) || (user ? bundle.defaultEmailByUser.get(toStr(user.id)) : null);
    const status = maps.statusById.get(toStr(row.status_id));
    const department = maps.departmentById.get(toStr(row.dept_id));
    const topic = maps.topicById.get(toStr(row.topic_id));
    const assignee = maps.staffById.get(toStr(row.staff_id));
    const team = maps.teamById.get(toStr(row.team_id));
    const sla = maps.slaById.get(toStr(row.sla_id));
    const branch = maps.branchById.get(toStr(data.branch_id));
    const org = user ? bundle.organizations.get(toStr(user.org_id)) : null;
    const orgData = org ? bundle.organizationCdata.get(toStr(org.id)) : null;
    return {
      id: toStr(row.ticket_id),
      number: toStr(row.number || row.ticket_id),
      subject: toStr(data.subject || '(no subject)'),
      status: toLower(status?.state || status?.name || 'open'),
      statusName: status?.name || status?.state || 'Open',
      priority: toLower(data.priority || 'normal'),
      source: toLower(row.source),
      department: department?.name || '',
      departmentId: toStr(row.dept_id),
      topic: topic?.topic || '',
      topicId: toStr(row.topic_id),
      requesterName: user?.name || '',
      requesterEmail: userEmail?.address || '',
      requesterId: toStr(row.user_id),
      assignee: assignee ? [assignee.firstname, assignee.lastname].filter(Boolean).join(' ') || assignee.username || assignee.email || '' : 'Unassigned',
      assigneeEmail: assignee?.email || '',
      assigneeStaffId: toStr(row.staff_id || 0),
      team: team?.name || '',
      teamId: toStr(row.team_id || 0),
      sla: sla?.name || '',
      slaId: toStr(row.sla_id || 0),
      branchId: toStr(data.branch_id || 0),
      branchName: branch?.name || '',
      employeeId: toStr(data.employee_id || ''),
      org: orgData?.name || org?.name || '',
      orgId: toStr(user?.org_id || 0),
      overdue: Boolean(row.isoverdue),
      answered: Boolean(row.isanswered),
      assigned: Number(row.staff_id || 0) > 0,
      createdAt: row.created?.toISOString?.() || row.created,
      updatedAt: row.updated?.toISOString?.() || row.updated,
      dueAt: row.duedate?.toISOString?.() || null,
      estDueAt: row.est_duedate?.toISOString?.() || null,
      closedAt: row.closed?.toISOString?.() || null,
      lastUpdate: row.lastupdate?.toISOString?.() || null,
      threadCount: record.fields.get('thread_count')?.raw || 0,
      attachmentCount: record.fields.get('attachment_count')?.raw || 0,
      collaboratorCount: record.fields.get('collaborator_count')?.raw || 0,
      snippet: record.snippet,
      values: record.values,
      custom: record.custom,
    };
  }

  private ensureQueueFields(bundle: SearchBundle) {
    if (bundle.fieldByPath.has('queue_assignee')) return;
    const field: SearchFieldDef = {
      path: 'queue_assignee',
      label: 'Assignee Scope',
      type: 'select',
      group: 'Ticket',
      options: [
        { value: 'me', label: 'Me' },
        { value: 'team', label: 'One of my teams' },
      ],
    };
    bundle.fields.push(field);
    bundle.fieldByPath.set(field.path, field);
  }

  private queueValueTokens(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(toStr).filter((item) => item !== '');
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>);
    return toStr(value).split(',').map((item) => item.trim()).filter(Boolean);
  }

  private mapQueueField(path: string): string {
    const raw = toLower(path).replace(/__/g, '.');
    const aliases: Record<string, string> = {
      'status.state': 'status',
      'status.id': 'status',
      'status.name': 'status',
      'status_id': 'status',
      'status': 'status',
      'cdata.priority': 'priority',
      'cdata.subject': 'subject',
      'cdata.branch_id': 'branch',
      'cdata.employee_id': 'employee_id',
      'dept_id': 'department',
      'department_id': 'department',
      'topic_id': 'topic',
      'staff_id': 'assignee',
      'team_id': 'team',
      'sla_id': 'sla',
      'branch_id': 'branch',
      'ticket_id': 'number',
      'number': 'number',
      'user.name': 'requester',
      'user.emails.address': 'email',
      'user.email': 'email',
      'merged': 'ismerged',
    };
    if (aliases[raw]) return aliases[raw];
    if (raw.startsWith('cdata.')) return raw.slice('cdata.'.length);
    if (raw.startsWith('user.')) {
      const tail = raw.slice('user.'.length);
      if (tail.includes('email')) return 'email';
      if (tail === 'name') return 'requester';
      if (tail.includes('org')) return tail.endsWith('_id') || tail.endsWith('.id') ? 'org' : 'org_name';
      return tail;
    }
    return raw.split('.').pop() || raw;
  }

  private mapQueueOperator(method: unknown): string {
    const raw = toLower(method).replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
      includes: 'in',
      include: 'in',
      '!_includes': 'not_in',
      '!includes': 'not_in',
      nincludes: 'not_in',
      excludes: 'not_in',
      set: 'set',
      nset: 'not_set',
      not_set: 'not_set',
      equals: 'equals',
      equal: 'equals',
      eq: 'equals',
      is: 'equals',
      not: 'not_equals',
      ne: 'not_equals',
      neq: 'not_equals',
      '!equals': 'not_equals',
      like: 'contains',
      contains: 'contains',
      nlike: 'not_contains',
      not_contains: 'not_contains',
      starts: 'starts_with',
      startswith: 'starts_with',
      ends: 'ends_with',
      endswith: 'ends_with',
      gt: 'gt',
      greater: 'gt',
      gte: 'gte',
      lt: 'lt',
      less: 'lt',
      lte: 'lte',
      between: 'between',
      within: 'between',
      period: 'period',
    };
    return aliases[raw] || raw || 'equals';
  }

  private queuePeriodRange(value: unknown): [string, string] | null {
    const period = toLower(value).trim();
    if (!period) return null;
    const now = new Date();
    const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const addDays = (date: Date, days: number) => {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + days);
      return next;
    };
    const addMonths = (date: Date, months: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
    const today = startOfDay(now);
    const day = (today.getUTCDay() + 6) % 7;
    const monday = addDays(today, -day);
    const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const firstOfYear = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    let start: Date;
    let end: Date;
    switch (period) {
      case 'td': start = today; end = addDays(today, 1); break;
      case 'yd': start = addDays(today, -1); end = today; break;
      case 'tw': start = monday; end = addDays(monday, 7); break;
      case 'lw': start = addDays(monday, -7); end = monday; break;
      case 'tm': start = firstOfMonth; end = addMonths(firstOfMonth, 1); break;
      case 'lm': start = addMonths(firstOfMonth, -1); end = firstOfMonth; break;
      case 'ty': start = firstOfYear; end = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1)); break;
      case 'ly': start = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)); end = firstOfYear; break;
      default: return null;
    }
    return [start.toISOString().slice(0, 10), addDays(end, -1).toISOString().slice(0, 10)];
  }

  private queueAssigneeCriteria(method: unknown, value: unknown): SearchCriterion[] {
    const operator = this.mapQueueOperator(method);
    const tokens = this.queueValueTokens(value).map(toLower).map((token) => token === 'm' ? 'me' : token === 't' ? 'team' : token);
    const scopes = tokens.filter((token) => token === 'me' || token === 'team');
    if (scopes.length) return [{ field: 'queue_assignee', operator: operator.startsWith('not') ? 'not_in' : 'in', value: scopes.join(',') }];
    const ids = tokens.filter((token) => /^\d+$/.test(token));
    if (!ids.length) return [];
    return [{ field: 'assignee', operator: operator === 'not_in' || operator === 'not_equals' ? 'not_in' : 'in', value: ids.join(',') }];
  }

  private queueCriterion(path: string, method: unknown, value: unknown, bundle: SearchBundle): SearchCriterion[] {
    if (path === ':keywords') return [];
    if (toLower(path) === 'assignee') return this.queueAssigneeCriteria(method, value);
    const field = this.mapQueueField(path);
    const operator = this.mapQueueOperator(method);
    if (operator === 'period') {
      const range = this.queuePeriodRange(value);
      return range ? [{ field, operator: 'between', value: range[0], value2: range[1] }] : [];
    }
    let tokens = this.queueValueTokens(value);
    if (toLower(path).replace(/__/g, '.') === 'status.id') {
      tokens = tokens.map((id) => toLower(bundle.statusById.get(id)?.state || bundle.statusById.get(id)?.name || '')).filter(Boolean);
    }
    if (operator === 'set' || operator === 'not_set') return [{ field, operator }];
    if (operator === 'in' || operator === 'not_in') return [{ field, operator, value: tokens.join(',') }];
    if (operator === 'between') return [{ field, operator, value: tokens[0] ?? '', value2: tokens[1] ?? '' }];
    return [{ field, operator, value: tokens.length > 1 ? tokens.join(',') : (tokens[0] ?? '') }];
  }

  private queueCriteriaFromItems(items: unknown, bundle: SearchBundle, keyword = ''): { criteria: SearchCriterion[]; keyword: string } {
    const criteria: SearchCriterion[] = [];
    let searchKeyword = keyword;
    if (!Array.isArray(items)) return { criteria, keyword: searchKeyword };
    for (const item of items) {
      if (Array.isArray(item)) {
        const [path, method, value] = item;
        const field = toStr(path);
        if (!field) continue;
        if (field === ':keywords') {
          searchKeyword = [searchKeyword, toStr(value)].filter(Boolean).join(' ');
          continue;
        }
        criteria.push(...this.queueCriterion(field, method, value, bundle));
      } else if (item && typeof item === 'object') {
        const field = toStr((item as any).field || (item as any).path || (item as any).name);
        if (!field) continue;
        const method = (item as any).operator || (item as any).method || (item as any).op || 'equals';
        const value = (item as any).value ?? (item as any).search ?? '';
        const converted = this.queueCriterion(field, method, value, bundle);
        if ((item as any).value2 !== undefined) converted.forEach((criterion) => { criterion.value2 = (item as any).value2; });
        criteria.push(...converted);
      }
    }
    return { criteria, keyword: searchKeyword };
  }

  private queueConfigFromRow(queue: any, bundle: SearchBundle): { criteria: SearchCriterion[]; keyword: string; columns: any[]; sort: { field: string; direction: 'asc' | 'desc' } | null; pageSize?: number } {
    const parsed = parseJson(queue.config, null);
    let items: unknown[] = [];
    let keyword = '';
    let columns: any[] = [];
    let sort: { field: string; direction: 'asc' | 'desc' } | null = null;
    let pageSize: number | undefined;
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray((parsed as any).criteria)) items = (parsed as any).criteria;
      keyword = toStr((parsed as any).q ?? (parsed as any).keyword ?? '');
      if (Array.isArray((parsed as any).columns)) columns = this.normalizeColumnInput((parsed as any).columns);
      if ((parsed as any).sort && typeof (parsed as any).sort === 'object') {
        const field = toStr((parsed as any).sort.field || (parsed as any).sort.path);
        if (field) sort = { field, direction: toLower((parsed as any).sort.direction || (parsed as any).sort.dir) === 'asc' ? 'asc' : 'desc' };
      }
      if (Number((parsed as any).pageSize) > 0) pageSize = Number((parsed as any).pageSize);
    }
    const converted = this.queueCriteriaFromItems(items, bundle, keyword);

    if (!columns.length) {
      for (const link of bundle.queueColumnLinks.filter((row) => toStr(row.queue_id) === toStr(queue.id))) {
        const column = bundle.queueColumns.find((row) => toStr(row.id) === toStr(link.column_id));
        if (!column) continue;
        const path = this.mapQueueField(toStr(column.name));
        if (!path) continue;
        columns.push({ path, label: toStr(column.heading || column.name), width: Number(column.width) || undefined, sortable: true });
      }
    }

    if (!sort) {
      const link = bundle.queueSortLinks.find((row) => toStr(row.queue_id) === toStr(queue.id));
      const row = link ? bundle.queueSorts.find((item) => toStr(item.id) === toStr(link.sort_id)) : null;
      const field = row ? this.mapQueueField(toStr(row.field)) : '';
      if (field) sort = { field, direction: 'desc' };
    }

    return { ...converted, columns, sort, pageSize };
  }

  private queueConfigChain(queue: any, bundle: SearchBundle, seen = new Set<string>()): { criteria: SearchCriterion[]; keyword: string; columns: any[]; sort: { field: string; direction: 'asc' | 'desc' } | null; pageSize?: number } {
    const id = toStr(queue.id);
    if (seen.has(id)) return { criteria: [], keyword: '', columns: [], sort: null };
    seen.add(id);
    const own = this.queueConfigFromRow(queue, bundle);
    const flags = Number(queue.flags || 0);
    const inherits = Boolean(flags & (QUEUE_FLAG_INHERIT_CRITERIA | QUEUE_FLAG_INHERIT_COLUMNS | QUEUE_FLAG_INHERIT_SORTING));
    const parent = inherits && queue.parent_id ? bundle.queues.find((row) => toStr(row.id) === toStr(queue.parent_id)) : null;
    const parentConfig = parent ? this.queueConfigChain(parent, bundle, seen) : null;
    return {
      criteria: [...((flags & QUEUE_FLAG_INHERIT_CRITERIA && parentConfig) ? parentConfig.criteria : []), ...own.criteria],
      keyword: [parentConfig && (flags & QUEUE_FLAG_INHERIT_CRITERIA) ? parentConfig.keyword : '', own.keyword].filter(Boolean).join(' '),
      columns: (flags & QUEUE_FLAG_INHERIT_COLUMNS && parentConfig?.columns.length) ? parentConfig.columns : own.columns,
      sort: (flags & QUEUE_FLAG_INHERIT_SORTING && parentConfig?.sort) ? parentConfig.sort : own.sort,
      pageSize: own.pageSize || parentConfig?.pageSize,
    };
  }

  private queueCriteriaFromAppQueue(items: unknown): SearchCriterion[] {
    const criteria: SearchCriterion[] = [];
    if (!Array.isArray(items)) return criteria;
    const fieldMap: Record<string, string> = {
      status: 'status',
      priority: 'priority',
      deptId: 'department',
      topicId: 'topic',
      source: 'source',
      overdue: 'isoverdue',
    };
    const operatorMap: Record<string, string> = { eq: 'equals', neq: 'not_equals', in: 'in', empty: 'empty', notempty: 'not_empty' };
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const sourceField = toStr((item as any).field);
      const field = fieldMap[sourceField] || sourceField;
      const operator = operatorMap[toStr((item as any).op)] || 'equals';
      const value = (item as any).value ?? '';
      if (sourceField === 'assignee') {
        const tokens = this.queueValueTokens(value);
        if (tokens.some((token) => toLower(token) === 'mine')) criteria.push({ field: 'queue_assignee', operator: operator === 'not_equals' ? 'not_in' : 'in', value: 'me' });
        else if (tokens.some((token) => toLower(token) === 'unassigned')) criteria.push({ field: 'assignee', operator: 'equals', value: '0' });
        else criteria.push({ field: 'assignee', operator, value: tokens.join(',') });
        continue;
      }
      if (sourceField === 'overdue') {
        criteria.push({ field: 'isoverdue', operator: operator === 'not_equals' ? 'not_equals' : 'equals', value: toLower(value) === 'false' ? 'false' : 'true' });
        continue;
      }
      criteria.push({ field, operator, value: Array.isArray(value) ? value.join(',') : toStr(value) });
    }
    return criteria;
  }

  private queueAppSort(value: unknown): { field: string; direction: 'asc' | 'desc' } | null {
    const sorts: Record<string, { field: string; direction: 'asc' | 'desc' }> = {
      updatedDesc: { field: 'updated', direction: 'desc' },
      updatedAsc: { field: 'updated', direction: 'asc' },
      createdDesc: { field: 'created', direction: 'desc' },
      priorityDesc: { field: 'priority', direction: 'desc' },
      numberAsc: { field: 'number', direction: 'asc' },
    };
    return sorts[toStr(value)] || null;
  }

  private async resolveTicketQueue(queueId: string, bundle: SearchBundle, staffId: number) {
    const builtin = builtinTicketQueue(queueId);
    if (builtin) {
      return {
        id: builtin.id,
        title: builtin.title,
        parentId: builtin.parentId,
        filter: builtin.filter,
        root: builtin.root,
        flags: builtin.flags,
        sort: builtin.sort,
        builtin: true,
        criteria: builtin.criteria as SearchCriterion[],
        keyword: '',
        columns: builtin.columns.map((column) => ({ path: column.path, label: column.label, width: column.width, sortable: true })),
        sortBy: builtin.sortBy,
        pageSize: undefined,
      };
    }

    const row = bundle.queues.find((queue) => toStr(queue.id) === queueId);
    if (row) {
      const flags = Number(row.flags || 0);
      if (flags & QUEUE_FLAG_DISABLED && Number(row.staff_id || 0) !== staffId) throw new NotFoundException('Ticket queue not found.');
      if (Number(row.staff_id || 0) !== 0 && Number(row.staff_id || 0) !== staffId) throw new ForbiddenException('This ticket queue is private.');
      const root = toLower(row.root || 'T');
      if (root && !['t', 'ticket', 'tickets'].includes(root)) throw new NotFoundException('Ticket queue not found.');
      const config = this.queueConfigChain(row, bundle);
      return {
        id: toStr(row.id),
        title: row.title || 'Untitled queue',
        parentId: toStr(row.parent_id || ''),
        filter: toStr(row.filter || ''),
        root: row.root || 'T',
        flags,
        sort: Number(row.sort || 0),
        builtin: false,
        criteria: config.criteria,
        keyword: config.keyword,
        columns: config.columns,
        sortBy: config.sort,
        pageSize: config.pageSize,
      };
    }

    const saved = await this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_app_state', key: 'queues' } } });
    const appQueues = parseJson(saved?.value, []);
    const appQueue = Array.isArray(appQueues) ? appQueues.find((queue: any) => toStr(queue.id) === queueId) : null;
    if (appQueue && appQueue.enabled !== false) {
      return {
        id: toStr(appQueue.id),
        title: toStr(appQueue.title || 'Untitled queue'),
        parentId: toStr(appQueue.parentId || ''),
        filter: '',
        root: 'T',
        flags: 0x03,
        sort: Number(appQueue.sort || 0),
        builtin: false,
        criteria: this.queueCriteriaFromAppQueue(appQueue.criteria),
        keyword: '',
        columns: [],
        sortBy: this.queueAppSort(appQueue.sortBy),
        pageSize: undefined,
      };
    }

    throw new NotFoundException('Ticket queue not found.');
  }

  async queueSearch(queueId: string, input: any, staffId: number) {
    const requestedKeyword = toStr(input?.q || input?.keyword || '').trim();
    let bundle = await this.loadBundle(requestedKeyword);
    this.ensureQueueFields(bundle);
    const queue = await this.resolveTicketQueue(queueId, bundle, staffId);

    const keyword = [queue.keyword, requestedKeyword].filter(Boolean).join(' ');
    if (keyword && keyword !== requestedKeyword) {
      bundle = await this.loadBundle(keyword);
      this.ensureQueueFields(bundle);
    }

    const inputCriteria = Array.isArray(input?.criteria) ? input.criteria : [];
    const result = await this.searchWithBundle({
      ...input,
      q: keyword,
      criteria: [...queue.criteria, ...inputCriteria],
      columns: Array.isArray(input?.columns) && input.columns.length ? input.columns : queue.columns,
      sort: input?.sort ?? queue.sortBy ?? undefined,
      pageSize: input?.pageSize ?? queue.pageSize,
      savedSearchId: '',
    }, bundle, staffId);

    return {
      queue: {
        id: queue.id,
        title: queue.title,
        parentId: queue.parentId,
        filter: queue.filter,
        root: queue.root,
        flags: queue.flags,
        sort: queue.sort,
        builtin: queue.builtin,
        columns: result.columns,
        sortBy: result.sort,
      },
      ...result,
    };
  }

  async search(input: any, staffId: number) {
    const keyword = toStr(input?.q || input?.keyword || '').trim();
    const bundle = await this.loadBundle(keyword);
    return this.searchWithBundle(input || {}, bundle, staffId);
  }

  async listSaved(staffId: number) {
    const bundle = await this.loadBundle('');
    return bundle.queues
      .filter((queue) => Number(queue.staff_id || 0) === staffId || Number(queue.staff_id || 0) === 0)
      .map((queue) => this.savedSearchView(queue, bundle, staffId));
  }

  private normalizeColumnInput(columns: unknown): Array<{ path: string; label: string; width?: number; sortable?: boolean }> {
    if (!Array.isArray(columns)) return [];
    const result: Array<{ path: string; label: string; width?: number; sortable?: boolean }> = [];
    const seen = new Set<string>();
    for (const column of columns) {
      let normalized: { path: string; label: string; width?: number; sortable?: boolean } | null = null;
      if (typeof column === 'string') normalized = { path: column, label: column, sortable: true };
      else if (column && typeof column === 'object') {
        const path = toStr((column as any).path || (column as any).field || (column as any).name);
        if (path) normalized = { path, label: toStr((column as any).label || (column as any).heading || path), width: Number((column as any).width) || undefined, sortable: (column as any).sortable !== false };
      }
      if (!normalized || seen.has(normalized.path)) continue;
      seen.add(normalized.path);
      result.push(normalized);
    }
    return result;
  }

  private async syncSavedSearchRelations(tx: any, queueId: bigint, config: any) {
    const columns = this.normalizeColumnInput(config.columns);
    await tx.queueColumns.deleteMany({ where: { queue_id: queueId } });
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      let definition = await tx.queueColumn.findFirst({ where: { name: column.path, heading: column.label } });
      if (!definition) {
        definition = await tx.queueColumn.create({
          data: { name: column.path, heading: column.label, width: column.width ? String(column.width) : null, sort: BigInt(index) },
        });
      }
      await tx.queueColumns.create({ data: { queue_id: queueId, column_id: definition.id, sort: BigInt(index) } });
    }

    await tx.queueSorts.deleteMany({ where: { queue_id: queueId } });
    const sort = config.sort && typeof config.sort === 'object' ? config.sort : null;
    if (sort && isSet(sort.field)) {
      let definition = await tx.queueSort.findFirst({ where: { field: toStr(sort.field) } });
      if (!definition) {
        definition = await tx.queueSort.create({ data: { field: toStr(sort.field), name: toStr(sort.label || sort.field), sort: 0n } });
      }
      await tx.queueSorts.create({ data: { queue_id: queueId, sort_id: definition.id, sort: 0n } });
    }

    await tx.queueExport.deleteMany({ where: { queue_id: queueId } });
    await tx.queueExport.create({ data: { queue_id: queueId, config: JSON.stringify(config.exportConfig && typeof config.exportConfig === 'object' ? config.exportConfig : {}) } });
  }

  private configFromInput(input: any) {
    const config = {
      q: toStr(input.q || ''),
      criteria: Array.isArray(input.criteria) ? input.criteria : [],
      columns: this.normalizeColumnInput(input.columns),
      sort: input.sort && typeof input.sort === 'object' ? input.sort : null,
      pageSize: Math.max(1, Math.min(200, Number(input.pageSize) || 25)),
      quickFilter: toStr(input.quickFilter || ''),
      settings: input.settings && typeof input.settings === 'object' ? input.settings : {},
      exportConfig: input.exportConfig && typeof input.exportConfig === 'object' ? input.exportConfig : {},
    };
    return config;
  }

  private async saveAgentSettings(staffId: number, queueId: bigint, settings: unknown) {
    const key = `staff:${staffId}`;
    const value = JSON.stringify(settings && typeof settings === 'object' ? settings : {});
    const existing = await this.prisma.queueConfig.findFirst({ where: { queue_id: queueId, key } });
    if (existing) await this.prisma.queueConfig.update({ where: { id: existing.id }, data: { value } });
    else await this.prisma.queueConfig.create({ data: { queue_id: queueId, key, value } });
  }

  async createSaved(input: any, staffId: number) {
    const title = toStr(input?.title || input?.name).trim().slice(0, 60);
    if (!title) throw new BadRequestException('Search title is required.');
    const config = this.configFromInput(input);
    const queue = await this.prisma.$transaction(async (tx) => {
      const maxSort = await tx.queue.aggregate({ _max: { sort: true } });
      const created = await tx.queue.create({
        data: {
          parent_id: BigInt(toStr(input?.parentId || 0)),
          staff_id: BigInt(staffId),
          flags: 1n,
          sort: (maxSort._max.sort || 0n) + 1n,
          title,
          config: JSON.stringify(config),
          filter: config.quickFilter || null,
          root: 'Ticket',
          path: '/',
          created: new Date(),
          updated: new Date(),
        },
      });
      await this.syncSavedSearchRelations(tx, created.id, config);
      return created;
    });
    await this.saveAgentSettings(staffId, queue.id, config.settings);
    return this.getSaved(queue.id, staffId);
  }

  async updateSaved(id: string, input: any, staffId: number) {
    const existing = await this.prisma.queue.findUnique({ where: { id: BigInt(id) } });
    if (!existing) throw new NotFoundException('Saved search not found.');
    if (Number(existing.staff_id || 0) !== staffId) throw new ForbiddenException('Only the owner can change this saved search.');
    const title = toStr(input?.title || input?.name || existing.title).trim().slice(0, 60);
    if (!title) throw new BadRequestException('Search title is required.');
    const config = this.configFromInput({
      ...parseObject(existing.config),
      ...input,
      columns: input?.columns ?? parseObject(existing.config).columns,
    });
    const queue = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.queue.update({
        where: { id: existing.id },
        data: {
          parent_id: BigInt(toStr(input?.parentId ?? existing.parent_id ?? 0)),
          title,
          config: JSON.stringify(config),
          filter: config.quickFilter || null,
          updated: new Date(),
        },
      });
      await this.syncSavedSearchRelations(tx, updated.id, config);
      return updated;
    });
    await this.saveAgentSettings(staffId, queue.id, config.settings);
    return this.getSaved(queue.id, staffId);
  }

  async deleteSaved(id: string, staffId: number) {
    const existing = await this.prisma.queue.findUnique({ where: { id: BigInt(id) } });
    if (!existing) throw new NotFoundException('Saved search not found.');
    if (Number(existing.staff_id || 0) !== staffId) throw new ForbiddenException('Only the owner can delete this saved search.');
    await this.prisma.$transaction(async (tx) => {
      await tx.queueColumns.deleteMany({ where: { queue_id: existing.id } });
      await tx.queueSorts.deleteMany({ where: { queue_id: existing.id } });
      await tx.queueExport.deleteMany({ where: { queue_id: existing.id } });
      await tx.queueConfig.deleteMany({ where: { queue_id: existing.id } });
      await tx.queue.delete({ where: { id: existing.id } });
    });
    return { deleted: true };
  }

  async getSaved(id: bigint | string | number, staffId: number) {
    const bundle = await this.loadBundle('');
    const queue = bundle.queues.find((row) => toStr(row.id) === toStr(id));
    if (!queue) throw new NotFoundException('Saved search not found.');
    if (Number(queue.staff_id || 0) !== staffId && Number(queue.staff_id || 0) !== 0) throw new ForbiddenException('This saved search is private.');
    return this.savedSearchView(queue, bundle, staffId);
  }

  async saveSettings(input: any, staffId: number) {
    const queueId = BigInt(toStr(input?.queueId || 0));
    const settings = input?.settings && typeof input.settings === 'object' ? input.settings : {};
    await this.saveAgentSettings(staffId, queueId, settings);
    return { saved: true, settings };
  }
}
