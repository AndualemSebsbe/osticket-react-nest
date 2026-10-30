import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const asId = (value: unknown) => BigInt(String(value || 0));
const now = () => new Date();
const dateValue = (value: unknown) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`) : null;
const endOfDate = (value: unknown) => value ? new Date(`${String(value).slice(0, 10)}T23:59:59.000Z`) : null;
const timeValue = (value: unknown) => value ? new Date(`1970-01-01T${String(value).slice(0, 8).padEnd(8, ':00')}.000Z`) : null;
const timeText = (value: Date | null) => value ? value.toISOString().slice(11, 16) : '';

@Injectable()
export class SchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [schedules, slas, departments, tickets, configs] = await Promise.all([
      this.prisma.schedule.findMany({ include: { entries: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } }, orderBy: { name: 'asc' } }),
      this.prisma.sla.findMany({ select: { id: true, name: true, schedule_id: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true, schedule_id: true } }),
      this.prisma.ticket.groupBy({ by: ['sla_id'], _count: { _all: true } }),
      this.prisma.config.findMany({ where: { namespace: { startsWith: 'schedule.' } } }),
    ]);
    const configByNamespace = new Map(configs.map(c => [`${c.namespace}.${c.key}`, c.value]));
    const assignedTickets = new Map<number, number>();
    const slaById = new Map(slas.map(s => [s.id, s]));
    for (const row of tickets) {
      const sla = slaById.get(Number(row.sla_id));
      if (sla) assignedTickets.set(sla.schedule_id, (assignedTickets.get(sla.schedule_id) || 0) + row._count._all);
    }
    const defaultConfig = await this.prisma.config.findFirst({ where: { namespace: 'core', key: 'default_schedule' } });
    return {
      schedules: schedules.map(s => {
        let holidays: string[] = [];
        try { holidays = JSON.parse(configByNamespace.get(`schedule.${s.id}.configuration`) || '{}').holidays || []; } catch { /* legacy malformed config */ }
        return {
          id: String(s.id), name: s.name, description: s.description, timezone: s.timezone || '',
          type: Number(s.flags) & 1 ? 'bizhrs' : 'hdays', holidays: holidays.map(String),
          entries: s.entries.map(e => ({ id: String(e.id), name: e.name, repeats: e.repeats, startsOn: e.starts_on?.toISOString().slice(0, 10) || '', startsAt: timeText(e.starts_at), endsOn: e.ends_on?.toISOString().slice(0, 10) || '', endsAt: timeText(e.ends_at), stopsOn: e.stops_on?.toISOString().slice(0, 10) || '', day: e.day, week: e.week, month: e.month })),
          slaNames: slas.filter(x => x.schedule_id === Number(s.id)).map(x => x.name),
          departments: departments.filter(x => x.schedule_id === Number(s.id)).map(x => x.name),
          ticketCount: assignedTickets.get(Number(s.id)) || 0,
          isDefault: Number(defaultConfig?.value || 0) === Number(s.id),
        };
      }),
      defaultScheduleId: String(defaultConfig?.value || '0'),
      slas: slas.map(s => ({ id: String(s.id), name: s.name, scheduleId: String(s.schedule_id) })),
    };
  }

  private async save(data: any, id?: string, cloneFrom?: string) {
    const name = String(data.name || '').trim();
    if (!name) throw new ConflictException('Schedule name is required.');
    if (!['bizhrs', 'hdays'].includes(data.type)) throw new ConflictException('Choose a schedule type.');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const timestamp = now();
    return this.prisma.$transaction(async tx => {
      if (cloneFrom) {
        const source = await tx.schedule.findUniqueOrThrow({ where: { id: asId(cloneFrom) }, include: { entries: true } });
        const sourceConfig = await tx.config.findFirst({ where: { namespace: `schedule.${source.id}`, key: 'configuration' } });
        const cloned = await tx.schedule.create({ data: {
          name, description: String(data.description || source.description), timezone: String(data.timezone || source.timezone || '') || null,
          flags: source.flags, created: timestamp, updated: timestamp,
          entries: { create: source.entries.map((e: any) => ({ flags: e.flags, sort: e.sort, name: e.name, repeats: e.repeats, starts_on: e.starts_on, starts_at: e.starts_at, ends_on: e.ends_on, ends_at: e.ends_at, stops_on: e.stops_on, day: e.day, week: e.week, month: e.month, created: timestamp, updated: timestamp })) },
        } });
        if (sourceConfig) await tx.config.create({ data: { namespace: `schedule.${cloned.id}`, key: 'configuration', value: sourceConfig.value, updated: timestamp } });
        return cloned;
      }
      const baseData = { name, description: String(data.description || ''), timezone: String(data.timezone || '') || null, flags: data.type === 'bizhrs' ? 1 : 0, updated: timestamp };
      const schedule = id
        ? await tx.schedule.update({ where: { id: asId(id) }, data: baseData })
        : await tx.schedule.create({ data: { ...baseData, created: timestamp } });
      if (id) await tx.scheduleEntry.deleteMany({ where: { schedule_id: schedule.id } });
      const normalized = entries.map((e: any, index: number) => {
        const repeats = String(e.repeats || 'never');
        if (!['never', 'daily', 'weekly', 'weekdays', 'weekends', 'monthly', 'yearly'].includes(repeats)) throw new ConflictException('Choose a valid repeat interval.');
        if (!String(e.name || '').trim() || !String(e.startsOn || '') || !String(e.startsAt || '') || !String(e.endsAt || '')) throw new ConflictException('Each entry needs a name, start date, and start and end times.');
        return { schedule_id: schedule.id, flags: 0, sort: index, name: String(e.name).trim(), repeats, starts_on: dateValue(e.startsOn), starts_at: timeValue(e.startsAt), ends_on: dateValue(e.endsOn || e.startsOn), ends_at: timeValue(e.endsAt), stops_on: endOfDate(e.stopsOn), day: e.day == null || e.day === '' ? null : Number(e.day), week: e.week == null || e.week === '' ? null : Number(e.week), month: e.month == null || e.month === '' ? null : Number(e.month), created: timestamp, updated: timestamp };
      });
      if (normalized.length) await tx.scheduleEntry.createMany({ data: normalized });
      const configKey = { namespace: `schedule.${schedule.id}`, key: 'configuration' };
      const configValue = JSON.stringify({ holidays: data.type === 'bizhrs' ? (data.holidays || []).map(String) : [] });
      await tx.config.upsert({ where: { namespace_key: configKey }, create: { ...configKey, value: configValue }, update: { value: configValue, updated: timestamp } });
      return schedule;
    });
  }

  create(data: any) { return this.save(data); }
  update(id: string, data: any) { return this.save(data, id); }
  clone(id: string, data: any) { return this.save(data, undefined, id); }

  async remove(id: string) {
    const scheduleId = Number(id);
    const [sla, department, systemDefault] = await Promise.all([
      this.prisma.sla.count({ where: { schedule_id: scheduleId } }),
      this.prisma.department.count({ where: { schedule_id: scheduleId } }),
      this.prisma.config.findFirst({ where: { namespace: 'core', key: 'default_schedule', value: id } }),
    ]);
    if (sla || department || systemDefault) throw new ConflictException('This schedule is assigned to an SLA, department, or system default. Reassign it before deleting.');
    await this.prisma.$transaction(async tx => {
      await tx.scheduleEntry.deleteMany({ where: { schedule_id: asId(id) } });
      await tx.config.deleteMany({ where: { namespace: `schedule.${id}` } });
      await tx.schedule.delete({ where: { id: asId(id) } });
    });
    return { deleted: true };
  }

  async setDefault(id: string) {
    if (id !== '0') {
      const schedule = await this.prisma.schedule.findUniqueOrThrow({ where: { id: asId(id) } });
      if (!(Number(schedule.flags) & 1)) throw new ConflictException('Only a Business Hours schedule can be the system default.');
    }
    const where = { namespace: 'core', key: 'default_schedule' };
    await this.prisma.config.upsert({ where: { namespace_key: where }, create: { ...where, value: id, updated: now() }, update: { value: id, updated: now() } });
    return { saved: true };
  }
}
