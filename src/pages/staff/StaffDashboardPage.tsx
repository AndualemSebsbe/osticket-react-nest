import { useEffect, useMemo, useState, useRef, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, inputClass, btnPrimary, btnGhost } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import {
  getDashboardOverview,
  downloadDashboardExport,
  type DashboardOverview,
} from '../../lib/api'

type TabGroup = 'dept' | 'topic' | 'staff'

const HELP_TIPS: Record<string, { title: string; content: string }> = {
  report_timeframe: {
    title: 'Report timeframe',
    content:
      'Choose a start date for the desired data sample using the date picker. Then, choose the length of time from that date to define the end date for your data sample.',
  },
  ticket_activity: {
    title: 'Ticket Activity',
    content:
      'Select a date range to cause both the graph and the table below to focus on any corresponding data for those dates. The graph will reflect a broad overview of the whole system’s data. You may export any data currently displayed in the Statistics table.',
  },
  statistics: {
    title: 'Statistics',
    content:
      'Navigate to the subject of interest by clicking on the appropriate tab in order to view the specific sample of data. The bubble size represents the relative volume of tickets.',
  },
  opened: {
    title: 'Opened',
    content:
      'Tickets that were originally opened having the Department or Help Topic on the ticket, or the number of tickets an Agent has opened on behalf of a User.',
  },
  assigned: {
    title: 'Assigned',
    content:
      'Tickets that have been assigned to either an Agent or a Team. The number reflects tickets that are manually assigned to agents or teams, claimed tickets, and tickets assigned from ticket filters.',
  },
  overdue: {
    title: 'Overdue',
    content:
      'Tickets that have been marked ‘Overdue’ by the system. Tickets are marked Overdue when they have violated the SLA Plan, causing them to have a status of ‘Open’ past their Due Date.',
  },
  closed: {
    title: 'Closed',
    content: 'The number of Tickets that are currently in the Closed status.',
  },
  reopened: {
    title: 'Reopened',
    content:
      'The total number of times a ticket was Reopened. Tickets are reopened whenever their status is changed from Closed to Open.',
  },
  deleted: {
    title: 'Deleted',
    content: 'The amount of tickets that have been deleted.',
  },
  service_time: {
    title: 'Service Time',
    content:
      'Refers to the duration of time that begins at the opening of a ticket and ends when the ticket is closed. Measures the average Service Time per ticket, in hours.',
  },
  response_time: {
    title: 'Response Time',
    content:
      'Shows an average response time by an Agent, in hours, to ticket correspondence.',
  },
}

const EVENT_COLORS: Record<string, string> = {
  Created: '#2563eb', // blue
  Closed: '#16a34a', // green
  Reopened: '#d97706', // amber
  Assigned: '#9333ea', // purple
  Overdue: '#dc2626', // red
  Transferred: '#0d9488', // teal
}

function HelpIcon({ tipKey }: { tipKey: keyof typeof HELP_TIPS }) {
  const [open, setOpen] = useState(false)
  const tip = HELP_TIPS[tipKey]
  if (!tip) return null

  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        aria-label={`Help on ${tip.title}`}
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700 hover:bg-brand-600 hover:text-white transition-colors"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-xl bg-slate-900 p-3 text-left text-xs font-normal text-white shadow-xl pointer-events-none"
        >
          <strong className="block font-semibold text-brand-300 mb-1">{tip.title}</strong>
          <span>{tip.content}</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
        </span>
      )}
    </span>
  )
}

function ActivityChart({
  plots,
  visibleSeries,
  onToggleSeries,
}: {
  plots: DashboardOverview['plots']
  visibleSeries: Record<string, boolean>
  onToggleSeries: (event: string) => void
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const { times, events, plots: seriesData } = plots
  const n = times.length

  const allVals = events.flatMap((e) => (visibleSeries[e] !== false ? seriesData[e] || [] : []))
  const maxVal = Math.max(5, ...allVals)

  // Chart dimensions
  const width = 800
  const height = 260
  const padding = { top: 20, right: 30, bottom: 40, left: 45 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const getX = (idx: number) => {
    if (n <= 1) return padding.left + chartW / 2
    return padding.left + (idx / (n - 1)) * chartW
  }

  const getY = (val: number) => {
    return padding.top + chartH - (val / maxVal) * chartH
  }

  // Y-axis ticks
  const yTicks = [0, Math.round(maxVal / 4), Math.round(maxVal / 2), Math.round((3 * maxVal) / 4), maxVal]
  const uniqueYTicks = Array.from(new Set(yTicks)).sort((a, b) => a - b)

  // X-axis label step
  const step = Math.max(1, Math.ceil(n / 7))
  const xLabels = times
    .map((t, i) => ({ text: t.slice(5), full: t, idx: i }))
    .filter((_, i) => i === 0 || i === n - 1 || i % step === 0)

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || n <= 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    const plotX = svgX - padding.left
    const ratio = Math.max(0, Math.min(1, plotX / chartW))
    const index = Math.round(ratio * (n - 1))
    setHoverIndex(index)
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium" id="line-chart-legend">
        {events.map((e) => {
          const color = EVENT_COLORS[e] || '#64748b'
          const isVisible = visibleSeries[e] !== false
          const total = plots.totals[e] ?? 0
          return (
            <button
              key={e}
              type="button"
              onClick={() => onToggleSeries(e)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                isVisible
                  ? 'bg-slate-100 text-slate-800 shadow-sm border border-slate-200'
                  : 'bg-slate-50 text-slate-400 line-through opacity-60'
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: isVisible ? color : '#cbd5e1' }}
              />
              <span>{e}</span>
              <span className="font-semibold text-slate-500">({total})</span>
            </button>
          )
        })}
      </div>

      {/* SVG Chart */}
      <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid lines */}
          {uniqueYTicks.map((tick) => {
            const y = getY(tick)
            return (
              <g key={tick} className="text-slate-300">
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + chartW}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {tick}
                </text>
              </g>
            )
          })}

          {/* X axis line */}
          <line
            x1={padding.left}
            y1={padding.top + chartH}
            x2={padding.left + chartW}
            y2={padding.top + chartH}
            stroke="#94a3b8"
            strokeWidth="1"
          />

          {/* X axis labels */}
          {xLabels.map((item) => (
            <text
              key={item.idx}
              x={getX(item.idx)}
              y={padding.top + chartH + 18}
              textAnchor="middle"
              className="fill-slate-500 text-[11px]"
            >
              {item.text}
            </text>
          ))}

          {/* Event series lines and points */}
          {events.map((e) => {
            if (visibleSeries[e] === false) return null
            const color = EVENT_COLORS[e] || '#64748b'
            const data = seriesData[e] || []

            const points = data.map((val, idx) => `${getX(idx)},${getY(val)}`).join(' ')

            return (
              <g key={e}>
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
                {data.map((val, idx) => {
                  if (val === 0 && n > 15 && idx !== hoverIndex) return null
                  const cx = getX(idx)
                  const cy = getY(val)
                  const isHovered = hoverIndex === idx
                  return (
                    <circle
                      key={idx}
                      cx={cx}
                      cy={cy}
                      r={isHovered ? 5.5 : val > 0 ? 3.5 : 2}
                      fill="#ffffff"
                      stroke={color}
                      strokeWidth={isHovered ? 3 : 2}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Hover indicator vertical line */}
          {hoverIndex !== null && (
            <line
              x1={getX(hoverIndex)}
              y1={padding.top}
              x2={getX(hoverIndex)}
              y2={padding.top + chartH}
              stroke="#64748b"
              strokeDasharray="2 2"
              strokeWidth="1.5"
            />
          )}
        </svg>

        {/* Hover Tooltip Popup */}
        {hoverIndex !== null && (
          <div
            className="pointer-events-none absolute z-20 rounded-xl bg-slate-900/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-sm"
            style={{
              left: `${Math.min(85, Math.max(15, (getX(hoverIndex) / width) * 100))}%`,
              top: '15px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="font-semibold text-slate-300 border-b border-slate-700 pb-1 mb-1">
              {times[hoverIndex]}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {events.map((e) => {
                if (visibleSeries[e] === false) return null
                const color = EVENT_COLORS[e] || '#64748b'
                const count = seriesData[e]?.[hoverIndex] || 0
                return (
                  <div key={e} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      {e}:
                    </span>
                    <span className="font-mono font-bold text-white">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function StaffDashboardPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [period, setPeriod] = useState('now')
  const [activeTab, setActiveTab] = useState<TabGroup>('dept')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({
    Created: true,
    Closed: true,
    Reopened: true,
    Assigned: true,
    Overdue: true,
    Transferred: true,
  })

  // Load dashboard overview from backend
  async function loadData(startVal = startDate, periodVal = period) {
    try {
      setRefreshing(true)
      const data = await getDashboardOverview(startVal, periodVal)
      setOverview(data)
      if (data.timeframe.startDateInput) {
        setStartDate(data.timeframe.startDateInput)
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault()
    void loadData(startDate, period)
  }

  function handlePeriodChange(newPeriod: string) {
    setPeriod(newPeriod)
    void loadData(startDate, newPeriod)
  }

  function toggleSeries(event: string) {
    setVisibleSeries((prev) => ({
      ...prev,
      [event]: prev[event] === false ? true : false,
    }))
  }

  async function handleExport() {
    try {
      setExporting(true)
      await downloadDashboardExport(activeTab, startDate, period)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  // Active tabular report data
  const currentTable = overview?.tables[activeTab] || { columns: [], data: [] }

  // Compute column totals and heat map maximum
  const { totals, maxCount } = useMemo(() => {
    if (!currentTable.data.length) {
      return { totals: [0, 0, 0, 0, 0, 0, '0.0', '0.0'], maxCount: 1 }
    }
    const sumOpened = currentTable.data.reduce((acc, row) => acc + Number(row[1] || 0), 0)
    const sumAssigned = currentTable.data.reduce((acc, row) => acc + Number(row[2] || 0), 0)
    const sumOverdue = currentTable.data.reduce((acc, row) => acc + Number(row[3] || 0), 0)
    const sumClosed = currentTable.data.reduce((acc, row) => acc + Number(row[4] || 0), 0)
    const sumReopened = currentTable.data.reduce((acc, row) => acc + Number(row[5] || 0), 0)
    const sumDeleted = currentTable.data.reduce((acc, row) => acc + Number(row[6] || 0), 0)

    const serviceVals = currentTable.data.map((row) => Number(row[7] || 0)).filter((v) => v > 0)
    const avgService = serviceVals.length
      ? (serviceVals.reduce((a, b) => a + b, 0) / serviceVals.length).toFixed(1)
      : '0.0'

    const responseVals = currentTable.data.map((row) => Number(row[8] || 0)).filter((v) => v > 0)
    const avgResponse = responseVals.length
      ? (responseVals.reduce((a, b) => a + b, 0) / responseVals.length).toFixed(1)
      : '0.0'

    let maxNum = 1
    for (const row of currentTable.data) {
      for (let j = 1; j <= 6; j++) {
        const val = Number(row[j] || 0)
        if (val > maxNum) maxNum = val
      }
    }

    return {
      totals: [sumOpened, sumAssigned, sumOverdue, sumClosed, sumReopened, sumDeleted, avgService, avgResponse],
      maxCount: maxNum,
    }
  }, [currentTable])

  const workload = overview?.workload || { open: 0, pending: 0, overdue: 0, unassigned: 0 }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="A historical analytical overview of ticket metadata across departments, help topics, and agents."
        actions={
          <div className="flex gap-2">
            {isAdmin ? (
              <Link
                to="/scp/admin"
                className="inline-flex min-h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                Admin panel
              </Link>
            ) : null}
            <Link
              to="/scp/tickets/new"
              className="inline-flex min-h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-800 hover:bg-paper"
            >
              Open ticket
            </Link>
          </div>
        }
      />

      {/* Current Workload overview */}
      <section aria-labelledby="workload-heading">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h2 id="workload-heading" className="text-sm font-semibold text-ink-800">
              Current Workload
            </h2>
          </div>
          <Link to="/scp/tickets" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            View all tickets →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link to="/scp/tickets?queue=open" className="group">
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-600">Open tickets</span>
                <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Live</span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{workload.open}</p>
              <span className="mt-1 block text-xs text-ink-400 group-hover:text-brand-600">Open queue ↗</span>
            </Card>
          </Link>
          <Link to="/scp/tickets?queue=pending" className="group">
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-600">Pending</span>
                <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Live</span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{workload.pending}</p>
              <span className="mt-1 block text-xs text-ink-400 group-hover:text-brand-600">Open queue ↗</span>
            </Card>
          </Link>
          <Link to="/scp/tickets?queue=overdue" className="group">
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-600">Overdue</span>
                <span className="rounded-lg bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Live</span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{workload.overdue}</p>
              <span className="mt-1 block text-xs text-ink-400 group-hover:text-brand-600">Open queue ↗</span>
            </Card>
          </Link>
          <Link to="/scp/tickets?queue=unassigned" className="group">
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-600">Unassigned</span>
                <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Live</span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{workload.unassigned}</p>
              <span className="mt-1 block text-xs text-ink-400 group-hover:text-brand-600">Open queue ↗</span>
            </Card>
          </Link>
        </div>
      </section>

      {/* Basic Search / Timeframe Form */}
      <Card className="space-y-4">
        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3 sm:gap-4" id="basic_search">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-600">
            <span className="flex items-center gap-1">
              Report timeframe:
              <HelpIcon tipKey="report_timeframe" />
            </span>
            <input
              type="date"
              name="start"
              className={inputClass + ' mt-1.5 w-44 font-normal tracking-normal text-xs sm:text-sm'}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-ink-600">
            period:
            <select
              name="period"
              className={inputClass + ' mt-1.5 w-44 font-normal tracking-normal text-xs sm:text-sm'}
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
            >
              <option value="now">Up to today</option>
              <option value="+7 days">One Week</option>
              <option value="+14 days">Two Weeks</option>
              <option value="+1 month">One Month</option>
              <option value="+3 months">One Quarter</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={refreshing}
            className={`${btnPrimary} min-h-10 px-5 text-xs font-semibold tracking-wide uppercase`}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </form>

        <hr className="border-line" />

        {/* Ticket Activity Chart */}
        <section aria-labelledby="ticket-activity-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="ticket-activity-heading" className="text-base font-bold text-ink-800 flex items-center">
              Ticket Activity
              <HelpIcon tipKey="ticket_activity" />
            </h2>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-sm text-ink-500">
              Loading ticket activity graph…
            </div>
          ) : overview?.plots ? (
            <ActivityChart
              plots={overview.plots}
              visibleSeries={visibleSeries}
              onToggleSeries={toggleSeries}
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-ink-500">
              No ticket activity found for this timeframe.
            </div>
          )}
        </section>

        <hr className="border-line" />

        {/* Tabular Statistics Section */}
        <section aria-labelledby="statistics-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="statistics-heading" className="text-base font-bold text-ink-800 flex items-center">
              Statistics
              <HelpIcon tipKey="statistics" />
            </h2>
            <p className="text-xs text-ink-600">
              Statistics of tickets organized by department, help topic, and agent.
            </p>
            {overview?.timeframe && (
              <p className="text-xs font-medium text-ink-700">
                <b>Range: </b>
                <span className="text-ink-600">{overview.timeframe.displayRange}</span>
              </p>
            )}
          </div>

          {/* Clean Tabs */}
          <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Statistics Groups">
            {[
              { id: 'dept' as const, label: 'Department' },
              { id: 'topic' as const, label: 'Topics' },
              { id: 'staff' as const, label: 'Agent' },
            ].map((tab) => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-10 border-b-2 px-4 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-ink-600 hover:text-ink-800'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Statistics Table */}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-paper text-ink-700 border-b border-line text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 font-semibold w-1/3">
                    {activeTab === 'dept' ? 'Department' : activeTab === 'topic' ? 'Help Topic' : 'Agent'}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Opened <HelpIcon tipKey="opened" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Assigned <HelpIcon tipKey="assigned" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Overdue <HelpIcon tipKey="overdue" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Closed <HelpIcon tipKey="closed" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Reopened <HelpIcon tipKey="reopened" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Deleted <HelpIcon tipKey="deleted" />
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Service Time <HelpIcon tipKey="service_time" />
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Response Time <HelpIcon tipKey="response_time" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {currentTable.data.map((row, idx) => {
                  const name = String(row[0])
                  const opened = Number(row[1])
                  const assigned = Number(row[2])
                  const overdue = Number(row[3])
                  const closed = Number(row[4])
                  const reopened = Number(row[5])
                  const deleted = Number(row[6])
                  const serviceTime = String(row[7])
                  const responseTime = String(row[8])

                  const bubbleSize = (val: number) => {
                    if (val === 0) return 0
                    const ratio = val / maxCount
                    return Math.max(6, Math.min(18, Math.round(6 + ratio * 12)))
                  }

                  return (
                    <tr key={idx} className="hover:bg-paper/50 transition-colors">
                      <th scope="row" className="px-4 py-2.5 font-medium text-ink-800">
                        {name}
                      </th>

                      {/* Opened */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {opened > 0 && (
                            <span
                              className="rounded-full bg-blue-500/20 text-blue-700 shrink-0"
                              style={{ width: `${bubbleSize(opened)}px`, height: `${bubbleSize(opened)}px` }}
                            />
                          )}
                          <span>{opened}</span>
                        </span>
                      </td>

                      {/* Assigned */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {assigned > 0 && (
                            <span
                              className="rounded-full bg-purple-500/20 text-purple-700 shrink-0"
                              style={{ width: `${bubbleSize(assigned)}px`, height: `${bubbleSize(assigned)}px` }}
                            />
                          )}
                          <span>{assigned}</span>
                        </span>
                      </td>

                      {/* Overdue */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {overdue > 0 && (
                            <span
                              className="rounded-full bg-rose-500/20 text-rose-700 shrink-0"
                              style={{ width: `${bubbleSize(overdue)}px`, height: `${bubbleSize(overdue)}px` }}
                            />
                          )}
                          <span className={overdue > 0 ? 'text-rose-600 font-semibold' : ''}>{overdue}</span>
                        </span>
                      </td>

                      {/* Closed */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {closed > 0 && (
                            <span
                              className="rounded-full bg-green-500/20 text-green-700 shrink-0"
                              style={{ width: `${bubbleSize(closed)}px`, height: `${bubbleSize(closed)}px` }}
                            />
                          )}
                          <span>{closed}</span>
                        </span>
                      </td>

                      {/* Reopened */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {reopened > 0 && (
                            <span
                              className="rounded-full bg-amber-500/20 text-amber-700 shrink-0"
                              style={{ width: `${bubbleSize(reopened)}px`, height: `${bubbleSize(reopened)}px` }}
                            />
                          )}
                          <span>{reopened}</span>
                        </span>
                      </td>

                      {/* Deleted */}
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {deleted > 0 && (
                            <span
                              className="rounded-full bg-slate-500/20 text-slate-700 shrink-0"
                              style={{ width: `${bubbleSize(deleted)}px`, height: `${bubbleSize(deleted)}px` }}
                            />
                          )}
                          <span>{deleted}</span>
                        </span>
                      </td>

                      {/* Service Time */}
                      <td className="px-3 py-2.5 text-right tabular-nums font-mono text-xs text-ink-700">
                        {serviceTime !== '0.0' ? `${serviceTime} hrs` : '0.0 hrs'}
                      </td>

                      {/* Response Time */}
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs text-ink-700">
                        {responseTime !== '0.0' ? `${responseTime} hrs` : '0.0 hrs'}
                      </td>
                    </tr>
                  )
                })}

                {!currentTable.data.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-500">
                      No ticket statistics available for this selection.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Totals Row */}
              {currentTable.data.length > 0 && (
                <tfoot className="border-t-2 border-line bg-paper/80 font-semibold text-ink-800">
                  <tr>
                    <td className="px-4 py-3">Total / Average</td>
                    <td className="px-3 py-3 text-right tabular-nums">{totals[0]}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{totals[1]}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-rose-600">{totals[2]}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{totals[3]}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{totals[4]}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{totals[5]}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-mono text-xs">{totals[6]} hrs</td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">{totals[7]} hrs</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Export Button */}
          <div className="pt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className={`${btnGhost} inline-flex items-center gap-2 text-xs font-semibold tracking-wide`}
            >
              <svg className="w-4 h-4 text-ink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {exporting ? 'Exporting CSV…' : 'Export'}
            </button>
            <span className="text-xs text-ink-400">
              Download CSV report for {activeTab === 'dept' ? 'Departments' : activeTab === 'topic' ? 'Topics' : 'Agents'}
            </span>
          </div>
        </section>
      </Card>
    </div>
  )
}
