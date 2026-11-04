import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Team::FLAG_ENABLED and Team::FLAG_NOALERTS from osTicket's class.team.php.
const TEAM_FLAG_ENABLED = 0x0001;
const TEAM_FLAG_NOALERTS = 0x0002;
// TeamMember::FLAG_ALERTS.
const MEMBER_FLAG_ALERTS = 0x0001;

const toStr = (value: unknown) => String(value ?? '');
const toKey = (value: unknown) => BigInt(String(value ?? 0));
const now = () => new Date();

const agentName = (staff: { firstname?: string | null; lastname?: string | null; username?: string | null } | undefined) =>
  [staff?.firstname, staff?.lastname].filter(Boolean).join(' ') || staff?.username || '';

export interface TeamMemberInput {
  staffId?: string | number;
  staff_id?: string | number;
  id?: string | number;
  alerts?: boolean;
  memberAlerts?: boolean;
}

export interface TeamInput {
  name?: string;
  notes?: string;
  enabled?: boolean;
  isenabled?: boolean;
  disableAlerts?: boolean;
  noalerts?: boolean;
  leadId?: string | number;
  lead_id?: string | number;
  members?: Array<TeamMemberInput | string | number>;
}

interface NormalisedMember {
  staffId: bigint;
  alerts: boolean;
}

@Injectable()
export class TeamsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async loadLookups() {
    const [staff, departments] = await Promise.all([
      this.prisma.staff.findMany({ orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }] }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    return { staff, departments };
  }

  private staffOptions(lookups: Awaited<ReturnType<TeamsService['loadLookups']>>) {
    return lookups.staff.map(row => ({
      id: toStr(row.staff_id),
      staffId: toStr(row.staff_id),
      name: agentName(row),
      username: row.username || '',
      email: row.email || '',
      departmentId: toStr(row.dept_id),
      departmentName: lookups.departments.find(dept => Number(dept.id) === row.dept_id)?.name || '',
      active: Boolean(row.isactive),
      onvacation: Boolean(row.onvacation),
    }));
  }

  private teamView(
    team: any,
    members: any[],
    lookups: Awaited<ReturnType<TeamsService['loadLookups']>>,
    usage: Map<string, { tickets: number; tasks: number; helpTopics: number; helpTopicNames: string[]; filterActions: number }>,
  ) {
    const teamMembers = members
      .filter(member => Number(member.team_id) === Number(team.team_id))
      .map(member => {
        const staff = lookups.staff.find(row => Number(row.staff_id) === Number(member.staff_id));
        return {
          staffId: toStr(member.staff_id),
          name: agentName(staff),
          username: staff?.username || '',
          email: staff?.email || '',
          departmentId: toStr(staff?.dept_id ?? 0),
          departmentName: lookups.departments.find(dept => Number(dept.id) === Number(staff?.dept_id))?.name || '',
          active: Boolean(staff?.isactive),
          onvacation: Boolean(staff?.onvacation),
          alerts: (Number(member.flags) & MEMBER_FLAG_ALERTS) !== 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const leadId = toStr(team.lead_id || 0);
    const lead = teamMembers.find(member => member.staffId === leadId);
    const counts = usage.get(toStr(team.team_id)) || { tickets: 0, tasks: 0, helpTopics: 0, helpTopicNames: [], filterActions: 0 };
    const usageCount = counts.tickets + counts.tasks + counts.helpTopics + counts.filterActions;
    const flags = Number(team.flags || 0);

    return {
      id: toStr(team.team_id),
      name: team.name || '',
      notes: team.notes || '',
      enabled: (flags & TEAM_FLAG_ENABLED) !== 0,
      active: (flags & TEAM_FLAG_ENABLED) !== 0,
      disableAlerts: (flags & TEAM_FLAG_NOALERTS) !== 0,
      alertsEnabled: (flags & TEAM_FLAG_NOALERTS) === 0,
      flags,
      leadId,
      leadName: lead?.name || agentName(lookups.staff.find(row => Number(row.staff_id) === Number(team.lead_id || 0))),
      memberCount: teamMembers.length,
      members: teamMembers,
      alertMemberCount: teamMembers.filter(member => member.alerts).length,
      ticketCount: counts.tickets,
      taskCount: counts.tasks,
      helpTopicCount: counts.helpTopics,
      helpTopicNames: counts.helpTopicNames,
      filterActionCount: counts.filterActions,
      usageCount,
      created: team.created?.toISOString?.() || '',
      updated: team.updated?.toISOString?.() || '',
    };
  }

  private async loadUsage(teamIds: bigint[]) {
    const usage = new Map<string, { tickets: number; tasks: number; helpTopics: number; helpTopicNames: string[]; filterActions: number }>();
    if (!teamIds.length) return usage;

    const [ticketGroups, taskGroups, topics, filterActions] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['team_id'],
        where: { team_id: { in: teamIds } },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['team_id'],
        where: { team_id: { in: teamIds } },
        _count: { _all: true },
      }),
      this.prisma.helpTopic.findMany({
        where: { team_id: { in: teamIds } },
        select: { team_id: true, topic: true },
      }),
      this.loadFilterActionCounts(),
    ]);

    for (const id of teamIds) {
      usage.set(toStr(id), { tickets: 0, tasks: 0, helpTopics: 0, helpTopicNames: [], filterActions: filterActions.get(toStr(id)) || 0 });
    }
    for (const row of ticketGroups) {
      const entry = usage.get(toStr(row.team_id));
      if (entry) entry.tickets = Number(row._count._all);
    }
    for (const row of taskGroups) {
      const entry = usage.get(toStr(row.team_id));
      if (entry) entry.tasks = Number(row._count._all);
    }
    for (const topic of topics) {
      const entry = usage.get(toStr(topic.team_id));
      if (!entry) continue;
      entry.helpTopics += 1;
      if (entry.helpTopicNames.length < 5) entry.helpTopicNames.push(topic.topic);
    }
    return usage;
  }

  /**
   * ost_filter_action is not modelled in Prisma. Team assignment actions store
   * {"team_id": <id>} in the configuration column, so read the affected rows and
   * count them in JavaScript.
   */
  private async loadFilterActionCounts() {
    const counts = new Map<string, number>();
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ configuration: string | null }>>(
        'SELECT configuration FROM "osticket"."ost_filter_action" WHERE type = $1',
        'team',
      );
      for (const row of rows) {
        try {
          const config = JSON.parse(String(row.configuration || '{}'));
          const id = config?.team_id;
          if (id === undefined || id === null || String(id) === '0') continue;
          const key = String(id);
          counts.set(key, (counts.get(key) || 0) + 1);
        } catch {
          // Ignore malformed legacy configurations.
        }
      }
    } catch {
      // The filter action table may not exist in installations that never
      // enabled ticket filters. Usage reporting must still work without it.
    }
    return counts;
  }

  async list() {
    const [teams, members, lookups] = await Promise.all([
      this.prisma.team.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.teamMember.findMany(),
      this.loadLookups(),
    ]);
    const usage = await this.loadUsage(teams.map(team => team.team_id));
    return {
      teams: teams.map(team => this.teamView(team, members, lookups, usage)),
      staff: this.staffOptions(lookups),
    };
  }

  async get(id: number) {
    const teamId = toKey(id);
    const [team, members, lookups] = await Promise.all([
      this.prisma.team.findUnique({ where: { team_id: teamId } }),
      this.prisma.teamMember.findMany({ where: { team_id: teamId } }),
      this.loadLookups(),
    ]);
    if (!team) throw new NotFoundException('Team not found.');
    const usage = await this.loadUsage([teamId]);
    return { team: this.teamView(team, members, lookups, usage), staff: this.staffOptions(lookups) };
  }

  private async validateInput(data: TeamInput, currentId?: bigint) {
    const name = String(data.name ?? '').trim();
    if (!name) throw new ConflictException('Team name is required.');
    if (name.length > 125) throw new ConflictException('Team name cannot exceed 125 characters.');

    const duplicate = await this.prisma.team.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(currentId ? { team_id: { not: currentId } } : {}),
      },
      select: { team_id: true },
    });
    if (duplicate) throw new ConflictException('A team with this name already exists.');

    const members: NormalisedMember[] = [];
    const seen = new Set<string>();
    const requested = Array.isArray(data.members) ? data.members : [];
    for (const item of requested) {
      const rawId = typeof item === 'object' && item
        ? item.staffId ?? item.staff_id ?? item.id
        : item;
      const raw = String(rawId ?? '').trim();
      if (!/^\d+$/.test(raw) || BigInt(raw) < 1n) {
        throw new ConflictException('Every team member must be a valid agent.');
      }
      if (seen.has(raw)) throw new ConflictException('Team members must be unique.');
      seen.add(raw);
      const alerts = typeof item === 'object' && item
        ? item.alerts !== undefined
          ? Boolean(item.alerts)
          : item.memberAlerts !== undefined
            ? Boolean(item.memberAlerts)
            : true
        : true;
      members.push({ staffId: BigInt(raw), alerts });
    }

    const staffRows = members.length
      ? await this.prisma.staff.findMany({ where: { staff_id: { in: members.map(member => Number(member.staffId)) } }, select: { staff_id: true } })
      : [];
    if (staffRows.length !== members.length) {
      throw new ConflictException('One or more selected agents no longer exist.');
    }

    const rawLead = data.leadId ?? data.lead_id ?? 0;
    let leadId = toKey(rawLead);
    // osTicket resets the team lead when they are removed from the member list.
    if (leadId !== 0n && !seen.has(toStr(leadId))) leadId = 0n;

    return {
      name,
      notes: String(data.notes ?? '').trim() || null,
      members,
      leadId,
    };
  }

  async create(data: TeamInput) {
    const values = await this.validateInput(data);
    const timestamp = now();
    const enabled = data.enabled ?? data.isenabled ?? true;
    const disableAlerts = data.disableAlerts ?? data.noalerts ?? false;
    const flags = (enabled ? TEAM_FLAG_ENABLED : 0) | (disableAlerts ? TEAM_FLAG_NOALERTS : 0);

    const team = await this.prisma.$transaction(async tx => {
      const saved = await tx.team.create({
        data: {
          name: values.name,
          notes: values.notes,
          lead_id: values.leadId,
          flags: BigInt(flags),
          created: timestamp,
          updated: timestamp,
        },
      });
      if (values.members.length) {
        await tx.teamMember.createMany({
          data: values.members.map(member => ({
            team_id: saved.team_id,
            staff_id: member.staffId,
            flags: BigInt(member.alerts ? MEMBER_FLAG_ALERTS : 0),
          })),
        });
      }
      return saved;
    });

    return { saved: true, id: toStr(team.team_id), team: (await this.get(Number(team.team_id))).team };
  }

  async update(id: number, data: TeamInput) {
    const teamId = toKey(id);
    const existing = await this.prisma.team.findUnique({ where: { team_id: teamId } });
    if (!existing) throw new NotFoundException('Team not found.');

    const values = await this.validateInput(data, teamId);
    let flags = Number(existing.flags || 0);
    const enabled = data.enabled ?? data.isenabled;
    if (enabled !== undefined) flags = enabled ? flags | TEAM_FLAG_ENABLED : flags & ~TEAM_FLAG_ENABLED;
    const disableAlerts = data.disableAlerts ?? data.noalerts;
    if (disableAlerts !== undefined) flags = disableAlerts ? flags | TEAM_FLAG_NOALERTS : flags & ~TEAM_FLAG_NOALERTS;

    await this.prisma.$transaction(async tx => {
      await tx.team.update({
        where: { team_id: teamId },
        data: {
          name: values.name,
          notes: values.notes,
          lead_id: values.leadId,
          flags: BigInt(flags),
          updated: now(),
        },
      });
      await tx.teamMember.deleteMany({ where: { team_id: teamId } });
      if (values.members.length) {
        await tx.teamMember.createMany({
          data: values.members.map(member => ({
            team_id: teamId,
            staff_id: member.staffId,
            flags: BigInt(member.alerts ? MEMBER_FLAG_ALERTS : 0),
          })),
        });
      }
    });

    return { saved: true, id: toStr(teamId), team: (await this.get(Number(teamId))).team };
  }

  /**
   * Clear team references held by ticket filter actions. The table is not part
   * of the Prisma schema, so this is best-effort and never blocks deletion.
   */
  private async clearFilterActionReferences(teamId: bigint) {
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "osticket"."ost_filter_action"
         SET configuration = regexp_replace(configuration, '"team_id"\\s*:\\s*"?${toStr(teamId)}"?', '"team_id":0')
         WHERE type = $1 AND configuration ~ $2`,
        'team',
        `"team_id"\\s*:\\s*"?${toStr(teamId)}"?\\s*[,}]`,
      );
    } catch {
      // Ignore installations without the optional filter action table.
    }
  }

  private async deleteTeams(teamIds: bigint[]) {
    const timestamp = now();
    await this.prisma.$transaction(async tx => {
      await tx.teamMember.deleteMany({ where: { team_id: { in: teamIds } } });
      await tx.ticket.updateMany({ where: { team_id: { in: teamIds } }, data: { team_id: 0n, updated: timestamp } });
      await tx.task.updateMany({ where: { team_id: { in: teamIds } }, data: { team_id: 0n, updated: timestamp } });
      await tx.helpTopic.updateMany({ where: { team_id: { in: teamIds } }, data: { team_id: 0n, updated: timestamp } });
      await tx.team.deleteMany({ where: { team_id: { in: teamIds } } });
    });
    for (const teamId of teamIds) await this.clearFilterActionReferences(teamId);
  }

  async remove(id: number) {
    const teamId = toKey(id);
    const team = await this.prisma.team.findUnique({ where: { team_id: teamId }, select: { team_id: true } });
    if (!team) throw new NotFoundException('Team not found.');
    await this.deleteTeams([teamId]);
    return { deleted: true };
  }

  async massAction(action: string, ids: unknown[]) {
    const teamIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(value => toStr(value).trim()).filter(value => /^\d+$/.test(value) && BigInt(value) > 0n)))
      .map(value => BigInt(value));
    if (!teamIds.length) throw new ConflictException('No teams selected.');

    const teams = await this.prisma.team.findMany({ where: { team_id: { in: teamIds } } });
    if (!teams.length) throw new ConflictException('No matching teams found.');

    if (action === 'enable' || action === 'disable') {
      const enable = action === 'enable';
      await this.prisma.$transaction(teams.map(team => this.prisma.team.update({
        where: { team_id: team.team_id },
        data: {
          flags: BigInt(enable ? Number(team.flags) | TEAM_FLAG_ENABLED : Number(team.flags) & ~TEAM_FLAG_ENABLED),
          updated: now(),
        },
      })));
      return { updated: teams.length };
    }

    if (action === 'delete') {
      await this.deleteTeams(teams.map(team => team.team_id));
      return { deleted: teams.length };
    }

    throw new ConflictException('Unknown action: ' + action);
  }
}
