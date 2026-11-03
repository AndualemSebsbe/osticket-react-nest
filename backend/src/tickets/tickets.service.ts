import { Inject, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiSecurityService } from '../common/api-security.service';
import { MailService } from '../mail/mail.service';
import { BUILTIN_TICKET_QUEUES } from './queue-defaults';

const bi = (v: unknown) => BigInt(String(v || 0));
const idOrZero = (v: unknown) => /^\d+$/.test(String(v ?? '')) ? BigInt(String(v)) : 0n;
const parse = (s?: string | null) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

const TOPIC_FLAG_CUSTOM_NUMBERS = 0x0001;

function sequenceDigitCount(format: string) {
  return (format.match(/(?<!\\)#/g) || []).length;
}

/**
 * Mirrors osTicket's Sequence::format(). Hash groups are replaced with digits
 * from the (left-padded) sequence value. Escaped hashes (\#) are literal.
 */
function formatSequenceNumber(format: string, value: string, padding = '0') {
  const source = format || '######';
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
  if (padded.length > offset) output += padded.slice(offset);
  output += source.slice(start).replace(/\\#/g, '#');
  return output;
}

function randomSequenceNumber(digits: number) {
  let value = '';
  for (let index = 0; index < digits; index++) {
    value += String(index === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10));
  }
  return BigInt(value || '0');
}

@Injectable()
export class TicketsService {
  constructor(@Inject(PrismaService) private prisma: PrismaService, @Inject(ApiSecurityService) private security: ApiSecurityService, @Inject(MailService) private mail: MailService) {}

  private async view(row: any) {
    const [data, userEmail, user, dept, topic, status, staff, thread] = await Promise.all([
      this.prisma.ticketCdata.findUnique({ where: { ticket_id: row.ticket_id } }),
      this.prisma.userEmail.findUnique({ where: { id: row.user_email_id } }),
      this.prisma.user.findUnique({ where: { id: row.user_id } }),
      this.prisma.department.findUnique({ where: { id: row.dept_id } }),
      this.prisma.helpTopic.findUnique({ where: { topic_id: row.topic_id } }),
      this.prisma.ticketStatus.findUnique({ where: { id: row.status_id } }),
      row.staff_id ? this.prisma.staff.findUnique({ where: { staff_id: Number(row.staff_id) } }) : null,
      this.prisma.thread.findUnique({ where: { object_id_object_type: { object_id: row.ticket_id, object_type: 'T' } } }),
    ]);
    const entries = thread ? await this.prisma.threadEntry.findMany({ where: { thread_id: thread.id }, orderBy: { created: 'asc' } }) : [];
    const attachments = entries.length ? await this.prisma.attachment.findMany({where:{object_id:{in:entries.map(entry=>entry.id)},type:'H'}}) : [];
    const files = await Promise.all(attachments.map(async a=>({id:String(a.id),entryId:String(a.object_id),name:a.name||'',file:await this.prisma.file.findUnique({where:{id:a.file_id}})}))); 
    const collaborators = thread ? await this.prisma.threadCollaborator.findMany({ where: { thread_id: Number(thread.id) } }) : [];
    const branch = data?.branch_id ? await this.prisma.branch.findUnique({ where: { id: data.branch_id } }) : null;
    const threadExtra = parse(thread?.extra);
    const collaboratorViews = await Promise.all(collaborators.map(async c => {
      const email = await this.prisma.userEmail.findFirst({ where: { user_id: bi(c.user_id) } });
      const userRow = email ? await this.prisma.user.findUnique({ where: { id: email.user_id } }) : null;
      return { name: userRow?.name || email?.address || '', email: email?.address || '', active: Boolean(c.flags & 1), userId: String(c.user_id) };
    }));
    const statusName = status?.name || status?.state || 'Open';
    const rawState = String(status?.state || status?.name || 'open').toLowerCase();
    const statusState = ['open', 'pending', 'closed'].includes(rawState) ? rawState : 'open';
    const priorityName = (data?.priority || 'normal').toLowerCase();
    const accessHash = parse(thread?.extra).accessHash;
    let lockInfo: any = null;
    if (row.lock_id && Number(row.lock_id) > 0) {
      const lock = await this.prisma.lock.findUnique({ where: { lock_id: Number(row.lock_id) } });
      if (lock && (!lock.expire || lock.expire.getTime() > Date.now())) {
        const lockStaff = lock.staff_id ? await this.prisma.staff.findUnique({ where: { staff_id: lock.staff_id } }) : null;
        lockInfo = { lock_id: lock.lock_id, staff_id: lock.staff_id, staff_name: lockStaff ? [lockStaff.firstname, lockStaff.lastname].filter(Boolean).join(' ') : '', expire: lock.expire?.toISOString() };
      }
    }
    const children = await this.prisma.ticket.findMany({ where: { ticket_pid: row.ticket_id }, select: { ticket_id: true } });
    const parentId = row.ticket_pid ? String(row.ticket_pid) : null;
    return {
      id: String(row.ticket_id), number: row.number || String(row.ticket_id), subject: data?.subject || '(no subject)',
      requesterName: user?.name || '', requesterEmail: userEmail?.address || '', status: statusState, statusId: status ? String(status.id) : '', statusName,
      priority: priorityName, department: dept?.name || '', departmentId: String(row.dept_id),
      topic: topic?.topic || '', topicId: String(row.topic_id), branchId: String(data?.branch_id || ''),
      branchName: branch?.name || '', assignee: staff ? [staff.firstname, staff.lastname].filter(Boolean).join(' ') : '',
      assigneeEmail: staff?.email || '', assigneeStaffId: String(row.staff_id || ''),
      overdue: Boolean(row.isoverdue), createdAt: row.created.toISOString(), updatedAt: row.updated.toISOString(),
      collaborators: collaboratorViews, accessHash, fromEmail: threadExtra.fromEmail || '', collaboratorNotice: threadExtra.collaboratorNotice || 'all',
      source: row.source || 'WEB', employeeId: data?.employee_id || '',
      parentTicketId: parentId || undefined,
      mergedTicketIds: children.map(c => String(c.ticket_id)),
      lock: lockInfo, lockedBy: lockInfo?.staff_id ? String(lockInfo.staff_id) : undefined, lockedByName: lockInfo?.staff_name || undefined, lockExpires: lockInfo?.expire,
      dueAt: row.duedate ? row.duedate.toISOString() : row.est_duedate ? row.est_duedate.toISOString() : undefined,
      duedate: row.duedate ? row.duedate.toISOString() : undefined,
      messages: entries.map(e => { const attached = files.filter(f=>f.entryId===String(e.id)); return { id: String(e.id), author: e.poster, authorEmail: '', kind: e.type === 'R' ? 'agent' : e.type === 'N' ? 'note' : 'client', internal: e.type === 'N', body: e.body, attachments: attached.map(f=>f.name), attachmentFiles: attached.map(f=>({ id: f.id, name: f.name })), recipients: parse(e.recipients).list || [], createdAt: e.created.toISOString() } }),
    };
  }

  async listApi() {
    const rows = await this.prisma.ticket.findMany({ orderBy: { updated: 'desc' }, take: 1000 });
    return Promise.all(rows.map(async t => { const v=await this.view(t); const {accessHash,...safe}=v; return safe; }));
  }

  async queueDefinitions() {
    const [queues, columns, sorts, links, sortLinks, saved] = await Promise.all([
      this.prisma.queue.findMany({ orderBy: [{ sort: 'asc' }, { title: 'asc' }] }),
      this.prisma.queueColumn.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.queueSort.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      this.prisma.queueColumns.findMany({ orderBy: [{ queue_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.queueSorts.findMany({ orderBy: [{ queue_id: 'asc' }, { sort: 'asc' }] }),
      this.prisma.config.findMany({ where: { namespace: 'react_app_state', key: 'queues' } }),
    ]);
    let custom: any[] = [];
    try { custom = JSON.parse(saved[0]?.value || '[]'); } catch { /* Ignore malformed optional app queue settings. */ }
    const builtinQueues = BUILTIN_TICKET_QUEUES.map(queue => ({
      id: queue.id,
      title: queue.title,
      parentId: queue.parentId,
      filter: queue.filter,
      root: queue.root,
      sort: queue.sort,
      flags: queue.flags,
      staffId: '0',
      builtin: true,
      columns: queue.columns.map((column, index) => ({ id: `${queue.id}-${column.path}`, heading: column.label, field: column.path, width: String(column.width || ''), sort: index + 1 })),
      sorting: [{ id: `${queue.id}-sort`, name: queue.sortBy.field, field: queue.sortBy.field, sort: 0, direction: queue.sortBy.direction }],
    }));
    return {
      queues: [
        ...builtinQueues,
        ...queues.map(queue => ({ id: String(queue.id), title: queue.title || 'Untitled queue', parentId: String(queue.parent_id || ''), filter: queue.filter || '', root: queue.root || '', sort: Number(queue.sort), flags: Number(queue.flags || 0), staffId: String(queue.staff_id || 0), columns: links.filter(link => link.queue_id === queue.id).map(link => { const column = columns.find(item => item.id === link.column_id); return column && { id: String(column.id), heading: column.heading || column.name || '', field: column.name || '', width: column.width || '', sort: Number(link.sort) }; }).filter(Boolean), sorting: sortLinks.filter(link => link.queue_id === queue.id).map(link => { const sort = sorts.find(item => item.id === link.sort_id); return sort && { id: String(sort.id), name: sort.name || '', field: sort.field || '', sort: Number(link.sort) }; }).filter(Boolean) })),
      ],
      customQueues: Array.isArray(custom) ? custom : [],
    };
  }

  async advancedSearch(input: any) {
    const q = String(input.q || '').trim();
    const filters = input.filters && typeof input.filters === 'object' ? input.filters : {};
    const rows = await this.prisma.ticket.findMany({ orderBy: { updated: 'desc' } });
    const matched: any[] = [];
    const keyword = q.toLocaleLowerCase();
    const entriesCache = new Map<string, string>();
    for (const row of rows) {
      const v = await this.view(row);
      const values: Record<string, string> = { number: v.number, subject: v.subject, status: v.status, priority: v.priority, department: v.department, topic: v.topic, requester: v.requesterName, email: v.requesterEmail, assignee: v.assignee || '', source: String((row as any).source || ''), created: v.createdAt.slice(0,10), updated: v.updatedAt.slice(0,10) };
      let ok = !keyword || Object.values(values).some(x => x.toLocaleLowerCase().includes(keyword));
      if (keyword && !ok) {
        const thread = await this.prisma.thread.findUnique({ where: { object_id_object_type: { object_id: row.ticket_id, object_type: 'T' } } });
        if (thread) {
          let content = entriesCache.get(String(row.ticket_id));
          if (content === undefined) { content = (await this.prisma.threadEntry.findMany({ where: { thread_id: thread.id }, select: { body: true, title: true } })).map(e => `${e.title || ''} ${e.body}`).join(' ').toLocaleLowerCase(); entriesCache.set(String(row.ticket_id), content); }
          ok = content.includes(keyword);
        }
      }
      for (const [field, expected] of Object.entries(filters)) {
        if (expected === '' || expected == null) continue;
        const actual = values[field];
        if (['createdFrom','createdTo','updatedFrom','updatedTo'].includes(field)) {
          const dateField = field.startsWith('created') ? 'created' : 'updated';
          if (field.endsWith('From') ? values[dateField] < String(expected) : values[dateField] > String(expected)) { ok = false; break; }
        } else if (actual == null || !actual.toLocaleLowerCase().includes(String(expected).toLocaleLowerCase())) { ok = false; break; }
      }
      if (ok) matched.push(v);
    }
    return matched;
  }

  async listForClient(email: string, userId?: string) {
    const addresses = await this.prisma.userEmail.findMany({ where: { user_id: userId ? bi(userId) : undefined } });
    const threadIds = await this.prisma.threadCollaborator.findMany({ where: { user_id: { in: addresses.map(a => Number(a.user_id)) }, flags: { not: 0 } } });
    const thread = await this.prisma.thread.findMany({ where: { id: { in: threadIds.map(c => bi(c.thread_id)) }, object_type: 'T' } });
    const rows = await this.prisma.ticket.findMany({ where: { OR: [{ user_id: userId ? bi(userId) : undefined }, { user_email_id: { in: addresses.map(a => a.id) } }, { ticket_id: { in: thread.map(t => t.object_id) } }] }, orderBy: { updated: 'desc' }, take: 500 });
    return Promise.all(rows.map(async t => { const v=await this.view(t); const {accessHash,requesterEmail,...safe}=v; return safe; }));
  }

  async getAttachment(number:string, attachmentId:string, includeInternal = false) {
    const {row}=await this.get(number); const thread=await this.threadFor(row.ticket_id); const entries=await this.prisma.threadEntry.findMany({where:{thread_id:thread.id,...(includeInternal?{}:{type:{not:'N'}})},select:{id:true}}); const scope={object_id:{in:entries.map(e=>e.id)},type:'H' as const}; const attachment=attachmentId.startsWith('name:')?await this.prisma.attachment.findFirst({where:{...scope,name:attachmentId.slice(5)}}):await this.prisma.attachment.findFirst({where:{...scope,id:bi(attachmentId)}}); if(!attachment) throw new NotFoundException('Attachment not found.'); const file=await this.prisma.file.findUnique({where:{id:attachment.file_id}}); if(!file) throw new NotFoundException('Attachment not found.'); const chunks=await this.prisma.fileChunk.findMany({where:{file_id:file.id},orderBy:{chunk_id:'asc'}}); return {name:attachment.name||file.name,type:file.type||'application/octet-stream',data:Buffer.concat(chunks.map(chunk=>Buffer.from(chunk.filedata)))};
  }

  async get(number: string) {
    const row = await this.prisma.ticket.findFirst({ where: { OR: [{ number }, ...( /^\d+$/.test(number) ? [{ ticket_id: bi(number) }] : [])] } });
    if (!row) throw new NotFoundException('Ticket not found.');
    return { row, view: await this.view(row) };
  }

  private async threadFor(ticketId: bigint) {
    return this.prisma.thread.upsert({ where: { object_id_object_type: { object_id: ticketId, object_type: 'T' } }, create: { object_id: ticketId, object_type: 'T', created: new Date() }, update: {} });
  }

  private async resolveStatus(statusId: unknown, statusValue: unknown) {
    const rawId = statusId !== undefined && statusId !== null ? String(statusId) : '';
    if (rawId && /^\d+$/.test(rawId)) {
      const status = await this.prisma.ticketStatus.findUnique({ where: { id: BigInt(rawId) } });
      if (!status) throw new BadRequestException('Choose a valid ticket status.');
      return status;
    }
    const value = String(statusValue ?? '').trim();
    if (!value) throw new BadRequestException('Choose a valid ticket status.');
    const byName = await this.prisma.ticketStatus.findFirst({ where: { name: { equals: value, mode: 'insensitive' } } });
    if (byName) return byName;
    const byState = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: value, mode: 'insensitive' } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    if (!byState) throw new BadRequestException('Choose a valid ticket status.');
    return byState;
  }

  async getForStaff(number: string) {
    const { view } = await this.get(number);
    const { accessHash: _accessHash, ...ticket } = view;
    return { ticket, messages: ticket.messages.map(message => ({ ...message, ticketNumber: ticket.number })) };
  }

  async merge(primaryNumber: string, secondaryNumber: string, staffId: number, staffName: string) {
    const { row: primary } = await this.get(primaryNumber);
    const { row: secondary } = await this.get(secondaryNumber);
    if (primary.ticket_id === secondary.ticket_id) throw new BadRequestException('Select a different ticket number to merge.');
    if (secondary.ticket_pid) throw new ConflictException('Ticket #' + secondary.number + ' is already merged into another ticket.');
    if (primary.ticket_pid) throw new ConflictException('A merged ticket cannot receive another merge.');
    const children = await this.prisma.ticket.count({ where: { ticket_pid: secondary.ticket_id } });
    if (children) throw new ConflictException('Unmerge the child tickets of #' + secondary.number + ' first.');
    const now = new Date();
    const closed = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: 'closed', mode: 'insensitive' } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    const primaryThread = await this.threadFor(primary.ticket_id);
    await this.prisma.$transaction(async tx => {
      const secondaryThread = await tx.thread.findUnique({ where: { object_id_object_type: { object_id: secondary.ticket_id, object_type: 'T' } } });
      if (secondaryThread) {
        await tx.threadEntry.updateMany({ where: { thread_id: secondaryThread.id }, data: { thread_id: primaryThread.id } });
        await tx.threadEvent.updateMany({ where: { thread_id: secondaryThread.id }, data: { thread_id: primaryThread.id } });
        const collaborators = await tx.threadCollaborator.findMany({ where: { thread_id: Number(secondaryThread.id) } });
        for (const collaborator of collaborators) {
          const existing = await tx.threadCollaborator.findFirst({ where: { thread_id: Number(primaryThread.id), user_id: collaborator.user_id } });
          if (!existing) await tx.threadCollaborator.create({ data: { thread_id: Number(primaryThread.id), user_id: collaborator.user_id, flags: collaborator.flags, role: collaborator.role, created: collaborator.created, updated: now } });
        }
        await tx.threadCollaborator.deleteMany({ where: { thread_id: Number(secondaryThread.id) } });
        await tx.thread.delete({ where: { id: secondaryThread.id } });
      }
      await tx.ticket.update({ where: { ticket_id: secondary.ticket_id }, data: { ticket_pid: primary.ticket_id, ...(closed ? { status_id: closed.id } : {}), closed: now, isoverdue: 0, updated: now } });
      await tx.ticket.update({ where: { ticket_id: primary.ticket_id }, data: { updated: now } });
      await tx.threadEvent.create({ data: { thread_id: primaryThread.id, thread_type: 'T', event_id: 13n, staff_id: BigInt(staffId || 0), team_id: primary.team_id, dept_id: primary.dept_id, topic_id: primary.topic_id, username: staffName || 'SYSTEM', uid: BigInt(staffId || 0), uid_type: 'S', timestamp: now } });
    });
    const parent = await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: primary.ticket_id } });
    const child = await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: secondary.ticket_id } });
    return { ticket: await this.view(parent), merged: await this.view(child) };
  }

  async acquireLock(number: string, staffId: number) {
    const { row } = await this.get(number);
    const staff = await this.prisma.staff.findUnique({ where: { staff_id: staffId } });
    if (!staff) throw new ForbiddenException('Active staff account required.');
    const now = new Date();
    const existing = row.lock_id ? await this.prisma.lock.findUnique({ where: { lock_id: Number(row.lock_id) } }) : null;
    if (existing?.expire && existing.expire.getTime() > now.getTime() && existing.staff_id !== staffId) {
      const owner = existing.staff_id ? await this.prisma.staff.findUnique({ where: { staff_id: existing.staff_id } }) : null;
      throw new ConflictException('This ticket is locked by ' + ([owner?.firstname, owner?.lastname].filter(Boolean).join(' ') || 'another agent') + '.');
    }
    const expire = new Date(now.getTime() + 10 * 60 * 1000);
    const code = randomBytes(8).toString('hex');
    const lock = await this.prisma.$transaction(async tx => {
      const saved = existing
        ? await tx.lock.update({ where: { lock_id: existing.lock_id }, data: { staff_id: staffId, expire, code } })
        : await tx.lock.create({ data: { staff_id: staffId, expire, code, created: now } });
      await tx.ticket.update({ where: { ticket_id: row.ticket_id }, data: { lock_id: BigInt(saved.lock_id), updated: now } });
      return saved;
    });
    const refreshed = await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: row.ticket_id } });
    return { ticket: await this.view(refreshed), lock: { id: String(lock.lock_id), code, expiresAt: expire.toISOString() } };
  }

  async releaseLock(number: string, staffId: number, isAdmin = false) {
    const { row } = await this.get(number);
    if (!row.lock_id) return { released: false, ticket: await this.view(row) };
    const lock = await this.prisma.lock.findUnique({ where: { lock_id: Number(row.lock_id) } });
    if (lock && lock.staff_id !== staffId && !isAdmin) throw new ForbiddenException('This ticket is locked by another agent.');
    await this.prisma.$transaction(async tx => {
      await tx.ticket.update({ where: { ticket_id: row.ticket_id }, data: { lock_id: 0n } });
      if (lock) await tx.lock.delete({ where: { lock_id: lock.lock_id } });
    });
    const refreshed = await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: row.ticket_id } });
    return { released: true, ticket: await this.view(refreshed) };
  }

  private taskView(row: any, title: string, departmentName = '') {
    return {
      id: String(row.id),
      number: row.number || '',
      title,
      deptId: Number(row.dept_id) ? String(row.dept_id) : '',
      departmentName,
      assigneeId: Number(row.staff_id) ? String(row.staff_id) : undefined,
      ticketId: row.object_type === 'T' && Number(row.object_id) ? String(row.object_id) : undefined,
      dueAt: row.duedate ? row.duedate.toISOString() : undefined,
      status: row.closed ? 'closed' : 'open',
      createdAt: row.created.toISOString(),
      updatedAt: row.updated.toISOString(),
    };
  }

  private async taskDepartment(input: any) {
    const rawId = input.deptId;
    if (rawId !== undefined && rawId !== null && rawId !== '' && /^\d+$/.test(String(rawId))) {
      const department = await this.prisma.department.findUnique({ where: { id: BigInt(String(rawId)) } });
      if (!department) throw new BadRequestException('Choose a valid department.');
      return department;
    }
    const name = this.security.clean(input.departmentName || input.department || '', 255);
    if (!name) return null;
    const department = await this.prisma.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (!department) throw new BadRequestException('Choose a valid department.');
    return department;
  }

  async listTasks() {
    const [rows, departments] = await Promise.all([
      this.prisma.task.findMany({ orderBy: { updated: 'desc' } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const data = rows.length ? await this.prisma.taskCdata.findMany({ where: { task_id: { in: rows.map(row => row.id) } } }) : [];
    const titles = new Map(data.map(item => [String(item.task_id), item.title || '']));
    const departmentNames = new Map(departments.map(department => [String(department.id), department.name]));
    return { tasks: rows.map(row => this.taskView(row, titles.get(String(row.id)) || '', departmentNames.get(String(row.dept_id)) || '')) };
  }

  async createTask(input: any, staffId: number) {
    const title = this.security.clean(input.title, 255);
    if (!title) throw new BadRequestException('Task title is required.');
    const now = new Date();
    const due = input.dueAt ? new Date(String(input.dueAt)) : null;
    if (due && Number.isNaN(due.getTime())) throw new BadRequestException('Choose a valid due date.');
    const number = 'T' + randomBytes(4).toString('hex').toUpperCase();
    const objectId = idOrZero(input.ticketId);
    const department = await this.taskDepartment(input);
    let deptId = department?.id ?? 0n;
    let departmentName = department?.name || '';
    if (!deptId && objectId) {
      const ticket = await this.prisma.ticket.findUnique({ where: { ticket_id: objectId }, select: { dept_id: true } });
      deptId = ticket?.dept_id ?? 0n;
      if (deptId) departmentName = (await this.prisma.department.findUnique({ where: { id: deptId }, select: { name: true } }))?.name || '';
    }
    const row = await this.prisma.$transaction(async tx => {
      const task = await tx.task.create({ data: { object_id: objectId, object_type: 'T', number, dept_id: deptId, staff_id: idOrZero(input.assigneeId) || BigInt(staffId || 0), duedate: due, created: now, updated: now } });
      await tx.taskCdata.create({ data: { task_id: task.id, title } });
      return task;
    });
    return { task: this.taskView(row, title, departmentName) };
  }

  async updateTask(id: string, input: any) {
    if (!/^\d+$/.test(String(id))) throw new NotFoundException('Task not found.');
    const task = await this.prisma.task.findUnique({ where: { id: bi(id) } });
    if (!task) throw new NotFoundException('Task not found.');
    const now = new Date();
    const data: any = { updated: now };
    if (input.deptId !== undefined || input.departmentName !== undefined) {
      const department = await this.taskDepartment(input);
      data.dept_id = department?.id ?? 0n;
    }
    if (input.assigneeId !== undefined) data.staff_id = idOrZero(input.assigneeId);
    if (input.ticketId !== undefined) data.object_id = idOrZero(input.ticketId);
    if (input.dueAt !== undefined) {
      const due = input.dueAt ? new Date(String(input.dueAt)) : null;
      if (due && Number.isNaN(due.getTime())) throw new BadRequestException('Choose a valid due date.');
      data.duedate = due;
    }
    if (input.status !== undefined) {
      const closed = String(input.status).toLowerCase() === 'closed';
      data.closed = closed ? (task.closed || now) : null;
    }
    const title = input.title !== undefined ? this.security.clean(input.title, 255) : undefined;
    if (input.title !== undefined && !title) throw new BadRequestException('Task title is required.');
    await this.prisma.$transaction(async tx => {
      await tx.task.update({ where: { id: task.id }, data });
      if (title !== undefined) await tx.taskCdata.upsert({ where: { task_id: task.id }, create: { task_id: task.id, title }, update: { title } });
    });
    const refreshed = await this.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    const cdata = await this.prisma.taskCdata.findUnique({ where: { task_id: task.id } });
    const department = refreshed.dept_id ? await this.prisma.department.findUnique({ where: { id: refreshed.dept_id }, select: { name: true } }) : null;
    return { task: this.taskView(refreshed, cdata?.title || '', department?.name || '') };
  }


  private async topicTicketNumber(topic: any) {
    if (!topic || !(Number(topic.flags || 0) & TOPIC_FLAG_CUSTOM_NUMBERS)) return null;
    const format = String(topic.number_format || '######');
    const digits = Math.max(6, sequenceDigitCount(format));
    let sequence: any = null;
    if (Number(topic.sequence_id || 0) > 0) {
      sequence = await this.prisma.sequence.findUnique({ where: { id: BigInt(String(topic.sequence_id)) } });
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      let value: bigint;
      let padding = '0';
      if (sequence) {
        value = sequence.next;
        const increment = BigInt(sequence.increment || 1);
        await this.prisma.sequence.update({ where: { id: sequence.id }, data: { next: value + increment, updated: new Date() } });
        padding = sequence.padding || '0';
        sequence = { ...sequence, next: value + increment };
      } else {
        value = randomSequenceNumber(digits);
      }
      const candidate = formatSequenceNumber(format, value.toString(), padding);
      if (candidate.length > 20) throw new BadRequestException('The generated ticket number is longer than the 20 character limit.');
      const duplicate = await this.prisma.ticket.findUnique({ where: { number: candidate }, select: { ticket_id: true } });
      if (!duplicate) return candidate;
    }
    return randomBytes(6).toString('hex').toUpperCase();
  }

  async create(input: any, ip = '', uploads: Array<{originalname:string;mimetype:string;buffer:Buffer;size:number}> = []) {
    const data = typeof input.ticket === 'string' ? JSON.parse(input.ticket) : input;
    const email = this.security.email(data.email || data.requesterEmail), name = this.security.clean(data.name || data.requesterName, 128);
    const subject = this.security.clean(data.subject, 255), message = this.security.clean(data.message || data.body, 20000);
    if (!name || !this.security.validEmail(email) || !subject || !message) throw new BadRequestException('Name, valid email, subject, and message are required.');
    const banConfig = await this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_app_state', key: 'banlist' } } });
    const banlist = parse(banConfig?.value);
    if (Array.isArray(banlist) && banlist.some((item: any) => String(item.email || '').toLowerCase() === email.toLowerCase())) throw new ForbiddenException('This email address is on the ban list.');
    const userId = await this.ensureUser(name, email);
    const address = await this.prisma.userEmail.findUnique({ where: { address: email } });
    const defaultStatus = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: 'open', mode: 'insensitive' } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }) || await this.prisma.ticketStatus.findFirst({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    if (!address || !defaultStatus) throw new BadRequestException('Ticket system is missing the requester email or an initial status.');

    const helpTopic = data.topicId
      ? await this.prisma.helpTopic.findUnique({ where: { topic_id: bi(data.topicId) } })
      : data.topic
        ? await this.prisma.helpTopic.findFirst({ where: { topic: { equals: String(data.topic), mode: 'insensitive' } } })
        : null;
    if ((data.topicId || data.topic) && !helpTopic) throw new BadRequestException('Choose a valid help topic.');
    const topicStatus = helpTopic && Number(helpTopic.status_id) > 0
      ? await this.prisma.ticketStatus.findUnique({ where: { id: helpTopic.status_id } })
      : null;
    const status = topicStatus || defaultStatus;

    const dept = data.departmentId ? await this.prisma.department.findUnique({where:{id:bi(data.departmentId)}}) : data.department ? await this.prisma.department.findFirst({where:{name:{equals:String(data.department),mode:'insensitive'}}}) : null;
    const topicDept = helpTopic && Number(helpTopic.dept_id) > 0
      ? await this.prisma.department.findUnique({ where: { id: helpTopic.dept_id } })
      : null;
    const effectiveDept = dept || topicDept;
    const topicPriority = helpTopic && Number(helpTopic.priority_id) > 0
      ? await this.prisma.ticketPriority.findUnique({ where: { priority_id: Number(helpTopic.priority_id) } })
      : null;
    const priority = this.security.clean(data.priority, 32) || topicPriority?.priority || 'normal';
    const branch = data.branchId ? await this.prisma.branch.findFirst({where:{id:bi(data.branchId),active:1}}) : null;
    if(data.branchId && !branch) throw new BadRequestException('Selected branch is unavailable.');
    const assigneeEmail=this.security.email(data.assigneeEmail); const assignee=assigneeEmail?await this.prisma.staff.findFirst({where:{email:{equals:assigneeEmail,mode:'insensitive'},isactive:1}}):null;
    if(assigneeEmail&&!assignee) throw new BadRequestException('Choose an active agent or administrator.');
    const topicStaff = helpTopic && Number(helpTopic.staff_id) > 0
      ? await this.prisma.staff.findFirst({ where: { staff_id: Number(helpTopic.staff_id), isactive: 1 } })
      : null;
    const topicTeam = helpTopic && Number(helpTopic.team_id) > 0
      ? await this.prisma.team.findUnique({ where: { team_id: helpTopic.team_id } })
      : null;
    const staffId = assignee?.staff_id ? BigInt(assignee.staff_id) : topicStaff?.staff_id ? BigInt(topicStaff.staff_id) : 0n;
    const teamId = !staffId && topicTeam ? topicTeam.team_id : 0n;
    const rawSlaId = String(data.slaId ?? '');
    const slaId = /^\d+$/.test(rawSlaId) && rawSlaId !== '0'
      ? BigInt(rawSlaId)
      : helpTopic && Number(helpTopic.sla_id) > 0 ? helpTopic.sla_id : 0n;

    const timestamp = new Date();
    const requestedNumber = this.security.clean(data.number, 20);
    const number = requestedNumber
      || (await this.topicTicketNumber(helpTopic))
      || randomBytes(6).toString('hex').toUpperCase();
    const duplicate = await this.prisma.ticket.findUnique({ where: { number } });
    if (duplicate) { const owner=await this.prisma.userEmail.findUnique({where:{id:duplicate.user_email_id}}); if(owner?.address.toLowerCase()!==email) throw new BadRequestException('Ticket number is already in use.'); return {duplicate:true}; }
    const accessToken = randomBytes(32).toString('base64url');
    const ticket = await this.prisma.$transaction(async tx => {
      const t = await tx.ticket.create({ data: { number, user_id: userId, user_email_id: address.id, status_id: status.id, dept_id: effectiveDept?.id || 0n, topic_id: helpTopic?.topic_id || 0n, staff_id: staffId, team_id: teamId, sla_id: slaId, source: data.source === 'email' ? 'EMAIL' : data.source === 'phone' ? 'PHONE' : 'WEB', ip_address: ip, created: timestamp, updated: timestamp } });
      await tx.ticketCdata.create({ data: { ticket_id: t.ticket_id, subject, priority, employee_id: String(data.employeeId || ''), branch_id: bi(data.branchId) } });
      const th = await tx.thread.create({ data: { object_id: t.ticket_id, object_type: 'T', extra: JSON.stringify({ accessHash: createHash('sha256').update(accessToken).digest('hex'), fromEmail: this.security.clean(data.fromEmail,254), collaboratorNotice: ['all','user','none'].includes(data.collaboratorNotice)?data.collaboratorNotice:'all' }), created: timestamp } });
      const entry = await tx.threadEntry.create({ data: { thread_id: th.id, user_id: userId, type: 'M', poster: name, title: subject, body: message, ip_address: ip, created: timestamp, updated: timestamp } });
      await tx.threadEvent.create({
        data: {
          thread_id: th.id,
          thread_type: 'T',
          event_id: 1n,
          staff_id: staffId,
          team_id: teamId,
          dept_id: effectiveDept?.id || 0n,
          topic_id: helpTopic?.topic_id || 0n,
          username: name || 'SYSTEM',
          uid: userId,
          uid_type: 'U',
          timestamp,
        },
      });
      if (staffId) {
        await tx.threadEvent.create({
          data: {
            thread_id: th.id,
            thread_type: 'T',
            event_id: 4n,
            staff_id: staffId,
            team_id: teamId,
            dept_id: effectiveDept?.id || 0n,
            topic_id: helpTopic?.topic_id || 0n,
            username: name || 'SYSTEM',
            uid: userId,
            uid_type: 'U',
            timestamp,
          },
        });
      }
      await this.saveAttachments(tx, entry.id, uploads, timestamp);
      const collaborators=Array.isArray(data.collaborators)?data.collaborators:[];
      for(const person of collaborators){ const collaboratorEmail=this.security.email(person?.email); if(!this.security.validEmail(collaboratorEmail)||collaboratorEmail===email||person?.active===false) continue; const collaboratorId=await this.ensureUser(this.security.clean(person?.name,128)||collaboratorEmail,collaboratorEmail); await tx.threadCollaborator.create({data:{thread_id:Number(th.id),user_id:Number(collaboratorId),flags:1,created:timestamp,updated:timestamp}}); }
      return t;
    });
    const view = await this.view(ticket);
    if (!helpTopic?.noautoresp) {
      void this.mail.sendNotice(email, 'Ticket #' + number + ' received', 'Your ticket has been created: ' + subject + '\n\n' + message, number);
    }
    const thankYouPage = helpTopic && Number(helpTopic.page_id) > 0
      ? await this.prisma.content.findUnique({ where: { id: helpTopic.page_id } })
      : null;
    const { accessHash, requesterEmail, ...safeTicket } = view;
    return {
      ticket: safeTicket,
      accessToken,
      thankYouPage: thankYouPage ? { id: String(thankYouPage.id), name: thankYouPage.name, body: thankYouPage.body } : null,
    };
  }

  private async ensureUser(name: string, email: string) {
    const old = await this.prisma.userEmail.findUnique({ where: { address: email } });
    if (old) return old.user_id;
    return this.prisma.$transaction(async tx => {
      const u = await tx.user.create({ data: { name, created: new Date(), updated: new Date() } });
      const e = await tx.userEmail.create({ data: { user_id: u.id, address: email } });
      await tx.user.update({ where: { id: u.id }, data: { default_email_id: e.id } });
      await tx.userCdata.create({ data: { user_id: u.id, name, email } });
      return u.id;
    });
  }

  private async saveAttachments(tx: any, entryId: bigint, uploads: Array<{ originalname: string; mimetype: string; buffer: Buffer; size: number }>, timestamp: Date) {
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

  async reply(number: string, body: any, sessionToken: string, accessToken: string, uploads: Array<{ originalname: string; mimetype: string; buffer: Buffer; size: number }> = []) {
    const { row, view } = await this.get(number);
    const session = this.security.readSession(sessionToken);
    const actor = session ? await this.prisma.userEmail.findFirst({ where: { address: { equals: session.email, mode: 'insensitive' } } }) : null;
    const staffRow = session ? await this.prisma.staff.findFirst({ where: { email: { equals: session.email, mode: 'insensitive' }, isactive: 1 } }) : null;
    const staffExtra = parse(staffRow?.extra), staff = Boolean(staffRow && Number(staffExtra.authVersion || 0) === session?.sessionVersion);
    const actorAccount = actor ? await this.prisma.userAccount.findUnique({ where: { user_id: actor.user_id } }) : null;
    const clientExtra = parse(actorAccount?.extra);
    const verification = actor ? await this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_user_verification', key: session?.email.toLowerCase() || '' } } }) : null;
    const client = Boolean(actorAccount?.backend === 'react' && actorAccount.status !== 0n && (clientExtra.role || 'client') === 'client' && (verification?.value || clientExtra.verificationStatus) === 'approved' && Number(clientExtra.authVersion || 0) === session?.sessionVersion);
    const email = this.security.email(body.requesterEmail || body.authorEmail || session?.email);
    const collaborator = view.collaborators.find((person: any) => person.active && person.email.toLowerCase() === email);
    const authenticatedRequester = Boolean(client && session?.email.toLowerCase() === email && (email === view.requesterEmail.toLowerCase() || collaborator));
    const hash = parse((await this.threadFor(row.ticket_id)).extra).accessHash;
    const given = createHash('sha256').update(accessToken || '').digest(), expected = Buffer.from(hash || '', 'hex');
    const validAccess = expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given) && email === view.requesterEmail.toLowerCase();
    if (!staff && !authenticatedRequester && !validAccess) throw new ForbiddenException('A valid ticket access token or signed-in requester account is required to reply.');
    const message = this.security.clean(body.message, 20000);
    if (!message) throw new BadRequestException('Reply message is required.');
    const timestamp = new Date(), thread = await this.threadFor(row.ticket_id);
    const internal = staff && body.internal === true;
    const entry = await this.prisma.$transaction(async tx => {
      const created = await tx.threadEntry.create({ data: { thread_id: thread.id, user_id: actor?.user_id || 0n, staff_id: BigInt(staffRow?.staff_id || 0), type: staff ? (internal ? 'N' : 'R') : 'M', poster: staff ? [staffRow?.firstname, staffRow?.lastname].filter(Boolean).join(' ') : collaborator?.name || view.requesterName, title: null, body: message, recipients: JSON.stringify(body.recipients || []), ip_address: '', created: timestamp, updated: timestamp } });
      await this.saveAttachments(tx, created.id, uploads, timestamp);
      return created;
    });
    const update: any = { updated: timestamp };
    let transitionEventId: bigint | null = null;
    if (!staff && view.status === 'closed') {
      const open = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: 'open', mode: 'insensitive' } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      if (open) {
        update.status_id = open.id;
        update.reopened = timestamp;
        update.closed = null;
        transitionEventId = 3n; // reopened
      }
    }
    if (staff && ['open','pending','closed'].includes(String(body.status))) {
      const next = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: String(body.status), mode: 'insensitive' } }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      if (next) {
        update.status_id = next.id;
        if (String(body.status) === 'closed' && view.status !== 'closed') {
          update.closed = timestamp;
          update.isoverdue = 0;
          transitionEventId = 2n; // closed
        } else if (String(body.status) !== 'closed' && view.status === 'closed') {
          update.reopened = timestamp;
          update.closed = null;
          transitionEventId = 3n; // reopened
        }
      }
    }
    await this.prisma.ticket.update({ where: { ticket_id: row.ticket_id }, data: update });
    if (transitionEventId) {
      await this.prisma.threadEvent.create({
        data: {
          thread_id: thread.id,
          thread_type: 'T',
          event_id: transitionEventId,
          staff_id: BigInt(staffRow?.staff_id || row.staff_id || 0),
          team_id: row.team_id,
          dept_id: row.dept_id,
          topic_id: row.topic_id,
          username: staff ? [staffRow?.firstname, staffRow?.lastname].filter(Boolean).join(' ') : (collaborator?.name || view.requesterName || 'SYSTEM'),
          uid: staff ? BigInt(staffRow?.staff_id || 0) : (actor?.user_id || 0n),
          uid_type: staff ? 'S' : 'U',
          timestamp,
        },
      });
    }
    const recipients = staff ? (Array.isArray(body.recipients) ? body.recipients : [view.requesterEmail]) : [view.requesterEmail];
    if (!internal) void this.mail.sendNotice(recipients, (staff ? 'Reply to' : 'Customer reply on') + ' ticket #' + number, message, number);
    const attached = await this.prisma.attachment.findMany({ where: { object_id: entry.id, type: 'H' }, orderBy: { id: 'asc' } });
    return { message: { id: String(entry.id), ticketNumber: number, author: entry.poster, authorEmail: staff ? session!.email : email, kind: staff ? 'agent' : collaborator ? 'collaborator' : 'client', internal, body: message, attachments: attached.map(item => item.name || ''), attachmentFiles: attached.map(item => ({ id: String(item.id), name: item.name || '' })), recipients, createdAt: timestamp.toISOString() }, ticket: await this.view(await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: row.ticket_id } })) };
  }

  async update(number: string, input: any) {
    const { row } = await this.get(number);
    const now = new Date();
    const ticketUpdate: any = { updated: now };
    const eventsToCreate: Array<{
      event_id: bigint;
      staff_id?: bigint;
      team_id?: bigint;
      dept_id?: bigint;
      topic_id?: bigint;
    }> = [];

    if (input.statusId !== undefined || input.status !== undefined) {
      const status = await this.resolveStatus(input.statusId, input.status);
      ticketUpdate.status_id = status.id;
      const nextState = String(status.state || status.name || '').toLowerCase();
      const currentStatusRow = await this.prisma.ticketStatus.findUnique({ where: { id: row.status_id } });
      const currentState = String(currentStatusRow?.state || currentStatusRow?.name || 'open').toLowerCase();
      if (nextState === 'closed' && currentState !== 'closed') {
        ticketUpdate.closed = now;
        ticketUpdate.isoverdue = 0;
        eventsToCreate.push({ event_id: 2n });
      } else if (nextState !== 'closed' && currentState === 'closed') {
        ticketUpdate.reopened = now;
        ticketUpdate.closed = null;
        eventsToCreate.push({ event_id: 3n });
      }
    }
    if (input.overdue !== undefined) {
      ticketUpdate.isoverdue = input.overdue ? 1 : 0;
      if (input.overdue && !row.isoverdue) {
        eventsToCreate.push({ event_id: 8n });
      }
    }
    if (input.assigneeEmail !== undefined) {
      const staff = input.assigneeEmail ? await this.prisma.staff.findFirst({ where: { email: { equals: String(input.assigneeEmail), mode: 'insensitive' }, isactive: 1 } }) : null;
      if (input.assigneeEmail && !staff) throw new BadRequestException('Choose an active agent or administrator.');
      ticketUpdate.staff_id = BigInt(staff?.staff_id || 0);
      if (staff && BigInt(staff.staff_id) !== row.staff_id) {
        eventsToCreate.push({ event_id: 4n, staff_id: BigInt(staff.staff_id) });
      } else if (!staff && row.staff_id > 0n) {
        eventsToCreate.push({ event_id: 5n, staff_id: 0n });
      }
    } else if (input.assignee !== undefined) throw new BadRequestException('Select an active agent from the staff directory.');
    const cdata: any = {};
    if (input.priority) {
      const priority = await this.prisma.ticketPriority.findFirst({ where: { priority: { equals: String(input.priority), mode: 'insensitive' } } });
      if (!priority) throw new BadRequestException('Choose a valid ticket priority.');
      cdata.priority = priority.priority;
    }
    if (input.subject !== undefined) cdata.subject = this.security.clean(input.subject, 255);
    if (input.department !== undefined) {
      const d = await this.prisma.department.findFirst({ where: { name: { equals: String(input.department), mode: 'insensitive' } } });
      if (!d) throw new BadRequestException('Choose a valid department.');
      ticketUpdate.dept_id = d.id;
      if (d.id !== row.dept_id) {
        eventsToCreate.push({ event_id: 6n, dept_id: d.id });
      }
    }
    if (input.topic !== undefined) {
      const topic = await this.prisma.helpTopic.findFirst({ where: { topic: { equals: String(input.topic), mode: 'insensitive' } } });
      if (!topic) throw new BadRequestException('Choose a valid help topic.');
      ticketUpdate.topic_id = topic.topic_id;
    }
    await this.prisma.$transaction(async tx => {
      await tx.ticket.update({ where: { ticket_id: row.ticket_id }, data: ticketUpdate });
      if (Object.keys(cdata).length) await tx.ticketCdata.upsert({ where: { ticket_id: row.ticket_id }, create: { ticket_id: row.ticket_id, ...cdata }, update: cdata });
      if (eventsToCreate.length) {
        const thread = await this.threadFor(row.ticket_id);
        for (const ev of eventsToCreate) {
          await tx.threadEvent.create({
            data: {
              thread_id: thread.id,
              thread_type: 'T',
              event_id: ev.event_id,
              staff_id: ev.staff_id ?? ticketUpdate.staff_id ?? row.staff_id,
              team_id: ev.team_id ?? row.team_id,
              dept_id: ev.dept_id ?? ticketUpdate.dept_id ?? row.dept_id,
              topic_id: ev.topic_id ?? ticketUpdate.topic_id ?? row.topic_id,
              username: 'SYSTEM',
              timestamp: now,
            },
          });
        }
      }
    });
    return { ticket: await this.view(await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: row.ticket_id } })) };
  }

  async banEmail(number: string) {
    const { view } = await this.get(number);
    const email = view.requesterEmail.toLowerCase();
    if (!email) throw new NotFoundException('Ticket requester email was not found.');
    const key = 'banlist';
    const current = await this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_app_state', key } } });
    const banlist = parse(current?.value);
    const records: Array<{ id: string; email: string; reason: string }> = Array.isArray(banlist) ? banlist : [];
    const existing = records.find((item) => String(item.email || '').toLowerCase() === email);
    const entry = existing || { id: `ban-${randomUUID()}`, email, reason: `Banned from ticket #${view.number}` };
    if (!existing) records.push(entry);
    const value = JSON.stringify(records);
    await this.prisma.config.upsert({
      where: { namespace_key: { namespace: 'react_app_state', key } },
      create: { namespace: 'react_app_state', key, value },
      update: { value, updated: new Date() },
    });
    return { banned: true, email, reason: entry.reason };
  }

  async delete(number: string) {
    const row = await this.prisma.ticket.findFirst({ where: { OR: [{ number }, ...(/^\d+$/.test(number) ? [{ ticket_id: bi(number) }] : [])] } });
    if (!row) throw new NotFoundException('Ticket not found.');
    await this.prisma.$transaction(async (tx) => {
      const thread = await tx.thread.findUnique({ where: { object_id_object_type: { object_id: row.ticket_id, object_type: 'T' } } });
      await tx.threadEvent.create({
        data: {
          thread_id: thread?.id || 0n,
          thread_type: 'T',
          event_id: 14n,
          staff_id: row.staff_id,
          team_id: row.team_id,
          dept_id: row.dept_id,
          topic_id: row.topic_id,
          username: 'SYSTEM',
          timestamp: new Date(),
        },
      });
      if (thread) {
        const entries = await tx.threadEntry.findMany({ where: { thread_id: thread.id }, select: { id: true } });
        const entryIds = entries.map((entry) => entry.id);
        const attachments = entryIds.length ? await tx.attachment.findMany({ where: { object_id: { in: entryIds } }, select: { file_id: true } }) : [];
        await tx.threadCollaborator.deleteMany({ where: { thread_id: Number(thread.id) } });
        if (entryIds.length) {
          await tx.attachment.deleteMany({ where: { object_id: { in: entryIds } } });
          await tx.threadEntry.deleteMany({ where: { thread_id: thread.id } });
        }
        await tx.thread.delete({ where: { id: thread.id } });
        for (const fileId of [...new Set(attachments.map((attachment) => attachment.file_id.toString()))].map((value) => BigInt(value))) {
          if (!(await tx.attachment.count({ where: { file_id: fileId } }))) {
            await tx.fileChunk.deleteMany({ where: { file_id: fileId } });
            await tx.file.deleteMany({ where: { id: fileId } });
          }
        }
      }
      await tx.task.deleteMany({ where: { object_id: row.ticket_id, object_type: 'T' } });
      await tx.ticket.updateMany({ where: { ticket_pid: row.ticket_id }, data: { ticket_pid: null } });
      await tx.ticketCdata.deleteMany({ where: { ticket_id: row.ticket_id } });
      await tx.ticket.delete({ where: { ticket_id: row.ticket_id } });
    });
    return { deleted: true };
  }

  async setCollaborators(number: string, raw: any[]) {
    const { row } = await this.get(number);
    const requester = (await this.prisma.userEmail.findUnique({ where: { id: row.user_email_id } }))?.address.toLowerCase() || '';
    const unique = new Map<string, { name: string; email: string; active: boolean }>();
    for (const person of Array.isArray(raw) ? raw : []) {
      const email = this.security.email(person?.email);
      if (!this.security.validEmail(email) || email === requester) continue;
      unique.set(email, { name: this.security.clean(person?.name, 128) || email, email, active: person?.active !== false });
    }
    const thread = await this.threadFor(row.ticket_id);
    await this.prisma.$transaction(async tx => {
      await tx.threadCollaborator.deleteMany({ where: { thread_id: Number(thread.id) } });
      for (const person of unique.values()) {
        if (!person.active) continue;
        const userId = await this.ensureUser(person.name, person.email);
        await tx.threadCollaborator.create({ data: { thread_id: Number(thread.id), user_id: Number(userId), flags: 1, created: new Date(), updated: new Date() } });
      }
      await tx.ticket.update({ where: { ticket_id: row.ticket_id }, data: { updated: new Date() } });
    });
    return { collaborators: [...unique.values()] };
  }

  async setBranch(number: string, branchId: string) {
    const { row } = await this.get(number);
    const branch = branchId ? await this.prisma.branch.findFirst({ where: { id: bi(branchId), active: 1 } }) : null;
    if (branchId && !branch) throw new BadRequestException('Selected branch is unavailable.');
    const data = await this.prisma.ticketCdata.findUnique({ where: { ticket_id: row.ticket_id } });
    await this.prisma.$transaction([
      this.prisma.ticketCdata.update({ where: { ticket_id: row.ticket_id }, data: { branch_id: bi(branchId) } }),
      this.prisma.ticket.update({ where: { ticket_id: row.ticket_id }, data: { updated: new Date() } }),
    ]);
    return { ticket: await this.view(row) };
  }
}
