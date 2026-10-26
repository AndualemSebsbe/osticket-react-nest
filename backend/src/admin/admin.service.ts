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

  async list(kind: string): Promise<any[]> {
    switch (kind) {
      case 'departments': return (await this.prisma.department.findMany({ orderBy: { name: 'asc' } })).map(d => ({ id: String(d.id), name: d.name, active: true }));
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
          return { id: String(u.id), name: u.name, email, phone: cd?.phone || '', org: orgCd?.name || org?.name || '', orgId: String(u.org_id || ''), role: 'client', verificationStatus: verification?.value || extra.verificationStatus || 'pending', registeredAt: account?.registered?.toISOString() || null };
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
      case 'departments': { const d = await this.prisma.department.create({ data: { name: String(data.name || ''), signature: String(data.signature || ''), ispublic: flag(data.ispublic), created, updated: created } }); return { id: String(d.id), name: d.name, active: true }; }
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
      case 'faq-articles': { const f = await this.prisma.faq.create({ data: { question: String(data.question || ''), answer: String(data.answer || ''), category_id: key(data.categoryId || data.category_id), ispublished: flag(data.published ?? data.ispublished), keywords: data.keywords || null, created, updated: created } }); return { id: String(f.faq_id), categoryId: String(f.category_id), question: f.question, answer: f.answer, published: Boolean(f.ispublished) }; }
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
      case 'departments': { const d = await this.prisma.department.update({ where: { id: key(rawId) }, data: { ...(data.name !== undefined ? { name: String(data.name) } : {}), signature: data.signature !== undefined ? String(data.signature) : undefined, updated } }); return { id: String(d.id), name: d.name, active: true }; }
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
      case 'departments': await this.prisma.department.delete({ where: { id: key(rawId) } }); break;
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
