import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TabularReport {
  columns: string[];
  data: Array<Array<string | number>>;
}

export interface PlotData {
  times: string[];
  timestamps: number[];
  events: string[];
  plots: Record<string, number[]>;
  totals: Record<string, number>;
}

export interface Timeframe {
  start: string;
  stop: string;
  period: string;
  displayRange: string;
  startDateInput: string;
}

export interface Workload {
  open: number;
  pending: number;
  overdue: number;
  unassigned: number;
}

export interface DashboardOverview {
  timeframe: Timeframe;
  workload: Workload;
  plots: PlotData;
  tables: {
    dept: TabularReport;
    topic: TabularReport;
    staff: TabularReport;
  };
}

const EVENT_NAMES: Record<number, string> = {
  1: 'Created',
  2: 'Closed',
  3: 'Reopened',
  4: 'Assigned',
  5: 'Released',
  6: 'Transferred',
  7: 'Referred',
  8: 'Overdue',
  9: 'Edited',
  10: 'Viewed',
  11: 'Error',
  12: 'Collab',
  13: 'Resent',
  14: 'Deleted',
  15: 'Merged',
  16: 'Unlinked',
  17: 'Linked',
};

const PLOT_EVENT_IDS = [1, 2, 3, 4, 8, 6]; // Created, Closed, Reopened, Assigned, Overdue, Transferred

const PERIOD_CHOICES: Record<string, string> = {
  'now': 'Up to today',
  '+7 days': 'One Week',
  '+14 days': 'Two Weeks',
  '+1 month': 'One Month',
  '+3 months': 'One Quarter',
};

function formatDateYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  parseTimeframe(startInput?: string, periodInput?: string): { startDate: Date; stopDate: Date; timeframe: Timeframe } {
    let startDate: Date;
    if (startInput && !isNaN(Date.parse(startInput))) {
      startDate = new Date(startInput);
    } else {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
    }
    startDate.setHours(0, 0, 0, 0);

    const period = periodInput && Object.prototype.hasOwnProperty.call(PERIOD_CHOICES, periodInput)
      ? periodInput
      : 'now';

    let stopDate: Date;
    if (period === 'now') {
      stopDate = new Date();
    } else if (period === '+7 days') {
      stopDate = new Date(startDate.getTime() + 7 * 86400000);
      stopDate.setHours(23, 59, 59, 999);
    } else if (period === '+14 days') {
      stopDate = new Date(startDate.getTime() + 14 * 86400000);
      stopDate.setHours(23, 59, 59, 999);
    } else if (period === '+1 month') {
      stopDate = new Date(startDate);
      stopDate.setMonth(stopDate.getMonth() + 1);
      stopDate.setHours(23, 59, 59, 999);
    } else if (period === '+3 months') {
      stopDate = new Date(startDate);
      stopDate.setMonth(stopDate.getMonth() + 3);
      stopDate.setHours(23, 59, 59, 999);
    } else {
      stopDate = new Date();
    }

    const startFmt = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const stopFmt = stopDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const displayRange = `${startFmt} - ${stopFmt} (${timezone})`;

    return {
      startDate,
      stopDate,
      timeframe: {
        start: startDate.toISOString(),
        stop: stopDate.toISOString(),
        period,
        displayRange,
        startDateInput: formatDateYMD(startDate),
      },
    };
  }

  async getWorkload(): Promise<Workload> {
    const [tickets, statuses] = await Promise.all([
      this.prisma.ticket.findMany({
        select: { status_id: true, isoverdue: true, staff_id: true, team_id: true },
      }),
      this.prisma.ticketStatus.findMany({ select: { id: true, state: true, name: true } }),
    ]);

    const statusMap = new Map(statuses.map((s) => [s.id.toString(), (s.state || s.name).toLowerCase()]));

    let open = 0;
    let pending = 0;
    let overdue = 0;
    let unassigned = 0;

    for (const t of tickets) {
      const state = statusMap.get(t.status_id.toString()) || 'open';
      if (state === 'open') {
        open++;
        if (t.isoverdue === 1) overdue++;
        if (t.staff_id === 0n && t.team_id === 0n) unassigned++;
      } else if (state === 'pending') {
        pending++;
        if (t.isoverdue === 1) overdue++;
      }
    }

    return { open, pending, overdue, unassigned };
  }

  async getPlotData(startDate: Date, stopDate: Date): Promise<PlotData> {
    const events = PLOT_EVENT_IDS.map((id) => EVENT_NAMES[id] || `Event ${id}`);
    const plots: Record<string, number[]> = {};
    const totals: Record<string, number> = {};
    for (const e of events) {
      plots[e] = [];
      totals[e] = 0;
    }

    // Build day intervals
    const dayMs = 86400000;
    const times: string[] = [];
    const timestamps: number[] = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const endTarget = new Date(stopDate);
    endTarget.setHours(23, 59, 59, 999);

    while (current <= endTarget) {
      const ymd = formatDateYMD(current);
      times.push(ymd);
      timestamps.push(Math.floor(current.getTime() / 1000));
      current.setTime(current.getTime() + dayMs);
    }

    if (!times.length) {
      const ymd = formatDateYMD(startDate);
      times.push(ymd);
      timestamps.push(Math.floor(startDate.getTime() / 1000));
    }

    // Fetch raw thread events grouped by date and event_id
    const rows: Array<{ event_id: bigint | number; day: string; count: bigint | number }> = await this.prisma.$queryRawUnsafe(`
      SELECT 
        event_id,
        TO_CHAR(timestamp, 'YYYY-MM-DD') AS day,
        COUNT(DISTINCT id) AS count
      FROM ost_thread_event
      WHERE timestamp BETWEEN $1 AND $2
        AND annulled = 0
        AND thread_type = 'T'
        AND event_id = ANY($3::bigint[])
      GROUP BY event_id, TO_CHAR(timestamp, 'YYYY-MM-DD')
      ORDER BY day ASC;
    `, startDate, stopDate, PLOT_EVENT_IDS);

    const dataLookup = new Map<string, number>();
    for (const r of rows) {
      const eName = EVENT_NAMES[Number(r.event_id)];
      if (eName) {
        dataLookup.set(`${r.day}:${eName}`, Number(r.count));
      }
    }

    for (const t of times) {
      for (const e of events) {
        const count = dataLookup.get(`${t}:${e}`) || 0;
        plots[e].push(count);
        totals[e] += count;
      }
    }

    return { times, timestamps, events, plots, totals };
  }

  async getTabularData(group: 'dept' | 'topic' | 'staff', startDate: Date, stopDate: Date): Promise<TabularReport> {
    const dashHeaders = ['Opened', 'Assigned', 'Overdue', 'Closed', 'Reopened', 'Deleted', 'Service Time', 'Response Time'];

    if (group === 'dept') {
      const headers = ['Department', ...dashHeaders];
      const departments = await this.prisma.department.findMany({ orderBy: { name: 'asc' } });

      const stats: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          dept_id,
          COUNT(CASE WHEN event_id = 1 THEN 1 END)::int as opened,
          COUNT(CASE WHEN event_id = 4 THEN 1 END)::int as assigned,
          COUNT(CASE WHEN event_id = 8 THEN 1 END)::int as overdue,
          COUNT(CASE WHEN event_id = 2 THEN 1 END)::int as closed,
          COUNT(CASE WHEN event_id = 3 THEN 1 END)::int as reopened,
          COUNT(CASE WHEN event_id = 14 THEN 1 END)::int as deleted
        FROM ost_thread_event
        WHERE timestamp BETWEEN $1 AND $2
          AND annulled = 0
          AND thread_type = 'T'
        GROUP BY dept_id;
      `, startDate, stopDate);

      const serviceTimes: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          c.dept_id,
          AVG(EXTRACT(EPOCH FROM (c.timestamp - o.timestamp)) / 3600.0) as avg_service_hours
        FROM ost_thread_event c
        JOIN ost_thread_event o ON c.thread_id = o.thread_id AND o.event_id = 1 AND o.annulled = 0
        WHERE c.event_id = 2 
          AND c.annulled = 0
          AND c.thread_type = 'T'
          AND c.timestamp BETWEEN $1 AND $2
        GROUP BY c.dept_id;
      `, startDate, stopDate);

      const responseTimes: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          t.dept_id,
          AVG(EXTRACT(EPOCH FROM (r.created - m.created)) / 3600.0) as avg_response_hours
        FROM ost_thread_entry r
        JOIN ost_thread th ON th.id = r.thread_id AND th.object_type = 'T'
        JOIN ost_ticket t ON t.ticket_id = th.object_id
        CROSS JOIN LATERAL (
          SELECT created 
          FROM ost_thread_entry 
          WHERE thread_id = r.thread_id 
            AND type = 'M' 
            AND created <= r.created
          ORDER BY created DESC 
          LIMIT 1
        ) m
        WHERE r.type = 'R'
          AND r.created BETWEEN $1 AND $2
        GROUP BY t.dept_id;
      `, startDate, stopDate);

      const statsMap = new Map(stats.map((s) => [String(s.dept_id), s]));
      const serviceMap = new Map(serviceTimes.map((s) => [String(s.dept_id), Number(s.avg_service_hours)]));
      const responseMap = new Map(responseTimes.map((r) => [String(r.dept_id), Number(r.avg_response_hours)]));

      const rows: Array<Array<string | number>> = departments.map((dept) => {
        const id = String(dept.id);
        const st = statsMap.get(id);
        let statusSuffix = '';
        if (dept.flags & 2) statusSuffix = ' - Archived';
        else if (!(dept.flags & 1)) statusSuffix = ' - Disabled';

        const name = `${dept.name}${statusSuffix}`;
        const opened = st?.opened || 0;
        const assigned = st?.assigned || 0;
        const overdue = st?.overdue || 0;
        const closed = st?.closed || 0;
        const reopened = st?.reopened || 0;
        const deleted = st?.deleted || 0;

        const svc = serviceMap.get(id);
        const resp = responseMap.get(id);
        const serviceTimeStr = svc != null ? svc.toFixed(1) : '0.0';
        const responseTimeStr = resp != null ? resp.toFixed(1) : '0.0';

        return [name, opened, assigned, overdue, closed, reopened, deleted, serviceTimeStr, responseTimeStr];
      });

      return { columns: headers, data: rows };
    }

    if (group === 'topic') {
      const headers = ['Help Topic', ...dashHeaders];
      const topics = await this.prisma.helpTopic.findMany({ orderBy: { topic: 'asc' } });

      const stats: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          topic_id,
          COUNT(CASE WHEN event_id = 1 THEN 1 END)::int as opened,
          COUNT(CASE WHEN event_id = 4 THEN 1 END)::int as assigned,
          COUNT(CASE WHEN event_id = 8 THEN 1 END)::int as overdue,
          COUNT(CASE WHEN event_id = 2 THEN 1 END)::int as closed,
          COUNT(CASE WHEN event_id = 3 THEN 1 END)::int as reopened,
          COUNT(CASE WHEN event_id = 14 THEN 1 END)::int as deleted
        FROM ost_thread_event
        WHERE timestamp BETWEEN $1 AND $2
          AND annulled = 0
          AND thread_type = 'T'
          AND topic_id > 0
        GROUP BY topic_id;
      `, startDate, stopDate);

      const serviceTimes: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          c.topic_id,
          AVG(EXTRACT(EPOCH FROM (c.timestamp - o.timestamp)) / 3600.0) as avg_service_hours
        FROM ost_thread_event c
        JOIN ost_thread_event o ON c.thread_id = o.thread_id AND o.event_id = 1 AND o.annulled = 0
        WHERE c.event_id = 2 
          AND c.annulled = 0
          AND c.thread_type = 'T'
          AND c.topic_id > 0
          AND c.timestamp BETWEEN $1 AND $2
        GROUP BY c.topic_id;
      `, startDate, stopDate);

      const responseTimes: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT 
          t.topic_id,
          AVG(EXTRACT(EPOCH FROM (r.created - m.created)) / 3600.0) as avg_response_hours
        FROM ost_thread_entry r
        JOIN ost_thread th ON th.id = r.thread_id AND th.object_type = 'T'
        JOIN ost_ticket t ON t.ticket_id = th.object_id
        CROSS JOIN LATERAL (
          SELECT created 
          FROM ost_thread_entry 
          WHERE thread_id = r.thread_id 
            AND type = 'M' 
            AND created <= r.created
          ORDER BY created DESC 
          LIMIT 1
        ) m
        WHERE r.type = 'R'
          AND t.topic_id > 0
          AND r.created BETWEEN $1 AND $2
        GROUP BY t.topic_id;
      `, startDate, stopDate);

      const statsMap = new Map(stats.map((s) => [String(s.topic_id), s]));
      const serviceMap = new Map(serviceTimes.map((s) => [String(s.topic_id), Number(s.avg_service_hours)]));
      const responseMap = new Map(responseTimes.map((r) => [String(r.topic_id), Number(r.avg_response_hours)]));

      const rows: Array<Array<string | number>> = topics.map((t) => {
        const id = String(t.topic_id);
        const st = statsMap.get(id);
        let statusSuffix = '';
        if (Number(t.flags || 0) & 2) statusSuffix = ' - Archived';
        else if (t.ispublic === 0) statusSuffix = ' - Disabled';

        const name = `${t.topic}${statusSuffix}`;
        const opened = st?.opened || 0;
        const assigned = st?.assigned || 0;
        const overdue = st?.overdue || 0;
        const closed = st?.closed || 0;
        const reopened = st?.reopened || 0;
        const deleted = st?.deleted || 0;

        const svc = serviceMap.get(id);
        const resp = responseMap.get(id);
        const serviceTimeStr = svc != null ? svc.toFixed(1) : '0.0';
        const responseTimeStr = resp != null ? resp.toFixed(1) : '0.0';

        return [name, opened, assigned, overdue, closed, reopened, deleted, serviceTimeStr, responseTimeStr];
      });

      return { columns: headers, data: rows };
    }

    // Default to 'staff'
    const headers = ['Agent', ...dashHeaders];
    const staffList = await this.prisma.staff.findMany({
      orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }],
    });

    const stats: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        staff_id,
        COUNT(CASE WHEN event_id = 1 THEN 1 END)::int as opened,
        COUNT(CASE WHEN event_id = 4 THEN 1 END)::int as assigned,
        COUNT(CASE WHEN event_id = 8 THEN 1 END)::int as overdue,
        COUNT(CASE WHEN event_id = 2 THEN 1 END)::int as closed,
        COUNT(CASE WHEN event_id = 3 THEN 1 END)::int as reopened,
        COUNT(CASE WHEN event_id = 14 THEN 1 END)::int as deleted
      FROM ost_thread_event
      WHERE timestamp BETWEEN $1 AND $2
        AND annulled = 0
        AND thread_type = 'T'
        AND staff_id > 0
      GROUP BY staff_id;
    `, startDate, stopDate);

    const serviceTimes: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        c.staff_id,
        AVG(EXTRACT(EPOCH FROM (c.timestamp - o.timestamp)) / 3600.0) as avg_service_hours
      FROM ost_thread_event c
      JOIN ost_thread_event o ON c.thread_id = o.thread_id AND o.event_id = 1 AND o.annulled = 0
      WHERE c.event_id = 2 
        AND c.annulled = 0
        AND c.thread_type = 'T'
        AND c.staff_id > 0
        AND c.timestamp BETWEEN $1 AND $2
      GROUP BY c.staff_id;
    `, startDate, stopDate);

    const responseTimes: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT 
        r.staff_id,
        AVG(EXTRACT(EPOCH FROM (r.created - m.created)) / 3600.0) as avg_response_hours
      FROM ost_thread_entry r
      CROSS JOIN LATERAL (
        SELECT created 
        FROM ost_thread_entry 
        WHERE thread_id = r.thread_id 
          AND type = 'M' 
          AND created <= r.created
        ORDER BY created DESC 
        LIMIT 1
      ) m
      WHERE r.type = 'R'
        AND r.staff_id > 0
        AND r.created BETWEEN $1 AND $2
      GROUP BY r.staff_id;
    `, startDate, stopDate);

    const statsMap = new Map(stats.map((s) => [String(s.staff_id), s]));
    const serviceMap = new Map(serviceTimes.map((s) => [String(s.staff_id), Number(s.avg_service_hours)]));
    const responseMap = new Map(responseTimes.map((r) => [String(r.staff_id), Number(r.avg_response_hours)]));

    const rows: Array<Array<string | number>> = staffList.map((s) => {
      const id = String(s.staff_id);
      const st = statsMap.get(id);
      let statusSuffix = '';
      if (!s.isactive) statusSuffix = ' - Disabled';

      const agentName = [s.firstname, s.lastname].filter(Boolean).join(' ') || s.username;
      const name = `${agentName}${statusSuffix}`;
      const opened = st?.opened || 0;
      const assigned = st?.assigned || 0;
      const overdue = st?.overdue || 0;
      const closed = st?.closed || 0;
      const reopened = st?.reopened || 0;
      const deleted = st?.deleted || 0;

      const svc = serviceMap.get(id);
      const resp = responseMap.get(id);
      const serviceTimeStr = svc != null ? svc.toFixed(1) : '0.0';
      const responseTimeStr = resp != null ? resp.toFixed(1) : '0.0';

      return [name, opened, assigned, overdue, closed, reopened, deleted, serviceTimeStr, responseTimeStr];
    });

    return { columns: headers, data: rows };
  }

  async getOverview(startInput?: string, periodInput?: string): Promise<DashboardOverview> {
    const { startDate, stopDate, timeframe } = this.parseTimeframe(startInput, periodInput);

    const [workload, plots, deptTable, topicTable, staffTable] = await Promise.all([
      this.getWorkload(),
      this.getPlotData(startDate, stopDate),
      this.getTabularData('dept', startDate, stopDate),
      this.getTabularData('topic', startDate, stopDate),
      this.getTabularData('staff', startDate, stopDate),
    ]);

    return {
      timeframe,
      workload,
      plots,
      tables: {
        dept: deptTable,
        topic: topicTable,
        staff: staffTable,
      },
    };
  }

  async exportCsv(group: 'dept' | 'topic' | 'staff', startInput?: string, periodInput?: string) {
    const { startDate, stopDate } = this.parseTimeframe(startInput, periodInput);
    const table = await this.getTabularData(group, startDate, stopDate);

    const escapeCell = (v: string | number) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [
      table.columns.map(escapeCell).join(','),
      ...table.data.map((row) => row.map(escapeCell).join(',')),
    ];

    // UTF-8 BOM + CSV content
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const ts = formatDateYMD(new Date()).replace(/-/g, '');
    const filename = `stats-${group}-${ts}.csv`;

    return { filename, csvContent };
  }
}
