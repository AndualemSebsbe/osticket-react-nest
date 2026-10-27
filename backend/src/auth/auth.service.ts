import { Inject, BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiSecurityService, AccountRole, Session } from '../common/api-security.service';

type Extra = Record<string, any>;
type ApiUser = { id: string; name: string; email: string; phone: string; employeeId?: string; branchId?: string; branchName?: string; org: string; title: string; deptId: string; roleId: string };
type Account = { status: string; role: AccountRole; sessionVersion: number; user: ApiUser };

function parseExtra(value: string | null | undefined): Extra { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function encodePassword(password: string) { const salt = randomBytes(16); return 'scrypt$' + salt.toString('base64url') + '$' + scryptSync(password, salt, 64).toString('base64url'); }
function verifyPassword(encoded: string | null | undefined, password: string) {
  const [algorithm, salt, stored] = String(encoded || '').split('$'); if (algorithm !== 'scrypt' || !salt || !stored) return false;
  const expected = Buffer.from(stored, 'base64url'), actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length);
  return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
function clientStatus(role: AccountRole, accountStatus: bigint | number, verification: string) { return role === 'client' ? verification : Number(accountStatus) ? 'approved' : 'disabled'; }

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ApiSecurityService) private readonly security: ApiSecurityService) {}

  async profileFromSession(token: string) {
    const session = this.security.readSession(token);
    const account = session ? await this.validateClient(session.email) : null;
    if (!this.sessionAccount(account, session, 'client')) throw new UnauthorizedException('Session expired.');
    return account!.user;
  }

  async listAssignableStaff() {
    const rows = await this.prisma.staff.findMany({ where: { isactive: 1 }, orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] });
    return rows.map(row => ({ id: String(row.staff_id), name: [row.firstname, row.lastname].filter(Boolean).join(' ') || row.username, email: row.email || '', staffId: row.staff_id, role: row.isadmin ? 'admin' : 'agent' }));
  }

  async listStaffDepartments() {
    const rows = await this.prisma.department.findMany({ orderBy: { name: 'asc' } });
    return rows.map(row => ({ id: String(row.id), name: row.name }));
  }

  async ticketOptions() {
    const [departments, topics, statuses, priorities] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.helpTopic.findMany({ where: { ispublic: 1 }, orderBy: { topic: 'asc' } }),
      this.prisma.ticketStatus.findMany({ orderBy: { sort: 'asc' } }),
      this.prisma.ticketPriority.findMany({ orderBy: { priority_urgency: 'asc' } }),
    ]);
    return { statuses: [...new Set(statuses.map(s => String(s.state || s.name).toLowerCase()).filter(s => ['open','pending','closed'].includes(s)))], topics: topics.map(t => ({ id: String(t.topic_id), name: t.topic })), priorities: priorities.map(p => p.priority.toLowerCase()), departments: departments.map(d => ({ id: String(d.id), name: d.name })) };
  }

  async findClient(email: string): Promise<Account | null> {
    const address = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } }, orderBy: { id: 'asc' } });
    if (!address) return null;
    const [user, account, contact] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: address.user_id } }),
      this.prisma.userAccount.findUnique({ where: { user_id: address.user_id } }),
      this.prisma.userCdata.findUnique({ where: { user_id: address.user_id } }),
    ]);
    if (!user || !account || account.backend !== 'react') return null;
    const extra = parseExtra(account.extra), role: AccountRole = 'client';
    const [org, orgData, verification, branch] = await Promise.all([
      user.org_id ? this.prisma.organization.findUnique({ where: { id: user.org_id } }) : null,
      user.org_id ? this.prisma.organizationCdata.findUnique({ where: { org_id: user.org_id } }) : null,
      this.prisma.config.findUnique({ where: { namespace_key: { namespace: 'react_user_verification', key: email.toLowerCase() } } }),
      extra.branchId ? this.prisma.branch.findUnique({ where: { id: BigInt(extra.branchId) } }) : null,
    ]);
    const status = clientStatus(role, account.status, verification?.value || extra.verificationStatus || 'pending');
    return { status, role, sessionVersion: Number(extra.authVersion || 0), user: { id: String(user.id), name: user.name, email: address.address, phone: contact?.phone || '', employeeId: String(extra.employeeId || ''), branchId: String(extra.branchId || ''), branchName: branch?.name || '', org: orgData?.name || org?.name || '', title: extra.title || '', deptId: String(extra.deptId || ''), roleId: String(extra.roleId || '') } };
  }

  async findStaff(identifier: string): Promise<(Account & { active: boolean; passwordHash: string | null; staffId: number }) | null> {
    const staff = await this.prisma.staff.findFirst({ where: { OR: [ { email: { equals: identifier, mode: 'insensitive' } }, { username: { equals: identifier, mode: 'insensitive' } } ] }, orderBy: [{ email: 'desc' }, { staff_id: 'asc' }] });
    if (!staff || !staff.email) return null;
    const extra = parseExtra(staff.extra), role: AccountRole = staff.isadmin ? 'admin' : 'agent';
    const user: ApiUser = { id: String(staff.staff_id), name: [staff.firstname, staff.lastname].filter(Boolean).join(' ') || staff.username, email: staff.email, phone: staff.phone, org: '', title: extra.title || '', deptId: String(staff.dept_id || ''), roleId: String(staff.role_id || '') };
    return { status: staff.isactive ? 'approved' : 'disabled', role, sessionVersion: Number(extra.authVersion || 0), user, active: Boolean(staff.isactive), passwordHash: staff.passwd, staffId: staff.staff_id };
  }

  async validate(email: string): Promise<Account | null> { return await this.findStaff(email) || this.findClient(email); }
  async validateStaff(email: string) { const staff = await this.findStaff(email); return staff && ['agent', 'admin'].includes(staff.role) ? staff : null; }
  async validateClient(email: string) { const account = await this.findClient(email); return account?.role === 'client' ? account : null; }
  sessionAccount(account: Account | null, session: Session | null, role?: 'staff' | 'client') {
    if (!account || !session || account.status !== 'approved' || account.sessionVersion !== session.sessionVersion) return false;
    if (role === 'staff') return account.role === 'agent' || account.role === 'admin';
    if (role === 'client') return account.role === 'client';
    return true;
  }

  async loginClient(email: string, password: string) {
    const row = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } }, orderBy: { id: 'asc' } });
    if (!row) return { found: false as const };
    const account = await this.prisma.userAccount.findUnique({ where: { user_id: row.user_id } });
    if (!account || account.backend !== 'react') return { found: false as const };
    if (!verifyPassword(account.passwd, password)) return { found: true as const, authenticated: false as const };
    const profile = await this.findClient(email);
    if (!profile) return { found: false as const };
    return { found: true as const, authenticated: true as const, status: profile.status, role: profile.role, sessionVersion: profile.sessionVersion, user: profile.user };
  }

  async loginStaff(identifier: string, password: string) {
    const result = await this.findStaff(identifier);
    if (!result) return { found: false as const };
    if (!verifyPassword(result.passwordHash, password)) return { found: true as const, authenticated: false as const };
    if (!this.security.validEmail(result.user.email)) return { found: true as const, authenticated: false as const, error: 'A valid email address must be configured for this staff account.' };
    return { found: true as const, authenticated: true as const, status: result.status, role: result.role, sessionVersion: result.sessionVersion, user: result.user };
  }

  async ensureUser(input: { name: string; email: string; phone?: string }) {
    const email = input.email.toLowerCase();
    const existingEmail = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } }, orderBy: { id: 'asc' } });
    if (existingEmail) {
      const userId = existingEmail.user_id;
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { name: input.name, updated: new Date() } }),
        this.prisma.userCdata.upsert({ where: { user_id: userId }, create: { user_id: userId, name: input.name, email, phone: input.phone || null }, update: { name: input.name, email, ...(input.phone ? { phone: input.phone } : {}) } }),
      ]);
      return userId;
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: input.name, created: new Date(), updated: new Date() } });
      const address = await tx.userEmail.create({ data: { user_id: user.id, address: email } });
      await tx.user.update({ where: { id: user.id }, data: { default_email_id: address.id } });
      await tx.userCdata.create({ data: { user_id: user.id, name: input.name, email, phone: input.phone || null } });
      return user.id;
    });
  }

  async register(input: { name: string; email: string; password: string; phone?: string; employeeId?: string; branchId?: string }) {
    const branchId = String(input.branchId || '').trim();
    if (branchId && !/^\d+$/.test(branchId)) throw new BadRequestException('Select a valid branch.');
    const branch = branchId ? await this.prisma.branch.findFirst({ where: { id: BigInt(branchId), active: 1 } }) : null;
    if (branchId && !branch) throw new BadRequestException('Selected branch is unavailable.');
    const id = await this.ensureUser(input);
    const existing = await this.prisma.userAccount.findUnique({ where: { user_id: id } });
    if (existing) throw new ConflictException('An account already exists for this email address.');
    const extra = JSON.stringify({ verificationStatus: 'pending', role: 'client', employeeId: input.employeeId || '', branchId: branch ? String(branch.id) : '' });
    await this.prisma.$transaction([
      this.prisma.userAccount.create({ data: { user_id: id, status: 0n, username: input.email.toLowerCase(), passwd: encodePassword(input.password), backend: 'react', extra, registered: new Date() } }),
      this.prisma.config.upsert({ where: { namespace_key: { namespace: 'react_user_verification', key: input.email.toLowerCase() } }, create: { namespace: 'react_user_verification', key: input.email.toLowerCase(), value: 'pending' }, update: { value: 'pending', updated: new Date() } }),
    ]);
    return true;
  }

  async changePassword(email: string, password: string) {
    const encoded = encodePassword(password);
    await this.prisma.$transaction(async (tx) => {
      const client = await tx.userEmail.findMany({ where: { address: { equals: email, mode: 'insensitive' } } });
      const userIds = client.map((row) => row.user_id);
      const accounts = await tx.userAccount.findMany({ where: { user_id: { in: userIds }, backend: 'react' } });
      const staffRows = await tx.staff.findMany({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (!accounts.length && !staffRows.length) throw new NotFoundException('Registered account was not found.');
      for (const account of accounts) { const extra = parseExtra(account.extra); await tx.userAccount.update({ where: { user_id: account.user_id }, data: { passwd: encoded, extra: JSON.stringify({ ...extra, authVersion: Number(extra.authVersion || 0) + 1 }) } }); }
      for (const staff of staffRows) { const extra = parseExtra(staff.extra); await tx.staff.update({ where: { staff_id: staff.staff_id }, data: { passwd: encoded, extra: JSON.stringify({ ...extra, authVersion: Number(extra.authVersion || 0) + 1 }), updated: new Date() } }); }
    });
  }

  async requestReset(email: string) {
    const staff = await this.prisma.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const address = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } } });
    const account = address ? await this.prisma.userAccount.findUnique({ where: { user_id: address.user_id } }) : null;
    if (!staff && (!account || account.backend !== 'react')) return null;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = Date.now() + 30 * 60000;
    await this.prisma.config.upsert({ where: { namespace_key: { namespace: 'react_password_reset', key: tokenHash } }, create: { namespace: 'react_password_reset', key: tokenHash, value: JSON.stringify({ email, expiresAt }) }, update: { value: JSON.stringify({ email, expiresAt }), updated: new Date() } });
    return token;
  }

  async completeReset(tokenHash: string, password: string) {
    return this.prisma.$transaction(async (tx) => {
      const key = await tx.config.findUnique({ where: { namespace_key: { namespace: 'react_password_reset', key: tokenHash } } });
      if (!key) return false;
      let data: { email: string; expiresAt: number }; try { data = JSON.parse(key.value); } catch { await tx.config.delete({ where: { id: key.id } }); return false; }
      if (data.expiresAt < Date.now()) { await tx.config.delete({ where: { id: key.id } }); return false; }
      const clientEmail = await tx.userEmail.findMany({ where: { address: { equals: data.email, mode: 'insensitive' } } });
      const accounts = await tx.userAccount.findMany({ where: { user_id: { in: clientEmail.map((item) => item.user_id) }, backend: 'react' } });
      const staff = await tx.staff.findMany({ where: { email: { equals: data.email, mode: 'insensitive' } } });
      const encoded = encodePassword(password);
      for (const account of accounts) { const extra = parseExtra(account.extra); await tx.userAccount.update({ where: { user_id: account.user_id }, data: { passwd: encoded, extra: JSON.stringify({ ...extra, authVersion: Number(extra.authVersion || 0) + 1 }) } }); }
      for (const item of staff) { const extra = parseExtra(item.extra); await tx.staff.update({ where: { staff_id: item.staff_id }, data: { passwd: encoded, extra: JSON.stringify({ ...extra, authVersion: Number(extra.authVersion || 0) + 1 }), updated: new Date() } }); }
      await tx.config.delete({ where: { id: key.id } });
      return true;
    });
  }

  async updateProfile(email: string, input: { name: string; phone: string; org: string; title?: string }) {
    const address = await this.prisma.userEmail.findFirst({ where: { address: { equals: email, mode: 'insensitive' } } });
    if (!address) throw new NotFoundException('Account was not found.');
    const userId = address.user_id, organizationName = input.org.trim();
    await this.prisma.$transaction(async (tx) => {
      let orgId = 0n;
      if (organizationName) {
        let org = await tx.organization.findFirst({ where: { name: { equals: organizationName, mode: 'insensitive' } } });
        if (!org) org = await tx.organization.create({ data: { name: organizationName, created: new Date(), updated: new Date() } });
        orgId = org.id;
        await tx.organizationCdata.upsert({ where: { org_id: orgId }, create: { org_id: orgId, name: organizationName }, update: { name: organizationName } });
      }
      await tx.user.update({ where: { id: userId }, data: { name: input.name, org_id: orgId, updated: new Date() } });
      await tx.userCdata.upsert({ where: { user_id: userId }, create: { user_id: userId, name: input.name, email, phone: input.phone }, update: { name: input.name, email, phone: input.phone } });
      const account = await tx.userAccount.findUnique({ where: { user_id: userId } });
      if (account) { const extra = parseExtra(account.extra); await tx.userAccount.update({ where: { user_id: userId }, data: { extra: JSON.stringify({ ...extra, ...(input.title !== undefined ? { title: input.title } : {}) }) } }); }
    });
  }

  async verifyUser(email: string, name: string, status: 'approved' | 'rejected', actorName: string) {
    if (!['approved', 'rejected'].includes(status)) throw new ConflictException('Invalid account verification status.');
    const userId = await this.ensureUser({ name, email });
    await this.prisma.$transaction(async (tx) => {
      const account = await tx.userAccount.findUnique({ where: { user_id: userId } });
      const extra = parseExtra(account?.extra);
      const updated = JSON.stringify({ ...extra, role: extra.role || 'client', verificationStatus: status, authVersion: Number(extra.authVersion || 0) + 1 });
      if (account) await tx.userAccount.update({ where: { user_id: userId }, data: { status: status === 'approved' ? 1n : 0n, extra: updated } });
      else await tx.userAccount.create({ data: { user_id: userId, status: status === 'approved' ? 1n : 0n, username: email.toLowerCase(), backend: 'react', extra: updated, registered: new Date() } });
      await tx.config.upsert({ where: { namespace_key: { namespace: 'react_user_verification', key: email.toLowerCase() } }, create: { namespace: 'react_user_verification', key: email.toLowerCase(), value: status }, update: { value: status, updated: new Date() } });
      await tx.audit.create({ data: { object_type: 'U', object_id: userId, user_id: userId, data: JSON.stringify({ action: 'verification_' + status, actor: actorName, email }), ip: '127.0.0.1', timestamp: new Date() } });
    });
  }
}
