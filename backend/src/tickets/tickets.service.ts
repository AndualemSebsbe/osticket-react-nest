import { Inject, BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiSecurityService } from '../common/api-security.service';
import { MailService } from '../mail/mail.service';

const bi = (v: unknown) => BigInt(String(v || 0));
const parse = (s?: string | null) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

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
      return { name: userRow?.name || email?.address || '', email: email?.address || '', active: Boolean(c.flags & 1) };
    }));
    const statusName = (status?.state || status?.name || 'open').toLowerCase();
    const priorityName = (data?.priority || 'normal').toLowerCase();
    const accessHash = parse(thread?.extra).accessHash;
    return {
      id: String(row.ticket_id), number: row.number || String(row.ticket_id), subject: data?.subject || '(no subject)',
      requesterName: user?.name || '', requesterEmail: userEmail?.address || '', status: statusName,
      priority: priorityName, department: dept?.name || '', departmentId: String(row.dept_id),
      topic: topic?.topic || '', topicId: String(row.topic_id), branchId: String(data?.branch_id || ''),
      branchName: branch?.name || '', assignee: staff ? [staff.firstname, staff.lastname].filter(Boolean).join(' ') : '',
      assigneeEmail: staff?.email || '', assigneeStaffId: String(row.staff_id || ''),
      overdue: Boolean(row.isoverdue), createdAt: row.created.toISOString(), updatedAt: row.updated.toISOString(),
       collaborators: collaboratorViews, accessHash, fromEmail: threadExtra.fromEmail || '', collaboratorNotice: threadExtra.collaboratorNotice || 'all', messages: entries.map(e => { const attached = files.filter(f=>f.entryId===String(e.id)); return { id: String(e.id), author: e.poster, authorEmail: '', kind: e.type === 'R' ? 'agent' : e.type === 'N' ? 'note' : 'client', internal: e.type === 'N', body: e.body, attachments: attached.map(f=>f.name), attachmentFiles: attached.map(f=>({ id: f.id, name: f.name })), recipients: parse(e.recipients).list || [], createdAt: e.created.toISOString() } }),
    };
  }

  async listApi() {
    const rows = await this.prisma.ticket.findMany({ orderBy: { updated: 'desc' }, take: 1000 });
    return Promise.all(rows.map(async t => { const v=await this.view(t); const {accessHash,...safe}=v; return safe; }));
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
    const status = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: 'open', mode: 'insensitive' } } }) || await this.prisma.ticketStatus.findFirst({ orderBy: { sort: 'asc' } });
    if (!address || !status) throw new BadRequestException('Ticket system is missing the requester email or an initial status.');
    const timestamp = new Date(), number = this.security.clean(data.number,32) || randomBytes(6).toString('hex').toUpperCase();
    const duplicate = await this.prisma.ticket.findUnique({ where: { number } });
    if (duplicate) { const owner=await this.prisma.userEmail.findUnique({where:{id:duplicate.user_email_id}}); if(owner?.address.toLowerCase()!==email) throw new BadRequestException('Ticket number is already in use.'); return {duplicate:true}; }
    const dept = data.departmentId ? await this.prisma.department.findUnique({where:{id:bi(data.departmentId)}}) : data.department ? await this.prisma.department.findFirst({where:{name:{equals:String(data.department),mode:'insensitive'}}}) : null;
    const helpTopic = data.topicId ? await this.prisma.helpTopic.findUnique({where:{topic_id:bi(data.topicId)}}) : data.topic ? await this.prisma.helpTopic.findFirst({where:{topic:{equals:String(data.topic),mode:'insensitive'}}}) : null;
    const branch = data.branchId ? await this.prisma.branch.findFirst({where:{id:bi(data.branchId),active:1}}) : null;
    if(data.branchId && !branch) throw new BadRequestException('Selected branch is unavailable.');
    const assigneeEmail=this.security.email(data.assigneeEmail); const assignee=assigneeEmail?await this.prisma.staff.findFirst({where:{email:{equals:assigneeEmail,mode:'insensitive'},isactive:1}}):null;
    if(assigneeEmail&&!assignee) throw new BadRequestException('Choose an active agent or administrator.');
    const accessToken = randomBytes(32).toString('base64url');
    const ticket = await this.prisma.$transaction(async tx => {
      const t = await tx.ticket.create({ data: { number, user_id: userId, user_email_id: address.id, status_id: status.id, dept_id: dept?.id || 0n, topic_id: helpTopic?.topic_id || 0n, staff_id: BigInt(assignee?.staff_id || 0), source: data.source === 'email' ? 'EMAIL' : data.source === 'phone' ? 'PHONE' : 'WEB', ip_address: ip, created: timestamp, updated: timestamp } });
      await tx.ticketCdata.create({ data: { ticket_id: t.ticket_id, subject, priority: String(data.priority || 'normal'), employee_id: String(data.employeeId || ''), branch_id: bi(data.branchId) } });
      const th = await tx.thread.create({ data: { object_id: t.ticket_id, object_type: 'T', extra: JSON.stringify({ accessHash: createHash('sha256').update(accessToken).digest('hex'), fromEmail: this.security.clean(data.fromEmail,254), collaboratorNotice: ['all','user','none'].includes(data.collaboratorNotice)?data.collaboratorNotice:'all' }), created: timestamp } });
      const entry = await tx.threadEntry.create({ data: { thread_id: th.id, user_id: userId, type: 'M', poster: name, title: subject, body: message, ip_address: ip, created: timestamp, updated: timestamp } });
      if (uploads.length > 5 || uploads.some(file => file.size > 8 * 1024 * 1024)) throw new BadRequestException('You can attach up to five files of 8 MB each.');
      let total = 0;
      for (const upload of uploads) { const filename=String(upload.originalname||'attachment').replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,255); const ext=filename.split('.').pop()?.toLowerCase()||''; if(!['pdf','png','jpg','jpeg','gif','webp','txt','csv','doc','docx','xls','xlsx','zip'].includes(ext)) throw new BadRequestException('Unsupported attachment type.'); total+=upload.size; const file=await tx.file.create({data:{name:filename,type:/^[\w.+-]+\/[\w.+-]+$/.test(upload.mimetype)?upload.mimetype:'application/octet-stream',size:BigInt(upload.size),key:randomBytes(32).toString('hex'),signature:createHash('sha256').update(upload.buffer).digest('hex'),created:timestamp}}); await tx.fileChunk.create({data:{file_id:file.id,chunk_id:0,filedata:Uint8Array.from(upload.buffer)}}); await tx.attachment.create({data:{object_id:entry.id,type:'H',file_id:file.id,name:filename}}); }
      if(total>15*1024*1024) throw new BadRequestException('Combined attachments are too large.');
      const collaborators=Array.isArray(data.collaborators)?data.collaborators:[];
      for(const person of collaborators){ const collaboratorEmail=this.security.email(person?.email); if(!this.security.validEmail(collaboratorEmail)||collaboratorEmail===email||person?.active===false) continue; const collaboratorId=await this.ensureUser(this.security.clean(person?.name,128)||collaboratorEmail,collaboratorEmail); await tx.threadCollaborator.create({data:{thread_id:Number(th.id),user_id:Number(collaboratorId),flags:1,created:timestamp,updated:timestamp}}); }
      return t;
    });
    const view = await this.view(ticket);
    void this.mail.sendNotice(email, 'Ticket #' + number + ' received', 'Your ticket has been created: ' + subject + '\n\n' + message, number);
    const { accessHash, requesterEmail, ...safeTicket } = view;
    return { ticket: safeTicket, accessToken };
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

  async reply(number: string, body: any, sessionToken: string, accessToken: string) {
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
    const entry = await this.prisma.threadEntry.create({ data: { thread_id: thread.id, user_id: actor?.user_id || 0n, staff_id: BigInt(staffRow?.staff_id || 0), type: staff ? (internal ? 'N' : 'R') : 'M', poster: staff ? [staffRow?.firstname, staffRow?.lastname].filter(Boolean).join(' ') : collaborator?.name || view.requesterName, title: null, body: message, recipients: JSON.stringify(body.recipients || []), ip_address: '', created: timestamp, updated: timestamp } });
    const update: any = { updated: timestamp };
    if (!staff && view.status === 'closed') {
      const open = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: 'open', mode: 'insensitive' } } });
      if (open) update.status_id = open.id;
    }
    if (staff && ['open','pending','closed'].includes(String(body.status))) {
      const next = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: String(body.status), mode: 'insensitive' } } });
      if (next) update.status_id = next.id;
    }
    await this.prisma.ticket.update({ where: { ticket_id: row.ticket_id }, data: update });
    const recipients = staff ? (Array.isArray(body.recipients) ? body.recipients : [view.requesterEmail]) : [view.requesterEmail];
    if (!internal) void this.mail.sendNotice(recipients, (staff ? 'Reply to' : 'Customer reply on') + ' ticket #' + number, message, number);
    return { message: { id: String(entry.id), ticketNumber: number, author: entry.poster, authorEmail: staff ? session!.email : email, kind: staff ? 'agent' : collaborator ? 'collaborator' : 'client', internal, body: message, attachments: [], recipients, createdAt: timestamp.toISOString() }, ticket: await this.view(await this.prisma.ticket.findUniqueOrThrow({ where: { ticket_id: row.ticket_id } })) };
  }

  async update(number: string, input: any) {
    const { row } = await this.get(number);
    const now = new Date();
    const ticketUpdate: any = { updated: now };
    if (input.status) {
      const status = await this.prisma.ticketStatus.findFirst({ where: { state: { equals: String(input.status), mode: 'insensitive' } } });
      if (!status) throw new BadRequestException('Choose a valid ticket status.');
      ticketUpdate.status_id = status.id;
    }
    if (input.overdue !== undefined) ticketUpdate.isoverdue = input.overdue ? 1 : 0;
    if (input.assigneeEmail !== undefined) {
      const staff = input.assigneeEmail ? await this.prisma.staff.findFirst({ where: { email: { equals: String(input.assigneeEmail), mode: 'insensitive' }, isactive: 1 } }) : null;
      if (input.assigneeEmail && !staff) throw new BadRequestException('Choose an active agent or administrator.');
      ticketUpdate.staff_id = BigInt(staff?.staff_id || 0);
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
    }
    if (input.topic !== undefined) {
      const topic = await this.prisma.helpTopic.findFirst({ where: { topic: { equals: String(input.topic), mode: 'insensitive' } } });
      if (!topic) throw new BadRequestException('Choose a valid help topic.');
      ticketUpdate.topic_id = topic.topic_id;
    }
    await this.prisma.$transaction(async tx => {
      await tx.ticket.update({ where: { ticket_id: row.ticket_id }, data: ticketUpdate });
      if (Object.keys(cdata).length) await tx.ticketCdata.upsert({ where: { ticket_id: row.ticket_id }, create: { ticket_id: row.ticket_id, ...cdata }, update: cdata });
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
