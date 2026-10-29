import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes, scryptSync } from 'node:crypto';

const toStr = (v: unknown) => String(v ?? '');
const toNum = (v: unknown) => Number(v ?? 0);
const toKey = (v: unknown) => BigInt(String(v || 0));
const now = () => new Date();
const parseExtra = (v?: string | null) => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
function hashPassword(password: string) {
  const salt = randomBytes(16);
  return 'scrypt$' + salt.toString('base64url') + '$' + scryptSync(String(password), salt, 64).toString('base64url');
}

export interface DeptAccessInput { deptId: string; roleId: string; alerts: boolean }
export interface TeamInput { teamId: string; alerts: boolean }

export interface AgentInput {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  phoneExt?: string;
  mobile?: string;
  username?: string;
  password?: string;
  isadmin?: boolean;
  isactive?: boolean;
  isvisible?: boolean;
  onvacation?: boolean;
  assignedOnly?: boolean;
  changePasswd?: boolean;
  notes?: string;
  deptId?: string;
  roleId?: string;
  deptAccess?: DeptAccessInput[];
  teams?: TeamInput[];
  usePrimaryRoleOnAssignment?: boolean;
  sendWelcomeEmail?: boolean;
}

@Injectable()
export class AgentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async validateAssignments(deptId: string | number, roleId: string | number, deptAccess: DeptAccessInput[] = [], teams: TeamInput[] = []) {
    const primaryDept = Number(deptId);
    const primaryRole = Number(roleId);
    if (!Number.isSafeInteger(primaryDept) || primaryDept < 1 || !Number.isSafeInteger(primaryRole) || primaryRole < 1) {
      throw new ConflictException('A primary department and role are required.');
    }
    const extraDeptIds = deptAccess.map(access => Number(access.deptId));
    const extraRoleIds = deptAccess.map(access => Number(access.roleId));
    const teamIds = teams.map(team => String(team.teamId));
    if (new Set(extraDeptIds).size !== extraDeptIds.length || extraDeptIds.includes(primaryDept)) {
      throw new ConflictException('Extended department access must be unique and cannot repeat the primary department.');
    }
    if (new Set(teamIds).size !== teamIds.length) throw new ConflictException('Team memberships must be unique.');
    if (extraDeptIds.some(id => !Number.isSafeInteger(id) || id < 1) || extraRoleIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
      throw new ConflictException('Department access requires valid departments and roles.');
    }
    if (teamIds.some(id => !/^\d+$/.test(id) || BigInt(id) < 1n)) throw new ConflictException('Team memberships require valid team IDs.');

    const [departments, roles, teamRows] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: [primaryDept, ...extraDeptIds].map(id => BigInt(id)) } }, select: { id: true } }),
      this.prisma.role.findMany({ where: { id: { in: [primaryRole, ...extraRoleIds] } }, select: { id: true } }),
      teamIds.length ? this.prisma.team.findMany({ where: { team_id: { in: teamIds.map(id => BigInt(id)) } }, select: { team_id: true } }) : Promise.resolve([]),
    ]);
    if (departments.length !== new Set([primaryDept, ...extraDeptIds]).size || roles.length !== new Set([primaryRole, ...extraRoleIds]).size || teamRows.length !== teamIds.length) {
      throw new ConflictException('One or more selected departments, roles, or teams no longer exist. Refresh the page and try again.');
    }
  }

  private mapAgent(s: any, departments: any[], roles: any[], deptAccess: any[], teamMembers: any[], teams: any[]) {
    const dept = departments.find(d => Number(d.id) === s.dept_id);
    const role = roles.find(r => Number(r.id) === s.role_id);
    const extra = parseExtra(s.extra);
    const agentDeptAccess = deptAccess
      .filter(da => da.staff_id === s.staff_id)
      .map(da => ({
        deptId: toStr(da.dept_id),
        deptName: departments.find(d => Number(d.id) === da.dept_id)?.name || '',
        roleId: toStr(da.role_id),
        roleName: roles.find(r => Number(r.id) === da.role_id)?.name || '',
        alerts: Boolean(da.flags & 1),
      }));
    const agentTeams = teamMembers
      .filter(tm => Number(tm.staff_id) === s.staff_id)
      .map(tm => ({
        teamId: toStr(tm.team_id),
        teamName: teams.find(t => Number(t.team_id) === Number(tm.team_id))?.name || '',
        alerts: Boolean(Number(tm.flags) & 1),
      }));
    return {
      id: toStr(s.staff_id),
      staffId: toStr(s.staff_id),
      username: s.username,
      firstname: s.firstname || '',
      lastname: s.lastname || '',
      name: [s.firstname, s.lastname].filter(Boolean).join(' ') || s.username,
      email: s.email || '',
      phone: s.phone || '',
      phoneExt: s.phone_ext || '',
      mobile: s.mobile || '',
      isadmin: Boolean(s.isadmin),
      isactive: Boolean(s.isactive),
      isvisible: Boolean(s.isvisible),
      onvacation: Boolean(s.onvacation),
      assignedOnly: Boolean(s.assigned_only),
      changePasswd: Boolean(s.change_passwd),
      notes: s.notes || '',
      deptId: toStr(s.dept_id),
      deptName: dept?.name || '',
      roleId: toStr(s.role_id),
      roleName: role?.name || '',
      title: extra.title || '',
      usePrimaryRoleOnAssignment: Boolean(extra.def_assn_role),
      created: s.created?.toISOString() || '',
      lastlogin: s.lastlogin?.toISOString() || null,
      updated: s.updated?.toISOString() || '',
      deptAccess: agentDeptAccess,
      teams: agentTeams,
      // Compatibility fields
      role: s.isadmin ? 'admin' : 'agent',
      active: Boolean(s.isactive),
      departmentAccess: agentDeptAccess.map(da => da.deptName),
    };
  }

  async listAgents() {
    const [staffRows, departments, roles, deptAccess, teamMembers, teams] = await Promise.all([
      this.prisma.staff.findMany({ orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.role.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.staffDeptAccess.findMany(),
      this.prisma.teamMember.findMany(),
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return staffRows.map(s => this.mapAgent(s, departments, roles, deptAccess, teamMembers, teams));
  }

  async getAgentOptions() {
    const [departments, roles, teams] = await Promise.all([
      this.prisma.department.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.role.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return {
      departments: departments.map(d => ({ id: toStr(d.id), name: d.name })),
      roles: roles.map(r => ({ id: toStr(r.id), name: r.name || '' })),
      teams: teams.map(t => ({ id: toStr(t.team_id), name: t.name, active: Boolean(Number(t.flags) & 1) })),
    };
  }

  async getAgent(staffId: number) {
    const [s, departments, roles, deptAccess, teamMembers, teams] = await Promise.all([
      this.prisma.staff.findUnique({ where: { staff_id: staffId } }),
      this.prisma.department.findMany(),
      this.prisma.role.findMany(),
      this.prisma.staffDeptAccess.findMany({ where: { staff_id: staffId } }),
      this.prisma.teamMember.findMany({ where: { staff_id: BigInt(staffId) } }),
      this.prisma.team.findMany(),
    ]);
    if (!s) throw new NotFoundException('Agent not found.');
    return this.mapAgent(s, departments, roles, deptAccess, teamMembers, teams);
  }

  async createAgent(data: AgentInput) {
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) throw new ConflictException('Email is required.');
    if (!data.username && !email) throw new ConflictException('Username is required.');

    const username = String(data.username || email.split('@')[0] || email);
    await this.validateAssignments(data.deptId || '', data.roleId || '', data.deptAccess || [], data.teams || []);
    const existing = await this.prisma.staff.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { username: { equals: username, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) throw new ConflictException(existing.email?.toLowerCase() === email ? 'Email already in use by another agent.' : 'Username already in use.');

    const passwd = data.password ? hashPassword(data.password) : null;
    const created = now();
    const extra = JSON.stringify({ title: '', authVersion: 0, def_assn_role: Boolean(data.usePrimaryRoleOnAssignment) });

    const s = await this.prisma.$transaction(async (tx) => {
        const s = await tx.staff.create({
        data: {
          username,
          firstname: data.firstname || '',
          lastname: data.lastname || '',
          email,
          phone: data.phone || '',
          phone_ext: data.phoneExt || null,
          mobile: data.mobile || '',
          notes: data.notes || null,
          passwd,
          backend: 'local',
          isactive: data.isactive !== false ? 1 : 0,
          isadmin: data.isadmin ? 1 : 0,
          isvisible: data.isvisible !== false ? 1 : 0,
          onvacation: data.onvacation ? 1 : 0,
          assigned_only: data.assignedOnly ? 1 : 0,
          change_passwd: data.changePasswd ? 1 : 0,
          dept_id: toNum(data.deptId),
          role_id: toNum(data.roleId),
          extra,
          created,
          updated: created,
        },
      });
  
      // Insert dept access
      if (data.deptAccess?.length) {
        await tx.staffDeptAccess.createMany({
          data: data.deptAccess.map(da => ({
            staff_id: s.staff_id,
            dept_id: toNum(da.deptId),
            role_id: toNum(da.roleId),
            flags: da.alerts ? 1 : 0,
          })),
          skipDuplicates: true,
        });
      }
  
      // Insert team memberships
      if (data.teams?.length) {
        await tx.teamMember.createMany({
          data: data.teams.map(t => ({
            team_id: toKey(t.teamId),
            staff_id: BigInt(s.staff_id),
            flags: t.alerts ? 1n : 0n,
          })),
          skipDuplicates: true,
        });
      }
  
  
      return s;
    });
    return { saved: true, id: toStr(s.staff_id) };
  }

  async updateAgent(staffId: number, data: AgentInput) {
    const existing = await this.prisma.staff.findUnique({ where: { staff_id: staffId } });
    if (!existing) throw new NotFoundException('Agent not found.');

    const email = data.email ? String(data.email).trim().toLowerCase() : existing.email;
    if (data.deptId !== undefined || data.roleId !== undefined || data.deptAccess !== undefined || data.teams !== undefined) {
      await this.validateAssignments(data.deptId ?? existing.dept_id, data.roleId ?? existing.role_id, data.deptAccess ?? [], data.teams ?? []);
    }
    const username = data.username ? String(data.username).trim() : existing.username;

    // Check uniqueness if changed
    if (email !== existing.email) {
      const dup = await this.prisma.staff.findFirst({
        where: { email: { equals: email || '', mode: 'insensitive' }, NOT: { staff_id: staffId } },
      });
      if (dup) throw new ConflictException('Email already in use by another agent.');
    }
    if (username !== existing.username) {
      const dup = await this.prisma.staff.findFirst({
        where: { username: { equals: username, mode: 'insensitive' }, NOT: { staff_id: staffId } },
      });
      if (dup) throw new ConflictException('Username already in use.');
    }

    const oldExtra = parseExtra(existing.extra);
    const extra = JSON.stringify({
      ...oldExtra,
      def_assn_role: data.usePrimaryRoleOnAssignment !== undefined ? Boolean(data.usePrimaryRoleOnAssignment) : Boolean(oldExtra.def_assn_role),
    });
    const passwd = data.password ? hashPassword(data.password) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { staff_id: staffId },
        data: {
          ...(data.firstname !== undefined ? { firstname: data.firstname } : {}),
          ...(data.lastname !== undefined ? { lastname: data.lastname } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(username !== undefined ? { username } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.phoneExt !== undefined ? { phone_ext: data.phoneExt } : {}),
          ...(data.mobile !== undefined ? { mobile: data.mobile } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(passwd ? { passwd } : {}),
          ...(data.isactive !== undefined ? { isactive: data.isactive ? 1 : 0 } : {}),
          ...(data.isadmin !== undefined ? { isadmin: data.isadmin ? 1 : 0 } : {}),
          ...(data.isvisible !== undefined ? { isvisible: data.isvisible ? 1 : 0 } : {}),
          ...(data.onvacation !== undefined ? { onvacation: data.onvacation ? 1 : 0 } : {}),
          ...(data.assignedOnly !== undefined ? { assigned_only: data.assignedOnly ? 1 : 0 } : {}),
          ...(data.changePasswd !== undefined ? { change_passwd: data.changePasswd ? 1 : 0 } : {}),
          ...(data.deptId !== undefined ? { dept_id: toNum(data.deptId) } : {}),
          ...(data.roleId !== undefined ? { role_id: toNum(data.roleId) } : {}),
          extra,
          updated: now(),
        },
      });
  
      // Replace dept access if provided
      if (data.deptAccess !== undefined) {
        await tx.staffDeptAccess.deleteMany({ where: { staff_id: staffId } });
        if (data.deptAccess.length) {
          await tx.staffDeptAccess.createMany({
            data: data.deptAccess.map(da => ({
              staff_id: staffId,
              dept_id: toNum(da.deptId),
              role_id: toNum(da.roleId),
              flags: da.alerts ? 1 : 0,
            })),
            skipDuplicates: true,
          });
        }
      }
  
      // Replace team memberships if provided
      if (data.teams !== undefined) {
        await tx.teamMember.deleteMany({ where: { staff_id: BigInt(staffId) } });
        if (data.teams.length) {
          await tx.teamMember.createMany({
            data: data.teams.map(t => ({
              team_id: toKey(t.teamId),
              staff_id: BigInt(staffId),
              flags: t.alerts ? 1n : 0n,
            })),
            skipDuplicates: true,
          });
        }
      }
  
  
    });

    return { saved: true, id: toStr(staffId) };
  }

  async deleteAgent(staffId: number) {
    const existing = await this.prisma.staff.findUnique({ where: { staff_id: staffId } });
    if (!existing) throw new NotFoundException('Agent not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.staffDeptAccess.deleteMany({ where: { staff_id: staffId } });
      await tx.teamMember.deleteMany({ where: { staff_id: BigInt(staffId) } });
      await tx.staff.delete({ where: { staff_id: staffId } });
  
    });
    return { deleted: true };
  }

  async massAction(action: string, ids: number[], options?: { deptId?: string; roleId?: string }) {
    if (!ids.length) throw new ConflictException('No agents selected.');
    const updated = now();
    switch (action) {
      case 'enable':
        await this.prisma.staff.updateMany({ where: { staff_id: { in: ids } }, data: { isactive: 1, updated } });
        return { updated: ids.length };
      case 'disable':
        await this.prisma.staff.updateMany({ where: { staff_id: { in: ids } }, data: { isactive: 0, updated } });
        return { updated: ids.length };
      case 'delete': {
        await this.prisma.$transaction(async (tx) => {
          await tx.staffDeptAccess.deleteMany({ where: { staff_id: { in: ids } } });
          await tx.teamMember.deleteMany({ where: { staff_id: { in: ids.map(id => BigInt(id)) } } });
          await tx.staff.deleteMany({ where: { staff_id: { in: ids } } });
  
        });
        return { deleted: ids.length };
      }
      case 'change-department': {
        if (!options?.deptId) throw new ConflictException('Department is required.');
        const updateData: any = { dept_id: toNum(options.deptId), updated };
        if (options.roleId) updateData.role_id = toNum(options.roleId);
        await this.prisma.staff.updateMany({ where: { staff_id: { in: ids } }, data: updateData });
        return { updated: ids.length };
      }
      default:
        throw new ConflictException('Unknown action: ' + action);
    }
  }

  async setAgentPassword(staffId: number, password: string, forceChange = false) {
    const existing = await this.prisma.staff.findUnique({ where: { staff_id: staffId } });
    if (!existing) throw new NotFoundException('Agent not found.');
    const passwd = hashPassword(password);
    const oldExtra = parseExtra(existing.extra);
    const extra = JSON.stringify({ ...oldExtra, authVersion: Number(oldExtra.authVersion || 0) + 1 });
    await this.prisma.staff.update({
      where: { staff_id: staffId },
      data: { passwd, change_passwd: forceChange ? 1 : 0, extra, updated: now() },
    });
    return { updated: true };
  }
}
