import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const toBig = (val: unknown) => BigInt(String(val || 0));
const toNum = (val: unknown) => Number(val || 0);
const toStr = (val: unknown) => String(val ?? '');

export type TicketState = 'open' | 'closed' | 'archived' | 'deleted';

export interface TicketStatusInput {
  name: string;
  state?: TicketState;
  mode?: number;
  flags?: number;
  sort?: number;
  properties?: {
    description?: string;
    reopenable?: boolean;
    notes?: string;
    [key: string]: any;
  } | string;
}

@Injectable()
export class TicketStatusesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * List all ticket statuses with ticket counts and configuration
   */
  async listStatuses() {
    const [statuses, ticketCounts] = await Promise.all([
      this.prisma.ticketStatus.findMany({
        orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.ticket.groupBy({
        by: ['status_id'],
        _count: { _all: true },
      }),
    ]);

    const countsMap = new Map(ticketCounts.map(tc => [toStr(tc.status_id), tc._count._all]));

    const formatted = statuses.map(s => {
      const id = toStr(s.id);
      let parsedProps: Record<string, any> = {};
      if (s.properties) {
        try {
          parsedProps = typeof s.properties === 'string' ? JSON.parse(s.properties) : s.properties;
        } catch {
          parsedProps = { description: s.properties };
        }
      }

      const ticketCount = countsMap.get(id) || 0;
      const mode = s.mode || 0;
      // osTicket: mode 1 or 2 typically indicates system/default protected status
      const isSystem = mode > 0;

      return {
        id,
        name: s.name,
        state: (s.state || 'open').toLowerCase() as TicketState,
        mode,
        flags: s.flags || 0,
        sort: toNum(s.sort),
        isSystem,
        reopenable: parsedProps.reopenable !== false,
        description: parsedProps.description || '',
        properties: parsedProps,
        ticketCount,
        created: s.created,
        updated: s.updated,
      };
    });

    return { statuses: formatted };
  }

  /**
   * Get single status detail
   */
  async getStatus(idStr: string) {
    const statusId = toBig(idStr);
    const s = await this.prisma.ticketStatus.findUnique({ where: { id: statusId } });
    if (!s) {
      throw new NotFoundException(`Ticket status #${idStr} not found`);
    }

    const ticketCount = await this.prisma.ticket.count({
      where: { status_id: statusId },
    });

    let parsedProps: Record<string, any> = {};
    if (s.properties) {
      try {
        parsedProps = typeof s.properties === 'string' ? JSON.parse(s.properties) : s.properties;
      } catch {
        parsedProps = { description: s.properties };
      }
    }

    return {
      status: {
        id: toStr(s.id),
        name: s.name,
        state: (s.state || 'open').toLowerCase() as TicketState,
        mode: s.mode || 0,
        flags: s.flags || 0,
        sort: toNum(s.sort),
        isSystem: (s.mode || 0) > 0,
        reopenable: parsedProps.reopenable !== false,
        description: parsedProps.description || '',
        properties: parsedProps,
        ticketCount,
        created: s.created,
        updated: s.updated,
      },
    };
  }

  /**
   * Create a new ticket status
   */
  async createStatus(input: TicketStatusInput) {
    const name = (input.name || '').trim();
    if (!name) {
      throw new ConflictException('Status name is required');
    }

    const existing = await this.prisma.ticketStatus.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`Status with name "${name}" already exists`);
    }

    let sort = input.sort;
    if (sort === undefined) {
      const maxSort = await this.prisma.ticketStatus.findFirst({
        orderBy: { sort: 'desc' },
        select: { sort: true },
      });
      sort = toNum(maxSort?.sort ?? 0) + 1;
    }

    const propsStr = typeof input.properties === 'object'
      ? JSON.stringify(input.properties)
      : input.properties || JSON.stringify({ reopenable: true });

    const status = await this.prisma.ticketStatus.create({
      data: {
        name,
        state: (input.state || 'open').toLowerCase(),
        mode: input.mode ?? 0,
        flags: input.flags ?? 0,
        sort: toBig(sort),
        properties: propsStr,
        created: new Date(),
        updated: new Date(),
      },
    });

    return this.getStatus(toStr(status.id));
  }

  /**
   * Update an existing ticket status
   */
  async updateStatus(idStr: string, input: TicketStatusInput) {
    const statusId = toBig(idStr);
    const existing = await this.prisma.ticketStatus.findUnique({ where: { id: statusId } });
    if (!existing) {
      throw new NotFoundException(`Ticket status #${idStr} not found`);
    }

    const name = (input.name || existing.name).trim();
    if (!name) {
      throw new ConflictException('Status name cannot be empty');
    }

    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await this.prisma.ticketStatus.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, id: { not: statusId } },
      });
      if (dup) {
        throw new ConflictException(`Another status with name "${name}" already exists`);
      }
    }

    const state = (input.state || existing.state || 'open').toLowerCase();
    const sort = input.sort !== undefined ? toBig(input.sort) : existing.sort;
    const flags = input.flags !== undefined ? input.flags : existing.flags;

    let propsStr = existing.properties;
    if (input.properties !== undefined) {
      propsStr = typeof input.properties === 'object'
        ? JSON.stringify(input.properties)
        : input.properties;
    }

    await this.prisma.ticketStatus.update({
      where: { id: statusId },
      data: {
        name,
        state,
        sort,
        flags,
        properties: propsStr,
        updated: new Date(),
      },
    });

    return this.getStatus(idStr);
  }

  /**
   * Delete a ticket status
   */
  async removeStatus(idStr: string) {
    const statusId = toBig(idStr);
    const existing = await this.prisma.ticketStatus.findUnique({ where: { id: statusId } });
    if (!existing) {
      throw new NotFoundException(`Ticket status #${idStr} not found`);
    }

    if ((existing.mode || 0) > 0) {
      throw new ConflictException(`Cannot delete system status "${existing.name}". It is required by osTicket.`);
    }

    const ticketCount = await this.prisma.ticket.count({
      where: { status_id: statusId },
    });
    if (ticketCount > 0) {
      throw new ConflictException(
        `Cannot delete status "${existing.name}": ${ticketCount} ticket(s) are currently in this status. Reassign tickets to another status first.`
      );
    }

    await this.prisma.ticketStatus.delete({ where: { id: statusId } });
    return { deleted: true, id: idStr };
  }

  /**
   * Mass delete statuses
   */
  async massAction(action: string, ids: string[]) {
    if (!ids || ids.length === 0) return { affected: 0 };

    if (action === 'delete') {
      let count = 0;
      for (const id of ids) {
        try {
          await this.removeStatus(id);
          count++;
        } catch (e: any) {
          console.warn(`Could not delete status ${id}:`, e.message);
        }
      }
      return { affected: count };
    }

    throw new ConflictException(`Unsupported mass action: ${action}`);
  }
}
