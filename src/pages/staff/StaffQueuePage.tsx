import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PriorityBadge, StatusBadge } from '../../components/Badges'
import { btnGhost, btnPrimary, PageHeader, inputClass} from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useDb } from '../../hooks/useDb'
import { ticketQueues } from '../../layouts/staffNav'
import { relativeTime } from '../../lib/format'
import { bulkTickets, matchQueue, ticketsToCsv } from '../../lib/store'

export function StaffQueuePage() {
  const [params, setParams] = useSearchParams()
  const queue = params.get('queue') || 'open'
  const dept = params.get('dept') ?? 'all'
  const q = params.get('q') ?? ''
  const db = useDb()
  const { user } = useAuth()
  const agents = useAgents()
  const [selected, setSelected] = useState<string[]>([])

  const tickets = useMemo(() => {
    return matchQueue(db.tickets, queue, user?.id, db.queues).filter((t) => {
      if (dept !== 'all' && t.deptId !== dept) return false
      if (q && !`${t.number} ${t.subject}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [db, queue, q, dept, user?.id])

  function patch(key: string, value: string) {
    const copy = new URLSearchParams(params)
    if (!value || value === 'all' && key !== 'queue') copy.delete(key)
    else copy.set(key, value)
    setParams(copy)
    setSelected([])
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function exportCsv() {
    const blob = new Blob([ticketsToCsv(tickets)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tickets-${queue}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Ticket queues"
        subtitle="Open, mine, unassigned, overdue, and closed — matching osTicket staff queues."
        actions={
          <>
            <Link to="/scp/tickets/new" className={btnPrimary}>
              Open ticket
            </Link>
            <button type="button" className={btnGhost} onClick={exportCsv}>
              Export CSV
            </button>
            {user?.role === 'admin' ? <Link to="/scp/admin/queues" className={btnGhost}>Manage queues</Link> : null}
          </>
        }
      />
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[...ticketQueues, ...db.queues.filter((item) => item.enabled).map((item) => ({ id: item.id, label: item.title }))].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => patch('queue', item.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${queue === item.id ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          value={q}
          onChange={(e) => patch('q', e.target.value)}
          placeholder="Search number or subject"
          className={inputClass + " flex-1"}
        />
        <select value={dept} onChange={(e) => patch('dept', e.target.value)} className={inputClass}>
          <option value="all">All departments</option>
          {db.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {selected.length > 0 && user ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <span>{selected.length} selected</span>
          <button type="button" className={btnGhost} onClick={() => bulkTickets(selected, { status: 'closed' }, user)}>
            Close
          </button>
          <button type="button" className={btnGhost} onClick={() => bulkTickets(selected, { status: 'open' }, user)}>
            Reopen
          </button>
          <select
            className={inputClass}
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return
              bulkTickets(selected, { assigneeId: e.target.value === 'none' ? null : e.target.value }, user)
              e.target.value = ''
            }}
          >
            <option value="">Assign…</option>
            <option value="none">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ul className="mt-6 grid gap-3 lg:hidden">
        {tickets.map((t) => {
          const assignee = db.users.find((u) => u.id === t.assigneeId)
          return (
            <li key={t.id} className="rounded-2xl border border-line bg-surface p-4">
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                Select
              </label>
              <Link to={`/scp/tickets/${t.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">
                    #{t.number} {t.subject}
                  </p>
                  <StatusBadge status={t.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                  <PriorityBadge priority={t.priority} />
                  {t.branchName ? <span>Branch: {t.branchName}</span> : null}
                  <span>{assignee?.name ?? 'Unassigned'}</span>
                  <span>{relativeTime(t.updatedAt)}</span>
                  {t.overdue ? <span className="text-rose-600">overdue</span> : null}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="-mx-3 mt-6 hidden overflow-x-auto px-3 lg:mx-0 lg:block lg:px-0">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-paper text-ink-600">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={tickets.length > 0 && selected.length === tickets.length}
                    onChange={(e) => setSelected(e.target.checked ? tickets.map((t) => t.id) : [])}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Branch</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const assignee = db.users.find((u) => u.id === t.assigneeId)
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/scp/tickets/${t.id}`} className="text-brand-600">
                        {t.number}
                      </Link>
                      {t.overdue ? <span className="ml-2 text-xs text-rose-600">overdue</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/scp/tickets/${t.id}`} className="hover:underline">
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3">{t.branchName || '—'}</td>
                    <td className="px-4 py-3">{assignee?.name ?? 'Unassigned'}</td>
                    <td className="px-4 py-3 text-ink-600">{relativeTime(t.updatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {tickets.length === 0 ? <p className="mt-6 text-sm text-ink-600">No tickets in this queue.</p> : null}
    </div>
  )
}
