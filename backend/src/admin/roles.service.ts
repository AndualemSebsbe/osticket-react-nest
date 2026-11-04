import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_FLAG_ENABLED = 0x0001;

export interface RolePermissionDefinition {
  key: string;
  title: string;
  description: string;
}

export interface RolePermissionGroup {
  id: string;
  label: string;
  permissions: RolePermissionDefinition[];
}

/**
 * Permission catalogue mirrors osTicket's non-primary role permissions:
 * Ticket::getPermissions(), ThreadEntry::getPermissions(), TaskModel::getPermissions()
 * and Canned::getPermissions(). Primary (own-record) permissions are intentionally
 * excluded from role editing.
 */
export const ROLE_PERMISSION_GROUPS: RolePermissionGroup[] = [
  {
    id: 'tickets',
    label: 'Tickets',
    permissions: [
      { key: 'ticket.create', title: 'Create', description: 'Ability to open tickets on behalf of users' },
      { key: 'ticket.edit', title: 'Edit', description: 'Ability to edit tickets' },
      { key: 'ticket.assign', title: 'Assign', description: 'Ability to assign tickets to agents or teams' },
      { key: 'ticket.release', title: 'Release', description: 'Ability to release ticket assignment' },
      { key: 'ticket.transfer', title: 'Transfer', description: 'Ability to transfer tickets between departments' },
      { key: 'ticket.refer', title: 'Refer', description: 'Ability to manage ticket referrals' },
      { key: 'ticket.merge', title: 'Merge', description: 'Ability to merge tickets' },
      { key: 'ticket.link', title: 'Link', description: 'Ability to link tickets' },
      { key: 'ticket.reply', title: 'Post Reply', description: 'Ability to post a ticket reply' },
      { key: 'ticket.markanswered', title: 'Mark as Answered', description: 'Ability to mark a ticket as Answered/Unanswered' },
      { key: 'ticket.close', title: 'Close', description: 'Ability to close tickets' },
      { key: 'ticket.delete', title: 'Delete', description: 'Ability to delete tickets' },
      { key: 'thread.edit', title: 'Edit Thread', description: 'Ability to edit thread items of other agents' },
    ],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    permissions: [
      { key: 'task.create', title: 'Create', description: 'Ability to create tasks' },
      { key: 'task.edit', title: 'Edit', description: 'Ability to edit tasks' },
      { key: 'task.assign', title: 'Assign', description: 'Ability to assign tasks to agents or teams' },
      { key: 'task.transfer', title: 'Transfer', description: 'Ability to transfer tasks between departments' },
      { key: 'task.reply', title: 'Post Reply', description: 'Ability to post task update' },
      { key: 'task.close', title: 'Close', description: 'Ability to close tasks' },
      { key: 'task.delete', title: 'Delete', description: 'Ability to delete tasks' },
    ],
  },
  {
    id: 'knowledgebase',
    label: 'Knowledgebase',
    permissions: [
      { key: 'canned.manage', title: 'Premade', description: 'Ability to add/update/disable/delete canned responses' },
    ],
  },
];

const ALL_PERMISSION_KEYS = new Set(ROLE_PERMISSION_GROUPS.flatMap(group => group.permissions.map(permission => permission.key)));
const permissionOrder = new Map(Array.from(ALL_PERMISSION_KEYS).map((key, index) => [key, index]));

const toStr = (value: unknown) => String(value ?? '');
const now = () => new Date();

export interface RoleInput {
  name?: string;
  notes?: string;
  enabled?: boolean;
  permissions?: string[] | Record<string, unknown>;
}

function parsePermissions(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(key => ALL_PERMISSION_KEYS.has(key));
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .filter(([key, enabled]) => enabled && ALL_PERMISSION_KEYS.has(key))
        .map(([key]) => key);
    }
  } catch {
    // Fall through to an empty permission set for malformed legacy values.
  }
  return [];
}

function serialisePermissions(input: RoleInput['permissions']): string[] {
  const requested = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? Object.entries(input).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key)
      : [];
  const unique = Array.from(new Set(requested.map(String).filter(key => ALL_PERMISSION_KEYS.has(key))));
  return unique.sort((a, b) => (permissionOrder.get(a) ?? 0) - (permissionOrder.get(b) ?? 0));
}

function agentName(staff: { firstname: string | null; lastname: string | null; username: string }) {
  return [staff.firstname, staff.lastname].filter(Boolean).join(' ') || staff.username;
}

@Injectable()
export class RolesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private permissionGroups() {
    return ROLE_PERMISSION_GROUPS;
  }

  private async validateInput(data: RoleInput, currentId?: number) {
    const name = String(data.name ?? '').trim();
    if (!name) throw new ConflictException('Role name is required.');
    if (name.length > 64) throw new ConflictException('Role name cannot exceed 64 characters.');

    const duplicate = await this.prisma.role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(currentId ? { id: { not: currentId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('A role with this name already exists.');

    const permissions = serialisePermissions(data.permissions);
    if (!permissions.length) throw new ConflictException('Select at least one permission for the role.');

    return {
      name,
      notes: String(data.notes ?? '') || null,
      permissions,
    };
  }

  private mapRole(
    role: { id: number; flags: number; name: string | null; permissions: string | null; notes: string | null; created: Date; updated: Date },
    primaryAgents: Array<{ role_id: number; dept_id: number; firstname: string | null; lastname: string | null; username: string }>,
    deptAccess: Array<{ role_id: number; dept_id: number; firstname: string | null; lastname: string | null; username: string }>,
    departments: Array<{ id: bigint; name: string }>,
  ) {
    const permissions = parsePermissions(role.permissions);
    const primary = primaryAgents.filter(staff => staff.role_id === role.id);
    const extended = deptAccess.filter(access => access.role_id === role.id);
    const departmentIds = new Set<number>([
      ...primary.map(staff => staff.dept_id),
      ...extended.map(access => access.dept_id),
    ]);
    const agentNames = new Set<string>([...primary, ...extended].map(agentName).filter(Boolean));
    const assignedDepartments = Array.from(departmentIds)
      .map(id => departments.find(department => Number(department.id) === id)?.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    const assignedAgents = Array.from(agentNames).sort((a, b) => a.localeCompare(b));

    return {
      id: toStr(role.id),
      name: role.name || '',
      notes: role.notes || '',
      enabled: (role.flags & ROLE_FLAG_ENABLED) !== 0,
      flags: role.flags,
      permissions,
      permissionCount: permissions.length,
      primaryAgentCount: primary.length,
      deptAccessCount: extended.length,
      assignedAgents,
      assignedDepartments,
      canDelete: primary.length === 0 && extended.length === 0,
      created: role.created?.toISOString() || '',
      updated: role.updated?.toISOString() || '',
    };
  }

  private async loadUsage(roleIds: number[]) {
    const [primaryAgents, deptAccess, departments] = await Promise.all([
      this.prisma.staff.findMany({
        where: { role_id: { in: roleIds } },
        select: { role_id: true, dept_id: true, firstname: true, lastname: true, username: true },
      }),
      this.prisma.staffDeptAccess.findMany({ where: { role_id: { in: roleIds } } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const staffIds = Array.from(new Set(deptAccess.map(access => access.staff_id)));
    const staff = staffIds.length
      ? await this.prisma.staff.findMany({
          where: { staff_id: { in: staffIds } },
          select: { staff_id: true, firstname: true, lastname: true, username: true },
        })
      : [];
    const extended = deptAccess.map(access => {
      const row = staff.find(item => item.staff_id === access.staff_id);
      return {
        role_id: access.role_id,
        dept_id: access.dept_id,
        firstname: row?.firstname ?? null,
        lastname: row?.lastname ?? null,
        username: row?.username ?? '',
      };
    });
    return { primaryAgents, deptAccess: extended, departments };
  }

  async list() {
    const roles = await this.prisma.role.findMany({ orderBy: { name: 'asc' } });
    const usage = await this.loadUsage(roles.map(role => role.id));
    return {
      roles: roles.map(role => this.mapRole(role, usage.primaryAgents, usage.deptAccess, usage.departments)),
      permissionGroups: this.permissionGroups(),
    };
  }

  async get(id: number) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found.');
    const usage = await this.loadUsage([id]);
    return {
      role: this.mapRole(role, usage.primaryAgents, usage.deptAccess, usage.departments),
      permissionGroups: this.permissionGroups(),
    };
  }

  async create(data: RoleInput) {
    const values = await this.validateInput(data);
    const timestamp = now();
    const role = await this.prisma.role.create({
      data: {
        name: values.name,
        notes: values.notes,
        permissions: JSON.stringify(Object.fromEntries(values.permissions.map(key => [key, 1]))),
        flags: (data.enabled === false ? 0 : ROLE_FLAG_ENABLED),
        created: timestamp,
        updated: timestamp,
      },
    });
    return { saved: true, id: toStr(role.id), role: (await this.get(role.id)).role };
  }

  async update(id: number, data: RoleInput) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found.');
    const values = await this.validateInput(data, id);
    const enabled = data.enabled === undefined
      ? (existing.flags & ROLE_FLAG_ENABLED) !== 0
      : Boolean(data.enabled);
    const flags = enabled ? existing.flags | ROLE_FLAG_ENABLED : existing.flags & ~ROLE_FLAG_ENABLED;
    await this.prisma.role.update({
      where: { id },
      data: {
        name: values.name,
        notes: values.notes,
        permissions: JSON.stringify(Object.fromEntries(values.permissions.map(key => [key, 1]))),
        flags,
        updated: now(),
      },
    });
    return { saved: true, id: toStr(id), role: (await this.get(id)).role };
  }

  async remove(id: number) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found.');
    const usage = await this.loadUsage([id]);
    const assigned = usage.primaryAgents.length + usage.deptAccess.length;
    if (assigned) {
      throw new ConflictException(
        `This role is assigned to ${assigned} ${assigned === 1 ? 'agent' : 'agents'} and cannot be deleted. Remove it from those agents first.`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    return { deleted: true };
  }

  async massAction(action: string, ids: number[]) {
    const roleIds = Array.from(new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0)));
    if (!roleIds.length) throw new ConflictException('No roles selected.');
    const timestamp = now();

    if (action === 'enable' || action === 'disable') {
      const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
      if (!roles.length) throw new ConflictException('No matching roles found.');
      const enable = action === 'enable';
      await this.prisma.$transaction(roles.map(role => this.prisma.role.update({
        where: { id: role.id },
        data: {
          flags: enable ? role.flags | ROLE_FLAG_ENABLED : role.flags & ~ROLE_FLAG_ENABLED,
          updated: timestamp,
        },
      })));
      return { updated: roles.length };
    }

    if (action === 'delete') {
      const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
      if (!roles.length) throw new ConflictException('No matching roles found.');
      const usage = await this.loadUsage(roles.map(role => role.id));
      const deletable = roles.filter(role => (
        !usage.primaryAgents.some(staff => staff.role_id === role.id)
        && !usage.deptAccess.some(access => access.role_id === role.id)
      ));
      if (deletable.length) {
        await this.prisma.role.deleteMany({ where: { id: { in: deletable.map(role => role.id) } } });
      }
      return { deleted: deletable.length, skipped: roles.length - deletable.length };
    }

    throw new ConflictException('Unknown action: ' + action);
  }
}
