import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiSecurityService } from '../common/api-security.service';
import { MailService } from '../mail/mail.service';

const bi = (value: unknown) => BigInt(String(value ?? 0));
const idOrZero = (value: unknown) => (/^\d+$/.test(String(value ?? '')) ? BigInt(String(value)) : 0n);
const parseJson = (value: string | null | undefined) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

const TASK_FLAG_OPEN = 0x0001;
const TASK_FLAG_OVERDUE = 0x0002;

const THREAD_TYPE = 'A';
const ENTRY_FLAG_ORIGINAL = 0x0001;

const EVENT_CREATED = 1;
const EVENT_CLOSED = 2;
const EVENT_REOPENED = 3;
const EVENT_ASSIGNED = 4;
const EVENT_RELEASED = 5;
const EVENT_TRANSFERRED = 6;
const EVENT_OVERDUE = 8;
const EVENT_EDITED = 9;
const EVENT_COLLABORATOR = 12;
const EVENT_DELETED = 14;

const EVENT_NAMES = new Map<number, string>([
  [EVENT_CREATED, 'created'],
  [EVENT_CLOSED, 'closed'],
  [EVENT_REOPENED, 'reopened'],
  [EVENT_ASSIGNED, 'assigned'],
  [EVENT_RELEASED, 'released'],
  [EVENT_TRANSFERRED, 'transferred'],
  [EVENT_OVERDUE, 'overdue'],
  [EVENT_EDITED, 'edited'],
  [EVENT_COLLABORATOR, 'collab'],
  [EVENT_DELETED, 'deleted'],
]);

const TASK_PERMISSIONS = [
  'task.create',
  'task.edit',
  'task.assign',
  'task.transfer',
  'task.reply',
  'task.close',
  'task.delete',
] as const;
type TaskPermission = typeof TASK_PERMISSIONS[number];
const ALL_TASK_PERMISSIONS = new Set<string>(TASK_PERMISSIONS);

type Actor = {
  staff: any;
  isAdmin: boolean;
  name: string;
  deptIds: Set<number>;
  teamIds: Set<number>;
  deptRoles: Map<number, number>;
  roles: Map<number, Set<string>>;
  globalPermissions: Set<string>;
};

type Upload = { originalname: string; mimetype: string; buffer: Buffer; size: number };

function isOpen(task: any) {
  return (Number(task.flags) & TASK_FLAG_OPEN) !== 0;
}

function isOverdue(task: any) {
  if (!isOpen(task)) return false;
  if ((Number(task.flags) & TASK_FLAG_OVERDUE) !== 0) return true;
  return Boolean(task.duedate && new Date(task.duedate).getTime() < Date.now());
}

function staffName(row: any) {
  return [row?.firstname, row?.lastname].filter(Boolean).join(' ') || row?.username || '';
}

function parsePermissions(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return new Set(parsed.map(String).filter(key => ALL_TASK_PERMISSIONS.has(key)));
    if (parsed && typeof parsed === 'object') {
      return new Set(Object.entries(parsed).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key).filter(key => ALL_TASK_PERMISSIONS.has(key)));
    }
  } catch { /* ignore malformed permission payloads */ }
  return new Set();
}

function sequenceDigitCount(format: string) {
  return (format.match(/(?<!\\)#/g) || []).length;
}

function formatSequenceNumber(format: string, value: string, padding = '0') {
  const source = format || '#';
  const groups = Array.from(source.matchAll(/(?<!\\)(#+)/g));
  const total = groups.reduce((sum, match) => sum + match[1].length, 0);
  const pad = padding || '0';
  let padded = String(value);
  while (padded.length < total) padded = pad + padded;
  let output = '';
  let start = 0;
  let offset = 0;
  for (const group of groups) {
    const index = group.index ?? 0;
    const size = group[1].length;
    output += source.slice(start, index).replace(/\\#/g, '#');
    output += padded.slice(offset, offset + size);
    start = index + size;
    offset += size;
  }
  // If the sequence value has more digits than the format has hashes, the
  // last group receives all remaining digits (matches osTicket Sequence::format).
  if (padded.length > offset) output += padded.slice(offset);
  output += source.slice(start).replace(/\\#/g, '#');
  return output;
}

@Injectable()
export class TasksService {
  private formCache: { form: any; titleField: any; descriptionField: any } | null = null;

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(ApiSecurityService) private security: ApiSecurityService,
    @Inject(MailService) private mail: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Actor / permissions
  // ---------------------------------------------------------------------------

  async actor(staffId: number): Promise<Actor> {
    const staff = await this.prisma.staff.findUnique({ where: { staff_id: staffId } });
    if (!staff || !Number(staff.isactive)) throw new UnauthorizedException('Active staff session required.');
    const [deptAccess, teamMembers, roles] = await Promise.all([
      this.prisma.staffDeptAccess.findMany({ where: { staff_id: staffId } }),
      this.prisma.teamMember.findMany({ where: { staff_id: BigInt(staffId) } }),
      this.prisma.role.findMany(),
    ]);
    const isAdmin = Boolean(Number(staff.isadmin));
    const deptRoles = new Map<number, number>();
    deptRoles.set(Number(staff.dept_id), Number(staff.role_id));
    for (const access of deptAccess) deptRoles.set(Number(access.dept_id), Number(access.role_id));
    const roleMap = new Map<number, Set<string>>();
    for (const role of roles) roleMap.set(Number(role.id), parsePermissions(role.permissions));
    const globalPermissions = new Set<string>();
    if (isAdmin) TASK_PERMISSIONS.forEach(permission => globalPermissions.add(permission));
    else {
      for (const roleId of deptRoles.values()) {
        const permissions = roleMap.get(roleId);
        if (permissions) permissions.forEach(permission => globalPermissions.add(permission));
      }
    }
    const deptIds = new Set<number>([Number(staff.dept_id), ...deptAccess.map(access => Number(access.dept_id))].filter(Boolean));
    return {
      staff,
      isAdmin,
      name: staffName(staff),
      deptIds,
      teamIds: new Set(teamMembers.map(member => Number(member.team_id))),
      deptRoles,
      roles: roleMap,
      globalPermissions,
    };
  }

  private permissionsForDept(actor: Actor, deptId: number): Set<string> {
    if (actor.isAdmin) return ALL_TASK_PERMISSIONS;
    const roleId = actor.deptRoles.get(deptId);
    return roleId ? actor.roles.get(roleId) || new Set() : new Set();
  }

  private hasDeptPermission(actor: Actor, deptId: number, permission: TaskPermission) {
    return actor.isAdmin || this.permissionsForDept(actor, deptId).has(permission);
  }

  private taskPermissions(actor: Actor, task: any) {
    const deptId = Number(task.dept_id);
    return {
      canEdit: this.hasDeptPermission(actor, deptId, 'task.edit'),
      canAssign: this.hasDeptPermission(actor, deptId, 'task.assign'),
      canTransfer: this.hasDeptPermission(actor, deptId, 'task.transfer'),
      canReply: this.hasDeptPermission(actor, deptId, 'task.reply'),
      canClose: this.hasDeptPermission(actor, deptId, 'task.close'),
      canDelete: this.hasDeptPermission(actor, deptId, 'task.delete'),
    };
  }

  private async assertTicketVisible(actor: Actor, ticketId: bigint) {
    const ticket = await this.prisma.ticket.findUnique({ where: { ticket_id: ticketId }, select: { ticket_id: true, dept_id: true, staff_id: true, team_id: true } });
    if (!ticket) throw new BadRequestException('Choose a valid ticket.');
    if (actor.isAdmin) return;
    const visible = Number(actor.staff.assigned_only)
      ? Number(ticket.staff_id) === Number(actor.staff.staff_id) || (Number(ticket.team_id) !== 0 && actor.teamIds.has(Number(ticket.team_id)))
      : actor.deptIds.has(Number(ticket.dept_id));
    if (!visible) throw new ForbiddenException('You do not have access to that ticket.');
  }

  private async canAccessTask(actor: Actor, task: any) {
    if (actor.isAdmin) return true;
    if (!Number(actor.staff.assigned_only) && actor.deptIds.has(Number(task.dept_id))) return true;
    if (isOpen(task) && Number(task.staff_id) === Number(actor.staff.staff_id)) return true;
    if (isOpen(task) && Number(task.team_id) && actor.teamIds.has(Number(task.team_id))) return true;
    if (task.object_type === 'T' && Number(task.object_id)) {
      const openStatuses = await this.prisma.ticketStatus.findMany({ where: { state: { equals: 'open', mode: 'insensitive' } }, select: { id: true } });
      const ticket = await this.prisma.ticket.findFirst({
        where: { ticket_id: task.object_id, staff_id: BigInt(actor.staff.staff_id), status_id: { in: openStatuses.map(status => status.id) } },
        select: { ticket_id: true },
      });
      if (ticket) return true;
    }
    return false;
  }

  private async assertAccess(actor: Actor, task: any) {
    if (!(await this.canAccessTask(actor, task))) throw new ForbiddenException('You do not have access to this task.');
  }

  private assertPermission(actor: Actor, task: any, permission: TaskPermission, message: string) {
    if (!this.hasDeptPermission(actor, Number(task.dept_id), permission)) throw new ForbiddenException(message);
  }

  // ---------------------------------------------------------------------------
  // Form / thread helpers
  // ---------------------------------------------------------------------------

  private async taskForm() {
    if (this.formCache) return this.formCache;
    const form = await this.prisma.form.findFirst({ where: { type: 'A' }, orderBy: { id: 'asc' } });
    if (!form) return null;
    const fields = await this.prisma.formField.findMany({ where: { form_id: form.id }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    this.formCache = {
      form,
      titleField: fields.find(field => field.name === 'title') || null,
      descriptionField: fields.find(field => field.name === 'description') || null,
    };
    return this.formCache;
  }

  private async saveFormValues(tx: any, taskId: bigint, values: { title?: string; description?: string }) {
    const formInfo = await this.taskForm();
    if (!formInfo) return;
    let entry = await tx.formEntry.findFirst({ where: { object_id: taskId, object_type: THREAD_TYPE, form_id: formInfo.form.id } });
    const timestamp = new Date();
    if (!entry) {
      entry = await tx.formEntry.create({ data: { form_id: formInfo.form.id, object_id: taskId, object_type: THREAD_TYPE, created: timestamp, updated: timestamp } });
    }
    const pairs: Array<[any, string | undefined]> = [
      [formInfo.titleField, values.title],
      [formInfo.descriptionField, values.description],
    ];
    for (const [field, value] of pairs) {
      if (!field || value === undefined) continue;
      await tx.formEntryValues.upsert({
        where: { entry_id_field_id: { entry_id: entry.id, field_id: field.id } },
        create: { entry_id: entry.id, field_id: field.id, value },
        update: { value },
      });
    }
    await tx.formEntry.update({ where: { id: entry.id }, data: { updated: timestamp } });
  }

  private async descriptionFor(taskId: bigint, threadId: bigint) {
    const formInfo = await this.taskForm();
    if (formInfo?.descriptionField) {
      const entry = await this.prisma.formEntry.findFirst({ where: { object_id: taskId, object_type: THREAD_TYPE, form_id: formInfo.form.id } });
      if (entry) {
        const value = await this.prisma.formEntryValues.findUnique({ where: { entry_id_field_id: { entry_id: entry.id, field_id: formInfo.descriptionField.id } } });
        if (value?.value) return value.value;
      }
    }
    const original = await this.prisma.threadEntry.findFirst({ where: { thread_id: threadId, type: 'M' }, orderBy: { created: 'asc' } });
    return original?.body || '';
  }

  private async threadFor(taskId: bigint) {
    return this.prisma.thread.upsert({
      where: { object_id_object_type: { object_id: taskId, object_type: THREAD_TYPE } },
      create: { object_id: taskId, object_type: THREAD_TYPE, created: new Date() },
      update: {},
    });
  }

  private async logEvent(tx: any, threadId: bigint, task: any, eventId: number, actor: Actor, data?: unknown) {
    await tx.threadEvent.create({
      data: {
        thread_id: threadId,
        thread_type: THREAD_TYPE,
        event_id: BigInt(eventId),
        staff_id: BigInt(actor.staff.staff_id),
        team_id: task.team_id || 0n,
        dept_id: task.dept_id || 0n,
        topic_id: 0n,
        username: actor.name || 'SYSTEM',
        uid: BigInt(actor.staff.staff_id),
        uid_type: 'S',
        data: data ? JSON.stringify(data).slice(0, 1024) : null,
        timestamp: new Date(),
      },
    });
  }

  private async saveAttachments(tx: any, entryId: bigint, uploads: Upload[], timestamp: Date) {
    if (uploads.length > 5 || uploads.some(file => file.size > 8 * 1024 * 1024)) throw new BadRequestException('You can attach up to five files of 8 MB each.');
    let total = 0;
    for (const upload of uploads) {
      const filename = String(upload.originalname || 'attachment').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 255);
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (!['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'zip'].includes(ext)) throw new BadRequestException('Unsupported attachment type.');
      total += upload.size;
      const file = await tx.file.create({ data: { name: filename, type: /^[\w.+-]+\/[\w.+-]+$/.test(upload.mimetype) ? upload.mimetype : 'application/octet-stream', size: BigInt(upload.size), key: randomBytes(32).toString('hex'), signature: createHash('sha256').update(upload.buffer).digest('hex'), created: timestamp } });
      await tx.fileChunk.create({ data: { file_id: file.id, chunk_id: 0, filedata: Uint8Array.from(upload.buffer) } });
      await tx.attachment.create({ data: { object_id: entryId, type: 'H', file_id: file.id, name: filename } });
    }
    if (total > 15 * 1024 * 1024) throw new BadRequestException('Combined attachments are too large.');
  }

  private async ensureUser(name: string, email: string) {
    const old = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } } });
    if (old) return old.user_id;
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { name, created: new Date(), updated: new Date() } });
      const address = await tx.userEmail.create({ data: { user_id: user.id, address: email } });
      await tx.user.update({ where: { id: user.id }, data: { default_email_id: address.id } });
      await tx.userCdata.create({ data: { user_id: user.id, name, email } });
      return user.id;
    });
  }

  // ---------------------------------------------------------------------------
  // Number generation
  // ---------------------------------------------------------------------------

  private async nextTaskNumber(tx: any) {
    const configs = await tx.config.findMany({ where: { namespace: 'core', key: { in: ['task_number_format', 'task_sequence_id'] } } });
    const format = configs.find((row: any) => row.key === 'task_number_format')?.value || '#';
    const sequenceId = configs.find((row: any) => row.key === 'task_sequence_id')?.value || '2';
    const numericSequence = /^\d+$/.test(String(sequenceId));
    let sequence = numericSequence ? await tx.sequence.findUnique({ where: { id: BigInt(String(sequenceId)) } }) : null;
    if (!sequence && numericSequence) {
      const id = BigInt(String(sequenceId));
      sequence = await tx.sequence.upsert({
        where: { id },
        update: {},
        create: { id, name: 'Tasks Sequence', flags: BigInt(1), next: BigInt(1), increment: 1, padding: '0', updated: new Date() },
      });
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      let value: bigint;
      let padding = '0';
      if (sequence) {
        value = sequence.next;
        const increment = BigInt(sequence.increment || 1);
        await tx.sequence.update({ where: { id: sequence.id }, data: { next: value + increment, updated: new Date() } });
        sequence = { ...sequence, next: value + increment };
        padding = sequence.padding || '0';
      } else {
        value = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      }
      const candidate = formatSequenceNumber(format, value.toString(), padding);
      if (candidate.length > 20) throw new BadRequestException('The generated task number is longer than the 20 character limit.');
      const duplicate = await tx.task.findFirst({ where: { number: candidate }, select: { id: true } });
      if (!duplicate) return candidate;
    }
    throw new ConflictException('Could not generate a unique task number. Try again.');
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private async baseRows() {
    const [tasks, cdata, departments, staff, teams] = await Promise.all([
      this.prisma.task.findMany({ orderBy: { updated: 'desc' }, take: 5000 }),
      this.prisma.taskCdata.findMany(),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.staff.findMany({ select: { staff_id: true, firstname: true, lastname: true, username: true, email: true } }),
      this.prisma.team.findMany({ select: { team_id: true, name: true } }),
    ]);
    const linkedIds = tasks.filter(task => task.object_type === 'T' && Number(task.object_id)).map(task => task.object_id);
    const linkedTickets = linkedIds.length
      ? await this.prisma.ticket.findMany({ where: { ticket_id: { in: linkedIds } }, select: { ticket_id: true, number: true } })
      : [];
    const titles = new Map(cdata.map(row => [String(row.task_id), row.title || '']));
    const deptNames = new Map(departments.map(row => [String(row.id), row.name]));
    const staffNames = new Map(staff.map(row => [String(row.staff_id), staffName(row)]));
    const teamNames = new Map(teams.map(row => [String(row.team_id), row.name]));
    const ticketNumbers = new Map(linkedTickets.map(row => [String(row.ticket_id), row.number || '']));
    return { tasks, titles, deptNames, staffNames, teamNames, ticketNumbers };
  }

  private listView(task: any, lookups: Awaited<ReturnType<TasksService['baseRows']>>) {
    const open = isOpen(task);
    return {
      id: String(task.id),
      number: task.number || '',
      title: lookups.titles.get(String(task.id)) || '(untitled task)',
      deptId: Number(task.dept_id) ? String(task.dept_id) : '',
      departmentName: lookups.deptNames.get(String(task.dept_id)) || '',
      assigneeId: Number(task.staff_id) ? String(task.staff_id) : '',
      assigneeName: lookups.staffNames.get(String(task.staff_id)) || '',
      teamId: Number(task.team_id) ? String(task.team_id) : '',
      teamName: lookups.teamNames.get(String(task.team_id)) || '',
      ticketId: task.object_type === 'T' && Number(task.object_id) ? String(task.object_id) : '',
      ticketNumber: task.object_type === 'T' ? lookups.ticketNumbers.get(String(task.object_id)) || '' : '',
      dueAt: task.duedate ? task.duedate.toISOString() : '',
      status: open ? 'open' : 'closed',
      overdue: isOverdue(task),
      createdAt: task.created.toISOString(),
      updatedAt: task.updated.toISOString(),
      closedAt: task.closed ? task.closed.toISOString() : '',
    };
  }

  private async visibleTasks(actor: Actor) {
    const lookups = await this.baseRows();
    const visible: Array<ReturnType<TasksService['listView']>> = [];
    for (const task of lookups.tasks) {
      if (await this.canAccessTask(actor, task)) visible.push(this.listView(task, lookups));
    }
    return visible;
  }

  async options(staffId: number) {
    const actor = await this.actor(staffId);
    const [departments, staff, teams] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.staff.findMany({ where: { isactive: 1 }, orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
    ]);
    // Agents may only link tasks to tickets they can actually see: tickets in
    // departments they have access to, or (when assigned-only) tickets assigned
    // to them or one of their teams.
    const ticketWhere = actor.isAdmin
      ? {}
      : Number(actor.staff.assigned_only)
        ? { OR: [{ staff_id: BigInt(actor.staff.staff_id) }, { team_id: { in: Array.from(actor.teamIds).map(value => BigInt(value)) } }] }
        : { dept_id: { in: Array.from(actor.deptIds).map(value => BigInt(value)) } };
    const ticketRows = await this.prisma.ticket.findMany({ where: ticketWhere, orderBy: { updated: 'desc' }, take: 200, select: { ticket_id: true, number: true } });
    const ticketCdata = ticketRows.length ? await this.prisma.ticketCdata.findMany({ where: { ticket_id: { in: ticketRows.map(row => row.ticket_id) } } }) : [];
    const subjects = new Map(ticketCdata.map(row => [String(row.ticket_id), row.subject || '']));
    return {
      departments: departments
        .filter(department => actor.isAdmin || actor.deptIds.has(Number(department.id)))
        .map(department => ({ id: String(department.id), name: department.name })),
      staff: staff.map(person => ({ id: String(person.staff_id), name: staffName(person), email: person.email || '' })),
      teams: teams.filter(team => Number(team.flags) & 1).map(team => ({ id: String(team.team_id), name: team.name })),
      tickets: ticketRows.map(ticket => ({ id: String(ticket.ticket_id), number: ticket.number || '', subject: subjects.get(String(ticket.ticket_id)) || '' })),
      permissions: Array.from(actor.globalPermissions),
    };
  }

  async list(staffId: number, query: any = {}) {
    const actor = await this.actor(staffId);
    let tasks = await this.visibleTasks(actor);
    const search = String(query.q || query.query || '').trim().toLowerCase();
    if (search) {
      tasks = tasks.filter(task => `${task.number} ${task.title} ${task.ticketNumber}`.toLowerCase().includes(search));
    }
    if (query.departmentId || query.deptId) {
      const deptId = String(query.departmentId || query.deptId);
      tasks = tasks.filter(task => task.deptId === deptId);
    }
    if (query.assigneeId) {
      const assigneeId = String(query.assigneeId);
      tasks = assigneeId === 'unassigned' ? tasks.filter(task => !task.assigneeId && !task.teamId) : tasks.filter(task => task.assigneeId === assigneeId || task.teamId === assigneeId);
    }
    if (query.ticketId) {
      const ticketId = String(query.ticketId);
      tasks = tasks.filter(task => task.ticketId === ticketId);
    }
    const queue = String(query.queue || query.status || 'open').toLowerCase();
    const counts = {
      open: tasks.filter(task => task.status === 'open').length,
      overdue: tasks.filter(task => task.overdue).length,
      assigned: tasks.filter(task => task.status === 'open' && task.assigneeId === String(actor.staff.staff_id)).length,
      closed: tasks.filter(task => task.status === 'closed').length,
      all: tasks.length,
    };
    if (queue === 'open') tasks = tasks.filter(task => task.status === 'open');
    else if (queue === 'closed' || queue === 'completed') tasks = tasks.filter(task => task.status === 'closed');
    else if (queue === 'overdue') tasks = tasks.filter(task => task.overdue);
    else if (queue === 'assigned' || queue === 'mine') tasks = tasks.filter(task => task.status === 'open' && task.assigneeId === String(actor.staff.staff_id));

    const sort = String(query.sort || 'updated').toLowerCase();
    const direction = String(query.dir || query.direction || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const value = (task: any) => {
      switch (sort) {
        case 'number': return task.number;
        case 'created': return task.createdAt;
        case 'due': return task.dueAt || '9999-12-31';
        case 'closed': return task.closedAt || '';
        case 'title': return task.title.toLowerCase();
        case 'assignee': return task.assigneeName.toLowerCase();
        case 'department': return task.departmentName.toLowerCase();
        default: return task.updatedAt;
      }
    };
    tasks.sort((a, b) => {
      const left = value(a), right = value(b);
      return left < right ? -direction : left > right ? direction : 0;
    });
    const page = Math.max(1, Number(query.page || 1));
    const perPage = Math.min(100, Math.max(5, Number(query.perPage || query.limit || 25)));
    const total = tasks.length;
    const start = (page - 1) * perPage;
    return {
      tasks: tasks.slice(start, start + perPage),
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      counts,
      permissions: Array.from(actor.globalPermissions),
    };
  }

  async get(staffId: number, id: string) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    return { task: await this.detail(actor, task) };
  }

  private async taskRow(id: string) {
    if (!/^\d+$/.test(String(id))) throw new NotFoundException('Task not found.');
    const task = await this.prisma.task.findUnique({ where: { id: BigInt(String(id)) } });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async detail(actor: Actor, task: any) {
    const lookups = await this.baseRows();
    const view = this.listView(task, lookups);
    const thread = await this.threadFor(task.id);
    const entries = await this.prisma.threadEntry.findMany({ where: { thread_id: thread.id }, orderBy: { created: 'asc' } });
    const attachments = entries.length ? await this.prisma.attachment.findMany({ where: { object_id: { in: entries.map(entry => entry.id) }, type: 'H' } }) : [];
    const files = attachments.length ? await this.prisma.file.findMany({ where: { id: { in: attachments.map(attachment => attachment.file_id) } } }) : [];
    const fileById = new Map(files.map(file => [String(file.id), file]));
    const attachmentViews = attachments.map(attachment => {
      const file = fileById.get(String(attachment.file_id));
      return {
        id: String(attachment.id),
        entryId: String(attachment.object_id),
        name: attachment.name || file?.name || 'attachment',
        size: file ? Number(file.size) : 0,
        type: file?.type || 'application/octet-stream',
      };
    });
    const staffIds = new Set(entries.filter(entry => Number(entry.staff_id)).map(entry => String(entry.staff_id)));
    const userIds = new Set(entries.filter(entry => Number(entry.user_id)).map(entry => String(entry.user_id)));
    const [entryStaff, entryUsers] = await Promise.all([
      staffIds.size ? this.prisma.staff.findMany({ where: { staff_id: { in: Array.from(staffIds).map(value => Number(value)) } } }) : [],
      userIds.size ? this.prisma.user.findMany({ where: { id: { in: Array.from(userIds).map(value => BigInt(value)) } } }) : [],
    ]);
    const staffById = new Map<string, any>(entryStaff.map(row => [String(row.staff_id), row] as [string, any]));
    const userById = new Map<string, any>(entryUsers.map(row => [String(row.id), row] as [string, any]));
    const collaborators = await this.prisma.threadCollaborator.findMany({ where: { thread_id: Number(thread.id), flags: { not: 0 } } });
    const collaboratorUsers = collaborators.length ? await this.prisma.user.findMany({ where: { id: { in: collaborators.map(row => BigInt(row.user_id)) } } }) : [];
    const collaboratorEmails = collaboratorUsers.length ? await this.prisma.userEmail.findMany({ where: { user_id: { in: collaboratorUsers.map(row => row.id) } } }) : [];
    const emailByUser = new Map<string, string>();
    for (const email of collaboratorEmails) if (!emailByUser.has(String(email.user_id))) emailByUser.set(String(email.user_id), email.address);
    const collaboratorByName = new Map(collaboratorUsers.map(row => [String(row.id), row]));
    const events = await this.prisma.threadEvent.findMany({ where: { thread_id: thread.id, thread_type: THREAD_TYPE }, orderBy: { timestamp: 'asc' } });
    const eventIds = Array.from(new Set(events.filter(event => event.event_id).map(event => String(event.event_id))));
    const eventNames = eventIds.length ? await this.prisma.event.findMany({ where: { id: { in: eventIds.map(value => Number(value)) } } }) : [];
    const eventNameById = new Map(eventNames.map(event => [String(event.id), event.name]));
    const description = await this.descriptionFor(task.id, thread.id);
    const permissions = this.taskPermissions(actor, task);
    return {
      ...view,
      description,
      permissions: { ...permissions, canCreate: actor.globalPermissions.has('task.create') },
      messages: entries.map(entry => {
        const attached = attachmentViews.filter(attachment => attachment.entryId === String(entry.id));
        const author = Number(entry.staff_id)
          ? staffName(staffById.get(String(entry.staff_id))) || entry.poster
          : Number(entry.user_id)
            ? userById.get(String(entry.user_id))?.name || entry.poster
            : entry.poster || 'System';
        return {
          id: String(entry.id),
          kind: entry.type === 'N' ? 'note' : entry.type === 'R' ? 'reply' : 'message',
          type: entry.type,
          author,
          body: entry.body,
          internal: entry.type === 'N',
          createdAt: entry.created.toISOString(),
          attachments: attached,
        };
      }),
      collaborators: collaborators.map(collaborator => {
        const user = collaboratorByName.get(String(collaborator.user_id));
        return {
          userId: String(collaborator.user_id),
          name: user?.name || '',
          email: emailByUser.get(String(collaborator.user_id)) || '',
          active: Boolean(collaborator.flags & 1),
        };
      }),
      events: events.map(event => ({
        id: String(event.id),
        event: (event.event_id ? eventNameById.get(String(event.event_id)) : '') || (event.event_id ? EVENT_NAMES.get(Number(event.event_id)) : '') || '',
        actor: event.username,
        at: event.timestamp.toISOString(),
        data: event.data || '',
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(staffId: number, input: any, uploads: Upload[] = []) {
    const actor = await this.actor(staffId);
    if (!actor.globalPermissions.has('task.create')) throw new ForbiddenException('You do not have permission to create tasks.');
    const title = this.security.clean(input.title, 255);
    const description = this.security.clean(input.description ?? input.body, 20000);
    if (!title) throw new BadRequestException('Task title is required.');
    if (!description) throw new BadRequestException('Task detail is required.');
    const deptId = idOrZero(input.deptId ?? input.departmentId);
    if (!deptId) throw new BadRequestException('Choose a department.');
    if (!actor.isAdmin && !actor.deptIds.has(Number(deptId))) throw new ForbiddenException('You do not have access to that department.');
    if (!this.hasDeptPermission(actor, Number(deptId), 'task.create')) throw new ForbiddenException('You do not have permission to create tasks in that department.');
    const department = await this.prisma.department.findUnique({ where: { id: deptId } });
    if (!department) throw new BadRequestException('Choose a valid department.');
    const assigneeId = idOrZero(input.assigneeId ?? input.staffId);
    const teamId = idOrZero(input.teamId);
    if ((assigneeId || teamId) && !this.hasDeptPermission(actor, Number(deptId), 'task.assign')) {
      throw new ForbiddenException('You do not have permission to assign tasks in that department.');
    }
    if (assigneeId) {
      const assignee = await this.prisma.staff.findFirst({ where: { staff_id: Number(assigneeId), isactive: 1 } });
      if (!assignee) throw new BadRequestException('Choose a valid assignee.');
    }
    if (teamId) {
      const team = await this.prisma.team.findUnique({ where: { team_id: teamId } });
      if (!team) throw new BadRequestException('Choose a valid team.');
    }
    const dueAt = input.dueAt ? new Date(String(input.dueAt)) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new BadRequestException('Choose a valid due date.');
    let ticketId = idOrZero(input.ticketId);
    if (ticketId) await this.assertTicketVisible(actor, ticketId);
    if (!ticketId) ticketId = 0n;
    const timestamp = new Date();
    const task = await this.prisma.$transaction(async tx => {
      const number = await this.nextTaskNumber(tx);
      const row = await tx.task.create({
        data: {
          object_id: ticketId,
          object_type: 'T',
          number,
          dept_id: deptId,
          staff_id: assigneeId,
          team_id: teamId,
          flags: BigInt(TASK_FLAG_OPEN),
          duedate: dueAt,
          created: timestamp,
          updated: timestamp,
        },
      });
      await tx.taskCdata.create({ data: { task_id: row.id, title } });
      await this.saveFormValues(tx, row.id, { title, description });
      const thread = await tx.thread.create({
        data: { object_id: row.id, object_type: THREAD_TYPE, lastmessage: timestamp, lastresponse: timestamp, created: timestamp },
      });
      const entry = await tx.threadEntry.create({
        data: {
          thread_id: thread.id,
          staff_id: BigInt(actor.staff.staff_id),
          type: 'M',
          flags: BigInt(ENTRY_FLAG_ORIGINAL),
          poster: actor.name,
          title,
          body: description,
          ip_address: '',
          created: timestamp,
          updated: timestamp,
        },
      });
      await this.saveAttachments(tx, entry.id, uploads, timestamp);
      await this.logEvent(tx, thread.id, row, EVENT_CREATED, actor, { title });
      if (assigneeId || teamId) await this.logEvent(tx, thread.id, row, EVENT_ASSIGNED, actor, { staffId: String(assigneeId), teamId: String(teamId) });
      const collaborators = this.parseCollaborators(input.collaborators);
      for (const person of collaborators) {
        const userId = await this.ensureUser(person.name || person.email, person.email);
        await tx.threadCollaborator.upsert({
          where: { thread_id_user_id: { thread_id: Number(thread.id), user_id: Number(userId) } },
          create: { thread_id: Number(thread.id), user_id: Number(userId), flags: 1, created: timestamp, updated: timestamp },
          update: { flags: 1, updated: timestamp },
        });
      }
      if (collaborators.length) await this.logEvent(tx, thread.id, row, EVENT_COLLABORATOR, actor, { count: collaborators.length });
      return row;
    });
    return { task: await this.detail(actor, task) };
  }

  private parseCollaborators(value: unknown) {
    let rows: any[] = [];
    if (Array.isArray(value)) rows = value;
    else if (typeof value === 'string' && value.trim()) {
      try { rows = JSON.parse(value); } catch { rows = []; }
    }
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    const result: Array<{ name: string; email: string }> = [];
    for (const row of rows) {
      const email = this.security.email(row?.email);
      if (!this.security.validEmail(email) || seen.has(email)) continue;
      seen.add(email);
      result.push({ name: this.security.clean(row?.name, 128) || email, email });
    }
    return result;
  }

  async update(staffId: number, id: string, input: any) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    const permissions = this.taskPermissions(actor, task);
    const now = new Date();
    const data: any = { updated: now };
    const title = input.title !== undefined ? this.security.clean(input.title, 255) : undefined;
    if (title !== undefined && !title) throw new BadRequestException('Task title is required.');
    const description = input.description !== undefined ? this.security.clean(input.description, 20000) : undefined;
    if (description !== undefined && !description) throw new BadRequestException('Task detail is required.');
    let deptChanged = false;
    let assignedChanged = false;
    if (input.deptId !== undefined || input.departmentId !== undefined) {
      if (!permissions.canTransfer) throw new ForbiddenException('You do not have permission to transfer this task.');
      const deptId = idOrZero(input.deptId ?? input.departmentId);
      const department = deptId ? await this.prisma.department.findUnique({ where: { id: deptId } }) : null;
      if (!department) throw new BadRequestException('Choose a valid department.');
      if (!actor.isAdmin && !actor.deptIds.has(Number(deptId))) throw new ForbiddenException('You do not have access to that department.');
      deptChanged = Number(task.dept_id) !== Number(deptId);
      data.dept_id = deptId;
    }
    if (input.assigneeId !== undefined || input.staffId !== undefined || input.teamId !== undefined) {
      if (!permissions.canAssign) throw new ForbiddenException('You do not have permission to assign this task.');
      if (input.assigneeId !== undefined || input.staffId !== undefined) {
        const assigneeId = idOrZero(input.assigneeId ?? input.staffId);
        if (assigneeId) {
          const assignee = await this.prisma.staff.findFirst({ where: { staff_id: Number(assigneeId), isactive: 1 } });
          if (!assignee) throw new BadRequestException('Choose a valid assignee.');
        }
        data.staff_id = assigneeId;
      }
      if (input.teamId !== undefined) {
        const teamId = idOrZero(input.teamId);
        if (teamId) {
          const team = await this.prisma.team.findUnique({ where: { team_id: teamId } });
          if (!team) throw new BadRequestException('Choose a valid team.');
        }
        data.team_id = teamId;
      }
      assignedChanged = Number(data.staff_id ?? task.staff_id) !== Number(task.staff_id) || Number(data.team_id ?? task.team_id) !== Number(task.team_id);
    }
    if (input.ticketId !== undefined) {
      if (!permissions.canEdit) throw new ForbiddenException('You do not have permission to edit this task.');
      const ticketId = idOrZero(input.ticketId);
      if (ticketId) await this.assertTicketVisible(actor, ticketId);
      data.object_id = ticketId;
      data.object_type = 'T';
    }
    if (input.dueAt !== undefined) {
      if (!permissions.canEdit) throw new ForbiddenException('You do not have permission to edit this task.');
      if (input.dueAt === null || input.dueAt === '') data.duedate = null;
      else {
        const due = new Date(String(input.dueAt));
        if (Number.isNaN(due.getTime())) throw new BadRequestException('Choose a valid due date.');
        data.duedate = due;
      }
    }
    const requestedStatus = input.status !== undefined ? String(input.status).toLowerCase() : '';
    if (requestedStatus && !['open', 'closed'].includes(requestedStatus)) throw new BadRequestException('Choose a valid task status.');
    const statusChanged = Boolean(requestedStatus) && (requestedStatus === 'open') !== isOpen(task);
    if (statusChanged && !permissions.canClose) throw new ForbiddenException('You do not have permission to change this task status.');
    if (title !== undefined || description !== undefined) {
      if (!permissions.canEdit) throw new ForbiddenException('You do not have permission to edit this task.');
    }
    if (statusChanged) {
      data.flags = requestedStatus === 'open' ? BigInt(Number(task.flags) | TASK_FLAG_OPEN) : BigInt(Number(task.flags) & ~TASK_FLAG_OPEN);
      data.closed = requestedStatus === 'closed' ? now : null;
    }
    const thread = await this.threadFor(task.id);
    const updated = await this.prisma.$transaction(async tx => {
      const row = await tx.task.update({ where: { id: task.id }, data });
      if (title !== undefined) {
        await tx.taskCdata.upsert({ where: { task_id: task.id }, create: { task_id: task.id, title }, update: { title } });
      }
      if (title !== undefined || description !== undefined) {
        await this.saveFormValues(tx, task.id, { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) });
        if (description !== undefined) {
          const original = await tx.threadEntry.findFirst({ where: { thread_id: thread.id, type: 'M', flags: { not: 0n } }, orderBy: { created: 'asc' } });
          if (original) await tx.threadEntry.update({ where: { id: original.id }, data: { body: description, title: title ?? original.title, updated: now } });
        }
        await this.logEvent(tx, thread.id, row, EVENT_EDITED, actor, { title, descriptionChanged: description !== undefined });
      }
      if (deptChanged) await this.logEvent(tx, thread.id, row, EVENT_TRANSFERRED, actor, { from: String(task.dept_id), to: String(row.dept_id) });
      if (assignedChanged) {
        const released = !Number(row.staff_id) && !Number(row.team_id);
        await this.logEvent(tx, thread.id, row, released ? EVENT_RELEASED : EVENT_ASSIGNED, actor, { staffId: String(row.staff_id), teamId: String(row.team_id) });
      }
      if (statusChanged) await this.logEvent(tx, thread.id, row, requestedStatus === 'open' ? EVENT_REOPENED : EVENT_CLOSED, actor, {});
      return row;
    });
    return { task: await this.detail(actor, updated) };
  }

  async setStatus(staffId: number, id: string, status: 'open' | 'closed') {
    return this.update(staffId, id, { status });
  }

  async remove(staffId: number, id: string) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    this.assertPermission(actor, task, 'task.delete', 'You do not have permission to delete this task.');
    const thread = await this.prisma.thread.findUnique({ where: { object_id_object_type: { object_id: task.id, object_type: THREAD_TYPE } } });
    await this.prisma.$transaction(async tx => {
      if (thread) {
        await this.logEvent(tx, thread.id, task, EVENT_DELETED, actor, { number: task.number });
        const entries = await tx.threadEntry.findMany({ where: { thread_id: thread.id }, select: { id: true } });
        const attachments = entries.length ? await tx.attachment.findMany({ where: { object_id: { in: entries.map((entry: any) => entry.id) }, type: 'H' } }) : [];
        for (const attachment of attachments) {
          await tx.fileChunk.deleteMany({ where: { file_id: attachment.file_id } });
          await tx.file.deleteMany({ where: { id: attachment.file_id } });
        }
        if (entries.length) await tx.attachment.deleteMany({ where: { object_id: { in: entries.map((entry: any) => entry.id) } } });
        await tx.threadEntry.deleteMany({ where: { thread_id: thread.id } });
        await tx.threadCollaborator.deleteMany({ where: { thread_id: Number(thread.id) } });
        await tx.threadEvent.deleteMany({ where: { thread_id: thread.id } });
        await tx.thread.delete({ where: { id: thread.id } });
      }
      const forms = await tx.formEntry.findMany({ where: { object_id: task.id, object_type: THREAD_TYPE }, select: { id: true } });
      if (forms.length) await tx.formEntryValues.deleteMany({ where: { entry_id: { in: forms.map((form: any) => form.id) } } });
      await tx.formEntry.deleteMany({ where: { object_id: task.id, object_type: THREAD_TYPE } });
      await tx.taskCdata.deleteMany({ where: { task_id: task.id } });
      await tx.task.delete({ where: { id: task.id } });
    });
    return { deleted: true, id: String(task.id) };
  }

  async postMessage(staffId: number, id: string, input: any, uploads: Upload[] = []) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    this.assertPermission(actor, task, 'task.reply', 'You do not have permission to post to this task.');
    const message = this.security.clean(input.message ?? input.body ?? input.note, 20000);
    if (!message) throw new BadRequestException('Write a message before posting.');
    const internal = input.internal === true || input.internal === 'true' || input.internal === 1 || input.internal === '1' || input.type === 'N';
    const requestedStatus = input.status ? String(input.status).toLowerCase() : '';
    if (requestedStatus && !['open', 'closed'].includes(requestedStatus)) throw new BadRequestException('Choose a valid task status.');
    if (requestedStatus && (requestedStatus === 'open') !== isOpen(task)) {
      this.assertPermission(actor, task, 'task.close', 'You do not have permission to change this task status.');
    }
    const timestamp = new Date();
    const thread = await this.threadFor(task.id);
    const entry = await this.prisma.$transaction(async tx => {
      const created = await tx.threadEntry.create({
        data: {
          thread_id: thread.id,
          staff_id: BigInt(actor.staff.staff_id),
          type: internal ? 'N' : 'R',
          flags: 0n,
          poster: actor.name,
          body: message,
          ip_address: '',
          created: timestamp,
          updated: timestamp,
        },
      });
      await this.saveAttachments(tx, created.id, uploads, timestamp);
      await tx.thread.update({
        where: { id: thread.id },
        data: internal ? { lastmessage: timestamp } : { lastmessage: timestamp, lastresponse: timestamp },
      });
      if (requestedStatus) {
        const open = requestedStatus === 'open';
        const flags = open ? BigInt(Number(task.flags) | TASK_FLAG_OPEN) : BigInt(Number(task.flags) & ~TASK_FLAG_OPEN);
        await tx.task.update({ where: { id: task.id }, data: { flags, closed: open ? null : timestamp, updated: timestamp } });
        await this.logEvent(tx, thread.id, { ...task, flags }, open ? EVENT_REOPENED : EVENT_CLOSED, actor, {});
      } else {
        await tx.task.update({ where: { id: task.id }, data: { updated: timestamp } });
      }
      return created;
    });
    if (!internal) {
      const collaborators = await this.prisma.threadCollaborator.findMany({ where: { thread_id: Number(thread.id), flags: { not: 0 } } });
      if (collaborators.length) {
        const users = await this.prisma.user.findMany({ where: { id: { in: collaborators.map(row => BigInt(row.user_id)) } } });
        const emails = await this.prisma.userEmail.findMany({ where: { user_id: { in: users.map(user => user.id) } } });
        const emailByUser = new Map<string, string>();
        for (const email of emails) if (!emailByUser.has(String(email.user_id))) emailByUser.set(String(email.user_id), email.address);
        const recipients = users.map(user => emailByUser.get(String(user.id))).filter(Boolean) as string[];
        if (recipients.length) {
          const cdata = await this.prisma.taskCdata.findUnique({ where: { task_id: task.id } });
          const title = cdata?.title || '';
          void this.mail.sendNotice(recipients, `Task #${task.number || task.id} updated`, `${actor.name} posted an update on task #${task.number || task.id}: ${title}\n\n${message}`, task.number || String(task.id));
        }
      }
    }
    return { task: await this.detail(actor, await this.taskRow(String(task.id))), messageId: String(entry.id) };
  }

  async setCollaborators(staffId: number, id: string, value: unknown) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    this.assertPermission(actor, task, 'task.edit', 'You do not have permission to manage collaborators.');
    const collaborators = this.parseCollaborators(value);
    const thread = await this.threadFor(task.id);
    const timestamp = new Date();
    await this.prisma.$transaction(async tx => {
      const desired = new Map<number, { name: string; email: string }>();
      for (const person of collaborators) {
        const userId = await this.ensureUser(person.name || person.email, person.email);
        desired.set(Number(userId), person);
      }
      const existing = await tx.threadCollaborator.findMany({ where: { thread_id: Number(thread.id) } });
      for (const row of existing) {
        if (!desired.has(Number(row.user_id))) await tx.threadCollaborator.delete({ where: { id: row.id } });
      }
      for (const userId of desired.keys()) {
        await tx.threadCollaborator.upsert({
          where: { thread_id_user_id: { thread_id: Number(thread.id), user_id: userId } },
          create: { thread_id: Number(thread.id), user_id: userId, flags: 1, created: timestamp, updated: timestamp },
          update: { flags: 1, updated: timestamp },
        });
      }
      await this.logEvent(tx, thread.id, task, EVENT_COLLABORATOR, actor, { count: desired.size });
    });
    return { task: await this.detail(actor, await this.taskRow(String(task.id))) };
  }

  async attachment(staffId: number, id: string, attachmentId: string) {
    const actor = await this.actor(staffId);
    const task = await this.taskRow(id);
    await this.assertAccess(actor, task);
    const thread = await this.threadFor(task.id);
    const entries = await this.prisma.threadEntry.findMany({ where: { thread_id: thread.id }, select: { id: true } });
    const scope = { object_id: { in: entries.map(entry => entry.id) }, type: 'H' as const };
    const attachment = attachmentId.startsWith('name:')
      ? await this.prisma.attachment.findFirst({ where: { ...scope, name: attachmentId.slice(5) } })
      : await this.prisma.attachment.findFirst({ where: { ...scope, id: bi(attachmentId) } });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    const file = await this.prisma.file.findUnique({ where: { id: attachment.file_id } });
    if (!file) throw new NotFoundException('Attachment not found.');
    const chunks = await this.prisma.fileChunk.findMany({ where: { file_id: file.id }, orderBy: { chunk_id: 'asc' } });
    return { name: attachment.name || file.name, type: file.type || 'application/octet-stream', data: Buffer.concat(chunks.map(chunk => Buffer.from(chunk.filedata))) };
  }
}
