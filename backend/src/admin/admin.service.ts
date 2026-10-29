import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes, scryptSync } from 'node:crypto';

const key = (value: unknown) => BigInt(String(value || 0));
const stamp = () => new Date();
const flag = (value: unknown) => Number(value ?? 1) ? 1 : 0;
const extraOf = (value?: string | null) => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async options() {
    const [departments, slas, priorities] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.sla.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.ticketPriority.findMany({ orderBy: { priority_urgency: 'asc' } }),
    ]);
    return { departments: departments.map(d => ({ id: String(d.id), name: d.name })), slas: slas.map(s => ({ id: String(s.id), name: s.name })), priorities: priorities.map(p => p.priority) };
  }

  private departmentView(d: any, lookup: any = {}) {
    const flags = Number(d.flags || 0);
    return {
      id: String(d.id), name: d.name, parentId: String(d.pid || ''),
      status: flags & 4 ? 'active' : flags & 8 ? 'archived' : 'disabled',
      type: d.ispublic ? 'public' : 'private', signature: d.signature || '',
      slaId: String(d.sla_id || 0), scheduleId: String(d.schedule_id || 0),
      managerId: String(d.manager_id || 0), emailId: String(d.email_id || 0),
      templateId: String(d.tpl_id || 0), autoresponderEmailId: String(d.autoresp_email_id || 0),
      assignment: flags & 16 ? 'primary' : flags & 1 ? 'members' : 'all',
      disableAutoClaim: Boolean(flags & 2), disableReopenAutoAssign: Boolean(flags & 32),
      alertRecipients: Number(d.group_membership ?? 1), ticketAutoResponse: Boolean(d.ticket_auto_response),
      messageAutoResponse: Boolean(d.message_auto_response),
      parentName: lookup.departments?.find((x: any) => String(x.id) === String(d.pid))?.name || '',
      managerName: lookup.staff?.find((x: any) => String(x.id) === String(d.manager_id))?.name || '',
      emailName: lookup.emails?.find((x: any) => String(x.id) === String(d.email_id))?.name || '',
      slaName: lookup.slas?.find((x: any) => String(x.id) === String(d.sla_id))?.name || '',
      scheduleName: lookup.schedules?.find((x: any) => String(x.id) === String(d.schedule_id))?.name || '',
      templateName: lookup.templates?.find((x: any) => String(x.id) === String(d.tpl_id))?.name || '',
    };
  }

  async departmentOptions() {
    const [departments, staff, slas, schedules, emails, templates, roles, access] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.staff.findMany({ orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.sla.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.schedule.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.email.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.emailTemplateGroup.findMany({ where: { isactive: 1 }, orderBy: { name: 'asc' } }),
      this.prisma.role.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.staffDeptAccess.findMany(),
    ]);
    const staffRows = staff.map(s => ({ id: String(s.staff_id), name: [s.firstname, s.lastname].filter(Boolean).join(' ') || s.username, departmentId: String(s.dept_id) }));
    const lookups = {
      departments: departments.map(d => ({ id: String(d.id), name: d.name })), staff: staffRows,
      slas: slas.map(x => ({ id: String(x.id), name: x.name })),
      schedules: schedules.map(x => ({ id: String(x.id), name: x.name })),
      emails: emails.map(x => ({ id: String(x.email_id), name: x.name ? `${x.name} <${x.email}>` : x.email })),
      templates: templates.map(x => ({ id: String(x.tpl_id), name: x.name })),
      roles: roles.map(x => ({ id: String(x.id), name: x.name || '' })),
    };
    const rows = departments.map(d => ({ ...this.departmentView(d, lookups), primaryMembers: staffRows.filter(s => s.departmentId === String(d.id)).map(s => ({ ...s, primary: true, roleId: String(staff.find(x => String(x.staff_id) === s.id)?.role_id || 0), alerts: true })), extendedMembers: access.filter(a => a.dept_id === Number(d.id)).map(a => ({ ...staffRows.find(s => s.id === String(a.staff_id)), primary: false, roleId: String(a.role_id), alerts: Boolean(a.flags & 1) })).filter(x => x.id) }));
    return { ...lookups, departments: rows };
  }

  private async saveDepartment(data: any, id?: string) {
    const name = String(data.name || '').trim();
    if (!name) throw new ConflictException('Department name is required.');
    const parentId = data.parentId ? key(data.parentId) : null;
    const currentId = id ? key(id) : null;
    if (parentId && (parentId === currentId || !await this.prisma.department.findUnique({ where: { id: parentId } }))) throw new ConflictException('Choose a valid parent department.');
    if (parentId) {
      let ancestor: any = await this.prisma.department.findUnique({ where: { id: parentId }, select: { id: true, pid: true } });
      const seen = new Set<string>();
      while (ancestor) {
        const ancestorId = String(ancestor.id);
        if (ancestorId === String(currentId || '')) throw new ConflictException('A department cannot be nested beneath one of its own child departments.');
        if (seen.has(ancestorId)) break;
        seen.add(ancestorId);
        ancestor = ancestor.pid ? await this.prisma.department.findUnique({ where: { id: ancestor.pid }, select: { id: true, pid: true } }) : null;
      }
    }
    const current = currentId ? await this.prisma.department.findUnique({ where: { id: currentId } }) : null;
    const oldFlags = Number(current?.flags || 0);
    if (data.type === 'private') {
      const otherPublic = await this.prisma.department.count({ where: { ispublic: 1, ...(currentId ? { id: { not: currentId } } : {}) } });
      if (!otherPublic) throw new ConflictException('At least one department must remain public.');
    }
    const statusFlag = data.status === 'archived' ? 8 : data.status === 'disabled' ? 0 : 4;
    let flags = (oldFlags & ~ (4 | 8)) | statusFlag;
    flags = data.assignment === 'primary' ? flags | 16 : flags & ~16;
    flags = data.assignment === 'members' || data.assignment === 'primary' ? flags | 1 : flags & ~1;
    flags = data.disableAutoClaim ? flags | 2 : flags & ~2;
    flags = data.disableReopenAutoAssign ? flags | 32 : flags & ~32;
    const values: any = {
      name, pid: parentId, ispublic: data.type === 'private' ? 0 : 1, signature: String(data.signature || ''), flags,
      sla_id: Number(data.slaId || 0), schedule_id: Number(data.scheduleId || 0), manager_id: Number(data.managerId || 0),
      email_id: Number(data.emailId || 0), tpl_id: Number(data.templateId || 0), autoresp_email_id: Number(data.autoresponderEmailId || 0),
      group_membership: Number(data.alertRecipients ?? 1), ticket_auto_response: data.ticketAutoResponse === false ? 0 : 1,
      message_auto_response: data.messageAutoResponse === false ? 0 : 1, updated: stamp(),
    };
    const saved = currentId
      ? await this.prisma.department.update({ where: { id: currentId }, data: values })
      : await this.prisma.department.create({ data: { ...values, created: stamp() } });
    if (Array.isArray(data.extendedMembers)) {
      const deptId = Number(saved.id);
      await this.prisma.$transaction(async tx => {
        await tx.staffDeptAccess.deleteMany({ where: { dept_id: deptId } });
        const entries = data.extendedMembers.filter((m: any) => Number(m.staffId) > 0 && Number(m.roleId) > 0);
        for (const member of entries) {
          const staffMember = await tx.staff.findUnique({ where: { staff_id: Number(member.staffId) } });
          const role = await tx.role.findUnique({ where: { id: Number(member.roleId) } });
          if (!staffMember || !role || staffMember.dept_id === deptId) throw new ConflictException('Select a valid agent and role for extended department access.');
          await tx.staffDeptAccess.create({ data: { staff_id: staffMember.staff_id, dept_id: deptId, role_id: role.id, flags: member.alerts ? 1 : 0 } });
        }
      });
    }
    return saved;
  }

  private slaView(s: any, schedules: any[] = []) {
    const flags = Number(s.flags || 0);
    return { id: String(s.id), name: s.name, graceHours: Number(s.grace_period), active: Boolean(flags & 1), transient: Boolean(flags & 2), disableAlerts: Boolean(flags & 4), scheduleId: String(s.schedule_id || 0), scheduleName: schedules.find(x => String(x.id) === String(s.schedule_id))?.name || '', notes: s.notes || '' };
  }

  async slaOptions() {
    const [slas, schedules] = await Promise.all([this.prisma.sla.findMany({ orderBy: { name: 'asc' } }), this.prisma.schedule.findMany({ orderBy: { name: 'asc' } })]);
    const scheduleViews = schedules.map(x => ({ id: String(x.id), name: x.name, timezone: x.timezone || 'UTC', description: x.description || '' }));
    return { slas: slas.map(x => this.slaView(x, scheduleViews)), schedules: scheduleViews };
  }

  private async saveSla(data: any, rawId?: string) {
    const name = String(data.name || '').trim();
    const graceHours = Number(data.graceHours);
    if (!name || name.length > 64) throw new ConflictException('Enter an SLA plan name (up to 64 characters).');
    if (!Number.isInteger(graceHours) || graceHours < 0 || graceHours > 87600) throw new ConflictException('Grace period must be a whole number from 0 to 87600 hours.');
    const scheduleId = Number(data.scheduleId || 0);
    if (!Number.isInteger(scheduleId) || scheduleId < 0) throw new ConflictException('Choose a valid schedule.');
    if (scheduleId && !await this.prisma.schedule.findUnique({ where: { id: BigInt(scheduleId) }, select: { id: true } })) throw new ConflictException('The selected schedule does not exist.');
    const old = rawId ? await this.prisma.sla.findUnique({ where: { id: Number(rawId) } }) : null;
    let flags = Number(old?.flags ?? 0);
    for (const [field, bit] of [['active', 1], ['transient', 2], ['disableAlerts', 4]] as const) flags = data[field] ? flags | bit : flags & ~bit;
    const saved = rawId
      ? await this.prisma.sla.update({ where: { id: Number(rawId) }, data: { name, grace_period: graceHours, schedule_id: scheduleId, flags, notes: String(data.notes || '') || null, updated: stamp() } })
      : await this.prisma.sla.create({ data: { name, grace_period: graceHours, schedule_id: scheduleId, flags: flags || (data.active ? 1 : 0), notes: String(data.notes || '') || null, created: stamp(), updated: stamp() } });
    return this.slaView(saved, await this.prisma.schedule.findMany({ select: { id: true, name: true } }));
  }

  async list(kind: string): Promise<any[]> {
    switch (kind) {
      case 'departments': return (await this.departmentOptions()).departments;
      case 'sla-plans': return (await this.slaOptions()).slas;
      case 'branches':
      case 'branches-all': return (await this.prisma.branch.findMany({ where: kind === 'branches' ? { active: 1 } : {}, orderBy: { name: 'asc' } })).map(b => ({ id: String(b.id), name: b.name, active: Boolean(b.active) }));
      case 'staff': {
        const rows = await this.prisma.staff.findMany({ orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] });
        const departments = await this.prisma.department.findMany();
        const roles = await this.prisma.role.findMany();
        return rows.map(s => ({ staffId: String(s.staff_id), id: String(s.staff_id), name: [s.firstname, s.lastname].filter(Boolean).join(' ') || s.username, email: s.email || '', phone: s.phone, role: s.isadmin ? 'admin' : 'agent', active: Boolean(s.isactive), deptId: String(s.dept_id), deptName: departments.find(d => Number(d.id) === s.dept_id)?.name || '', roleId: String(s.role_id), roleName: roles.find(r => Number(r.id) === s.role_id)?.name || '', title: extraOf(s.extra).title || '', departmentAccess: [] }));
      }
      case 'users':
      case 'directory-users': {
        const users = await this.prisma.user.findMany({ orderBy: { created: 'desc' }, take: 1000 });
        const mapped = await Promise.all(users.map(async u => {
          const email = (await this.prisma.userEmail.findFirst({ where: { user_id: u.id }, orderBy: { id: 'asc' } }))?.address || '';
          const [cd, account, org, orgCd, verification] = await Promise.all([
            this.prisma.userCdata.findUnique({ where: { user_id: u.id } }),
            this.prisma.userAccount.findUnique({ where: { user_id: u.id } }),
            u.org_id ? this.prisma.organization.findUnique({ where: { id: u.org_id } }) : null,
            u.org_id ? this.prisma.organizationCdata.findUnique({ where: { org_id: u.org_id } }) : null,
            this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_user_verification', key: email.toLowerCase() } } }),
          ]);
          const extra = extraOf(account?.extra);
          const branchId = String(extra.branchId || '');
          const branch = /^\d+$/.test(branchId) ? await this.prisma.branch.findUnique({ where: { id: BigInt(branchId) } }) : null;
          return { id: String(u.id), name: u.name, email, phone: cd?.phone || '', employeeId: String(extra.employeeId || ''), branchId, branchName: branch?.name || '', org: orgCd?.name || org?.name || '', orgId: String(u.org_id || ''), role: 'client', verificationStatus: verification?.value || extra.verificationStatus || 'pending', registeredAt: account?.registered?.toISOString() || null };
        }));
        return kind === 'directory-users' ? mapped.filter(u => !u.verificationStatus || u.verificationStatus === 'approved') : mapped;
      }
      case 'organizations': {
        const rows = await this.prisma.organization.findMany({ orderBy: { name: 'asc' } });
        return Promise.all(rows.map(async o => { const c = await this.prisma.organizationCdata.findUnique({ where: { org_id: o.id } }); return { id: String(o.id), name: o.name, manager: o.manager, status: Number(o.status), domain: o.domain, address: c?.address || '', phone: c?.phone || '', website: c?.website || '', notes: c?.notes || '' }; }));
      }
      case 'help-topics': {
        const rows = await this.prisma.helpTopic.findMany({ orderBy: [{ sort: 'asc' }, { topic: 'asc' }] });
        return Promise.all(rows.map(async t => ({ id: String(t.topic_id), name: t.topic, deptId: String(t.dept_id), departmentName: (await this.prisma.department.findUnique({ where: { id: t.dept_id } }))?.name || '', priority: (await this.prisma.ticketPriority.findUnique({ where: { priority_id: Number(t.priority_id) } }))?.priority || 'normal', slaId: String(t.sla_id), active: Boolean(t.ispublic) })));
      }
      case 'faq-categories': return (await this.prisma.faqCategory.findMany({ orderBy: { name: 'asc' } })).map(c => ({ id: String(c.category_id), name: c.name || '', description: c.description, published: Boolean(c.ispublic) }));
      case 'faq-articles': return (await this.prisma.faq.findMany({ orderBy: { updated: 'desc' } })).map(f => ({ id: String(f.faq_id), categoryId: String(f.category_id), question: f.question, answer: f.answer, published: Boolean(f.ispublished) }));
      default: return [];
    }
  }

  async publicState() {
    const [faqs, categories, pages, settings] = await Promise.all([
      this.prisma.faq.findMany({ where: { ispublished: 1 }, orderBy: { question: 'asc' } }),
      this.prisma.faqCategory.findMany({ where: { ispublic: 1 }, orderBy: { name: 'asc' } }),
      this.prisma.content.findMany({ where: { isactive: 1 }, orderBy: { name: 'asc' } }),
      this.prisma.config.findMany({ where: { namespace: 'react_app_state' } }),
    ]);
    const state: Record<string, any> = {};
    for (const row of settings) { try { state[row.key] = JSON.parse(row.value); } catch { state[row.key] = row.value; } }
    return Object.keys(state).length ? state : { faqs, categories, pages };
  }

  async create(kind: string, data: any): Promise<any> {
    const created = stamp();
    switch (kind) {
      case 'departments': { const d = await this.saveDepartment(data); return { ...this.departmentView(d), active: true }; }
      case 'sla-plans': return this.saveSla(data);
      case 'staff': {
        const [first, ...last] = String(data.name || [data.firstname, data.lastname].filter(Boolean).join(' ')).split(' ');
        const salt = randomBytes(16);
        const passwd = data.password ? 'scrypt$' + salt.toString('base64url') + '$' + scryptSync(String(data.password), salt, 64).toString('base64url') : null;
        const row = await this.prisma.staff.create({ data: { username: String(data.username || data.email || ''), email: String(data.email || ''), firstname: first || '', lastname: last.join(' '), passwd, phone: String(data.phone || ''), dept_id: Number(data.deptId || 0), role_id: Number(data.roleId || 0), isactive: flag(data.active), isadmin: data.role === 'admin' ? 1 : 0, backend: 'local', extra: JSON.stringify({ title: data.title || '', authVersion: 0 }), created, updated: created } });
        return { saved: true, id: String(row.staff_id) };
      }
      case 'organizations': {
        const row = await this.prisma.organization.create({ data: { name: String(data.name || ''), manager: String(data.manager || ''), domain: String(data.domain || ''), status: key(data.status), created, updated: created } });
        await this.prisma.organizationCdata.upsert({ where: { org_id: row.id }, create: { org_id: row.id, name: row.name, domain: row.domain, phone: data.phone || null, address: data.address || null, website: data.website || null, notes: data.notes || null }, update: {} });
        return { id: String(row.id), name: row.name, manager: row.manager, status: Number(row.status), domain: row.domain, address: data.address || '', phone: data.phone || '', website: data.website || '', notes: data.notes || '' };
      }
      case 'branches': { const b = await this.prisma.branch.create({ data: { name: String(data.name || ''), active: flag(data.active), created, updated: created } }); return { id: String(b.id), name: b.name, active: Boolean(b.active) }; }
      case 'help-topics': { const t = await this.prisma.helpTopic.create({ data: { topic: String(data.name || data.topic || ''), topic_pid: key(data.topicPid || data.topic_pid), dept_id: key(data.deptId || data.dept_id), priority_id: key(data.priorityId || data.priority_id), sla_id: key(data.slaId || data.sla_id), ispublic: flag(data.active ?? data.ispublic), notes: data.hint || null, created, updated: created } }); return { id: String(t.topic_id), name: t.topic, deptId: String(t.dept_id), priority: String(data.priority || 'normal'), slaId: String(t.sla_id), hint: data.hint || '', active: Boolean(t.ispublic) }; }
      case 'faq-categories': { const c = await this.prisma.faqCategory.create({ data: { name: String(data.name || ''), description: String(data.description || ''), ispublic: flag(data.published ?? data.ispublic), created, updated: created } }); return { id: String(c.category_id), name: c.name || '', description: c.description, published: Boolean(c.ispublic) }; }
      case 'faq-articles': {
        const rawCategoryId = data.categoryId ?? data.category_id;
        const categoryId = typeof rawCategoryId === 'string' && !/^\d+$/.test(rawCategoryId)
          ? (await this.prisma.faqCategory.findFirst({ where: { name: rawCategoryId } }))?.category_id
          : rawCategoryId;
        if (categoryId === undefined || categoryId === null || categoryId === '') {
          throw new ConflictException('Select a valid knowledgebase category.');
        }
        const f = await this.prisma.faq.create({ data: { question: String(data.question || ''), answer: String(data.answer || ''), category_id: key(categoryId), ispublished: flag(data.published ?? data.ispublished), keywords: data.keywords || null, created, updated: created } });
        return { id: String(f.faq_id), categoryId: String(f.category_id), question: f.question, answer: f.answer, published: Boolean(f.ispublished) };
      }
      case 'directory-users': {
        const email = String(data.email || '').trim().toLowerCase();
        if (!email || !String(data.name || '').trim()) throw new ConflictException('Name and email are required.');
        const existing = await this.prisma.userEmail.findUnique({ where: { address: email } });
        if (existing) throw new ConflictException('A directory record already exists for this email.');
        return this.prisma.$transaction(async tx => {
          let orgId = key(data.orgId);
          const orgName = String(data.org || '').trim();
          if (!orgId && orgName) { let org = await tx.organization.findFirst({ where: { name: { equals: orgName, mode: 'insensitive' } } }); if (!org) org = await tx.organization.create({ data: { name: orgName, created, updated: created } }); orgId = org.id; }
          const user = await tx.user.create({ data: { name: String(data.name), org_id: orgId, created, updated: created } });
          await tx.userEmail.create({ data: { user_id: user.id, address: email } });
          await tx.userCdata.create({ data: { user_id: user.id, name: user.name, email, phone: data.phone || null } });
          return { id: String(user.id), name: user.name, email, phone: data.phone || '', org: orgName, orgId: String(orgId), role: 'client' };
        });
      }
      default: throw new NotFoundException('Unknown admin resource.');
    }
  }

  async update(kind: string, rawId: string, data: any): Promise<any> {
    const updated = stamp();
    switch (kind) {
      case 'departments': { const d = await this.saveDepartment(data, rawId); return { ...this.departmentView(d), active: true }; }
      case 'sla-plans': return this.saveSla(data, rawId);
      case 'staff': {
        const old = await this.prisma.staff.findUniqueOrThrow({ where: { staff_id: Number(rawId) } });
        const extra = { ...extraOf(old.extra), title: data.title ?? extraOf(old.extra).title };
        const name = String(data.name || [data.firstname, data.lastname].filter(Boolean).join(' '));
        const [firstname, ...last] = name.split(' ');
        const passwd = data.password ? (() => { const salt = randomBytes(16); return 'scrypt$' + salt.toString('base64url') + '$' + scryptSync(String(data.password), salt, 64).toString('base64url'); })() : undefined;
        const s = await this.prisma.staff.update({ where: { staff_id: Number(rawId) }, data: { ...(name ? { firstname, lastname: last.join(' ') } : {}), email: data.email, phone: data.phone, dept_id: data.deptId ? Number(data.deptId) : undefined, role_id: data.roleId ? Number(data.roleId) : undefined, isactive: data.active === undefined ? undefined : flag(data.active), isadmin: data.role === undefined ? undefined : data.role === 'admin' ? 1 : 0, passwd, extra: JSON.stringify(extra), updated } });
        return { saved: true, id: String(s.staff_id) };
      }
      case 'directory-users': {
        const email = String(data.email || '').trim().toLowerCase();
        const userId = rawId && rawId !== 'undefined' ? key(rawId) : undefined;
        if (!email || !String(data.name || '').trim()) throw new ConflictException('Name and email are required.');
        return this.prisma.$transaction(async tx => {
          const emailRow = await tx.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } }, select: { user_id: true } });
          const targetId = userId ?? emailRow?.user_id;
          if (!targetId) throw new NotFoundException('Directory user not found.');
          const user = await tx.user.findUnique({ where: { id: targetId } });
          if (!user) throw new NotFoundException('Directory user not found.');
          const emailOwner = await tx.userEmail.findUnique({ where: { address: email } });
          if (emailOwner && emailOwner.user_id !== user.id) throw new ConflictException('A directory record already exists for this email.');
          let orgId = key(data.orgId);
          const orgName = String(data.org || '').trim();
          if (orgId) {
            if (!await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } })) throw new NotFoundException('Selected organization was not found.');
          } else if (orgName) {
            let org = await tx.organization.findFirst({ where: { name: { equals: orgName, mode: 'insensitive' } } });
            if (!org) org = await tx.organization.create({ data: { name: orgName, created: updated, updated } });
            orgId = org.id;
          }
          const changed = await tx.user.update({ where: { id: user.id }, data: { name: String(data.name).trim(), org_id: orgId, updated } });
          let address = await tx.userEmail.findFirst({ where: { user_id: user.id }, orderBy: { id: 'asc' } });
          if (address) address = await tx.userEmail.update({ where: { id: address.id }, data: { address: email } });
          else address = await tx.userEmail.create({ data: { user_id: user.id, address: email } });
          await tx.user.update({ where: { id: user.id }, data: { default_email_id: address.id } });
          await tx.userCdata.upsert({ where: { user_id: user.id }, create: { user_id: user.id, name: changed.name, email, phone: data.phone || null }, update: { name: changed.name, email, phone: data.phone || null } });
          return { id: String(user.id), name: changed.name, email, phone: data.phone || '', org: orgName, orgId: String(orgId), role: 'client' };
        });
      }
      case 'organizations': {
        const orgId = key(rawId);
        const o = await this.prisma.organization.update({ where: { id: orgId }, data: { name: data.name, manager: data.manager, domain: data.domain, status: data.status === undefined ? undefined : key(data.status), updated } });
        const cd = { name: o.name, domain: o.domain, phone: data.phone, address: data.address, website: data.website, notes: data.notes };
        await this.prisma.organizationCdata.upsert({ where: { org_id: orgId }, create: { org_id: orgId, ...cd }, update: cd });
        return { id: String(o.id), name: o.name, manager: o.manager, status: Number(o.status), domain: o.domain, ...data };
      }
      case 'branches': { const b = await this.prisma.branch.update({ where: { id: key(rawId) }, data: { name: data.name, active: data.active === undefined ? undefined : flag(data.active), updated } }); return { id: String(b.id), name: b.name, active: Boolean(b.active) }; }
      case 'help-topics': { const t = await this.prisma.helpTopic.update({ where: { topic_id: key(rawId) }, data: { topic: data.name ?? data.topic, dept_id: data.deptId || data.dept_id ? key(data.deptId || data.dept_id) : undefined, priority_id: data.priorityId || data.priority_id ? key(data.priorityId || data.priority_id) : undefined, sla_id: data.slaId ? key(data.slaId) : undefined, ispublic: data.active === undefined && data.ispublic === undefined ? undefined : flag(data.active ?? data.ispublic), notes: data.hint, updated } }); return { id: String(t.topic_id), name: t.topic, deptId: String(t.dept_id), priority: String(data.priority || 'normal'), slaId: String(t.sla_id), hint: data.hint || '', active: Boolean(t.ispublic) }; }
      case 'faq-categories': { const c = await this.prisma.faqCategory.update({ where: { category_id: key(rawId) }, data: { name: data.name, description: data.description, ispublic: data.published === undefined ? undefined : flag(data.published), updated } }); return { id: String(c.category_id), name: c.name || '', description: c.description, published: Boolean(c.ispublic) }; }
      case 'faq-articles': { const f = await this.prisma.faq.update({ where: { faq_id: key(rawId) }, data: { question: data.question, answer: data.answer, category_id: data.categoryId ? key(data.categoryId) : undefined, ispublished: data.published === undefined ? undefined : flag(data.published), updated } }); return { id: String(f.faq_id), categoryId: String(f.category_id), question: f.question, answer: f.answer, published: Boolean(f.ispublished) }; }
      default: throw new NotFoundException('Unknown admin resource.');
    }
  }

  async remove(kind: string, rawId: string) {
    switch (kind) {
      case 'sla-plans': {
        const id = Number(rawId);
        const [tickets, departments, topics, filterActions, configSettings] = await Promise.all([
          this.prisma.ticket.count({ where: { sla_id: BigInt(id) } }),
          this.prisma.department.count({ where: { sla_id: id } }),
          this.prisma.helpTopic.count({ where: { sla_id: BigInt(id) } }),
          this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM "osticket"."ost_filter_action" a WHERE (to_jsonb(a) - 'id' - 'filter_id')::text LIKE $1`, '%"sla_id"%' + '%' + String(id) + '%'),
          this.prisma.config.count({ where: { key: { contains: 'sla', mode: 'insensitive' }, value: String(id) } }),
        ]);
        if (tickets || departments || topics || Number(filterActions[0]?.count || 0) || configSettings) throw new ConflictException('This SLA plan is still referenced by tickets, departments, help topics, ticket filter actions, or system configuration. Reassign those records before deleting it.');
        await this.prisma.sla.delete({ where: { id } });
        break;
      }
      case 'departments': {
        const id = key(rawId);
        const [children, staff, tickets, topics] = await Promise.all([
          this.prisma.department.count({ where: { pid: id } }),
          this.prisma.staff.count({ where: { dept_id: Number(id) } }),
          this.prisma.ticket.count({ where: { dept_id: id } }),
          this.prisma.helpTopic.count({ where: { dept_id: id } }),
        ]);
        if (children || staff || tickets || topics) throw new ConflictException('This department is still used by child departments, agents, tickets, or help topics. Reassign those records before deleting it.');
        await this.prisma.$transaction(async tx => {
          await tx.staffDeptAccess.deleteMany({ where: { dept_id: Number(id) } });
          await tx.department.delete({ where: { id } });
        });
        break;
      }
      case 'staff': await this.prisma.staff.delete({ where: { staff_id: Number(rawId) } }); break;
      case 'organizations': await this.prisma.organization.delete({ where: { id: key(rawId) } }); break;
      case 'branches': await this.prisma.branch.delete({ where: { id: key(rawId) } }); break;
      case 'help-topics': await this.prisma.helpTopic.delete({ where: { topic_id: key(rawId) } }); break;
      case 'faq-categories': await this.prisma.faqCategory.delete({ where: { category_id: key(rawId) } }); break;
      case 'faq-articles': await this.prisma.faq.delete({ where: { faq_id: key(rawId) } }); break;
      default: throw new NotFoundException('Unknown admin resource.');
    }
    return { deleted: true };
  }

  async saveState(input: any) {
    const entries = Object.entries(input || {});
    await this.prisma.$transaction(entries.map(([name, value]) => this.prisma.config.upsert({
      where: { namespace_key: { namespace: 'react_app_state', key: name.slice(0, 64) } },
      create: { namespace: 'react_app_state', key: name.slice(0, 64), value: JSON.stringify(value) },
      update: { value: JSON.stringify(value), updated: stamp() },
    })));
    return { updated: true };
  }

  async updateVerification(input: any) {
    const email = String(input.email || '').trim().toLowerCase();
    const row = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } } });
    if (!row) throw new NotFoundException('User not found.');
    const account = await this.prisma.userAccount.findUnique({ where: { user_id: row.user_id } });
    const status = String(input.status || '');
    if (!['approved', 'rejected'].includes(status)) throw new ConflictException('Invalid account verification status.');
    const extra = { ...extraOf(account?.extra), role: 'client', verificationStatus: status, authVersion: Number(extraOf(account?.extra).authVersion || 0) + 1 };
    await this.prisma.$transaction([
      this.prisma.config.upsert({ where: { namespace_key: { namespace: 'react_user_verification', key: email } }, create: { namespace: 'react_user_verification', key: email, value: status }, update: { value: status, updated: stamp() } }),
      ...(account ? [this.prisma.userAccount.update({ where: { user_id: row.user_id }, data: { status: status === 'approved' ? 1n : 0n, extra: JSON.stringify(extra) } })] : []),
    ]);
    return { updated: true, verificationStatus: status };
  }
}
