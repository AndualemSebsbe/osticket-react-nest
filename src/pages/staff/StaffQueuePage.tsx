import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bookmark } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '../../components/Badges'
import { btnGhost, btnPrimary, inputClass, PageHeader } from '../../components/ui'
import { PersonalQueueModal } from '../../components/PersonalQueueModal'
import { useAuth } from '../../context/AuthContext'
import { useDialogs } from '../../context/DialogContext'
import { useAgents } from '../../hooks/useAgents'
import { useDb } from '../../hooks/useDb'
import { ticketQueues } from '../../layouts/staffNav'
import {
  deleteApiPersonalQueue,
  getApiAdvancedSearchOptions,
  listApiQueueTickets,
  listApiQueues,
  type ApiAdvancedSearchOptions,
  type ApiQueueTicketsInput,
  type ApiQueueTicketsResult,
  type ApiSearchCriterion,
  type ApiSearchField,
  type ApiSearchTicket,
} from '../../lib/api'
import { formatDate } from '../../lib/format'
import { bulkTickets } from '../../lib/store'
import type { Priority, TicketStatus } from '../../types'

type QueueTab = { id: string; title: string; sort: number; isPersonal?: boolean; staffId?: string; parentId?: string }

const PAGE_SIZES = [10, 25, 50, 100, 200]
const QUEUE_FLAG_DISABLED = 0x0004

const FALLBACK_COLUMNS: ApiSearchField[] = [
  { path: 'number', label: 'Ticket', type: 'text', group: 'Ticket' },
  { path: 'subject', label: 'Subject', type: 'text', group: 'Ticket' },
  { path: 'priority', label: 'Priority', type: 'select', group: 'Ticket' },
  { path: 'status', label: 'Status', type: 'select', group: 'Ticket' },
  { path: 'department', label: 'Department', type: 'select', group: 'Ticket' },
  { path: 'assignee', label: 'Assigned To', type: 'select', group: 'Ticket' },
  { path: 'updated', label: 'Last Updated', type: 'date', group: 'Dates' },
]

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function formatDateTime(value: unknown): string {
  const text = String(value ?? '')
  if (!text) return '—'
  const parsed = new Date(text)
  return Number.isFinite(parsed.getTime()) ? formatDate(text) : text
}

function escapeCsv(value: string) {
  const text = value.replace(/\r?\n/g, ' ')
  return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function lastSegment(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.split(/[\s,]+/).pop() || text
}

export function StaffQueuePage() {
  const [params, setParams] = useSearchParams()
  const queueId = params.get('queue') || 'open'
  const dept = params.get('dept') ?? 'all'
  const qParam = params.get('q') ?? ''
  const sortParam = params.get('sort') ?? ''
  const dirParam: 'asc' | 'desc' = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const requestedPageSize = Number(params.get('pageSize') || 25)
  const pageSize = PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : 25
  const page = Math.max(1, Number(params.get('page') || 1) || 1)

  const db = useDb()
  const { user } = useAuth()
  const { confirm } = useDialogs()
  const agents = useAgents()

  const [personalModalOpen, setPersonalModalOpen] = useState(false)
  const [editingPersonalQueueId, setEditingPersonalQueueId] = useState<string | null>(null)

  const [search, setSearch] = useState(qParam)
  const [catalog, setCatalog] = useState<QueueTab[]>(() => ticketQueues.map((queue, index) => ({ id: queue.id, title: queue.label, sort: index + 1 })))
  const [options, setOptions] = useState<ApiAdvancedSearchOptions | null>(null)
  const [result, setResult] = useState<ApiQueueTicketsResult | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    Promise.allSettled([listApiQueues(), getApiAdvancedSearchOptions()]).then(([queuesResult, optionsResult]) => {
      if (!active) return
      if (queuesResult.status === 'fulfilled') {
        const serverQueues = queuesResult.value.queues
          .filter((queue) => {
            const flags = Number(queue.flags || 0)
            if (!queue.builtin && (flags & QUEUE_FLAG_DISABLED)) return false
            const owner = queue.staffId || '0'
            return owner === '0' || owner === String(user?.id || '')
          })
          .map((queue) => ({
            id: queue.id,
            title: queue.title,
            sort: Number(queue.sort) || 0,
            isPersonal: Boolean(queue.staffId && queue.staffId !== '0' && queue.staffId === String(user?.id || '')),
            staffId: queue.staffId,
            parentId: queue.parentId,
          }))
        const appQueues = queuesResult.value.customQueues
          .filter((queue) => queue.enabled)
          .map((queue) => ({ id: queue.id, title: queue.title, sort: Number(queue.sort) || 0, isPersonal: false }))
        const seen = new Set<string>()
        const merged = [...serverQueues, ...appQueues].filter((queue) => {
          if (seen.has(queue.id)) return false
          seen.add(queue.id)
          return true
        })
        merged.sort((left, right) => left.sort - right.sort || left.title.localeCompare(right.title))
        setCatalog(merged)
      }
      if (optionsResult.status === 'fulfilled') setOptions(optionsResult.value)
    })
    return () => { active = false }
  }, [user?.id, refreshKey])

  useEffect(() => {
    setSearch(qParam)
  }, [qParam])

  useEffect(() => {
    if (search === qParam) return
    const timer = window.setTimeout(() => {
      setParams((current) => {
        const copy = new URLSearchParams(current)
        const value = search.trim()
        if (value) copy.set('q', value)
        else copy.delete('q')
        copy.set('page', '1')
        return copy
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [search, qParam, setParams])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const criteria: ApiSearchCriterion[] = dept !== 'all' ? [{ field: 'department', operator: 'equals', value: dept }] : []
    const input: ApiQueueTicketsInput = { q: qParam, criteria, page, pageSize }
    if (sortParam) input.sort = { field: sortParam, direction: dirParam }
    listApiQueueTickets(queueId, input)
      .then((queueResult) => {
        if (!active) return
        setResult(queueResult)
        setSelected([])
      })
      .catch((err: unknown) => {
        if (!active) return
        setResult(null)
        setError(err instanceof Error ? err.message : 'Could not load this queue.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [queueId, dept, qParam, sortParam, dirParam, page, pageSize, refreshKey])

  const columns = useMemo(() => (result?.columns.length ? result.columns : FALLBACK_COLUMNS), [result])
  const departments = options?.departments ?? db.departments.map((department) => ({ id: department.id, name: department.name }))
  const assignableAgents = options?.agents ?? agents.map((agent) => ({ id: agent.id, name: agent.name, email: agent.email }))
  const activeQueue = catalog.find((queue) => queue.id === queueId)
  const activeSort = sortParam ? { field: sortParam, direction: dirParam } : result?.sort
  const tickets = result?.tickets ?? []
  const allSelected = tickets.length > 0 && selected.length === tickets.length

  function patch(key: string, value: string) {
    setSelected([])
    setNotice('')
    setParams((current) => {
      const copy = new URLSearchParams(current)
      if (!value || (value === 'all' && key !== 'queue')) copy.delete(key)
      else copy.set(key, value)
      if (key !== 'page') copy.set('page', '1')
      return copy
    })
  }

  function changeSort(column: ApiSearchField) {
    const direction: 'asc' | 'desc' = activeSort?.field === column.path && activeSort.direction === 'desc' ? 'asc' : 'desc'
    setSelected([])
    setParams((current) => {
      const copy = new URLSearchParams(current)
      copy.set('sort', column.path)
      copy.set('dir', direction)
      copy.set('page', '1')
      return copy
    })
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function applyBulk(patchValues: { status?: TicketStatus; assigneeId?: string | null }) {
    if (!user || selected.length === 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await bulkTickets(selected, patchValues, user)
      setSelected([])
      setRefreshKey((key) => key + 1)
      setNotice(patchValues.status === 'closed' ? 'Tickets closed.' : patchValues.status === 'open' ? 'Tickets reopened.' : 'Ticket assignment updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the selected tickets.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteCurrentQueue(id: string, queueTitle: string) {
    if (!(await confirm({
      title: 'Delete Personal Queue',
      description: `Delete personal queue "${queueTitle}"? This cannot be undone.`,
      confirmLabel: 'Delete',
    }))) return
    try {
      await deleteApiPersonalQueue(id)
      setRefreshKey((k) => k + 1)
      patch('queue', 'open')
      setNotice('Personal queue deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete personal queue.')
    }
  }

  function exportCsv() {
    if (!result) return
    setExporting(true)
    setError('')
    void (async () => {
      try {
        const exportColumns = result.columns.length ? result.columns : FALLBACK_COLUMNS
        const criteria: ApiSearchCriterion[] = dept !== 'all' ? [{ field: 'department', operator: 'equals', value: dept }] : []
        const sort = sortParam ? { field: sortParam, direction: dirParam } : result.sort
        let rows = result.tickets
        if (result.pages > 1) {
          const collected: ApiSearchTicket[] = []
          const lastPage = Math.min(result.pages, 50)
          for (let index = 1; index <= lastPage; index += 1) {
            const pageResult = await listApiQueueTickets(queueId, { q: qParam, criteria, sort, page: index, pageSize: 200 })
            collected.push(...pageResult.tickets)
          }
          rows = collected
        }
        const header = exportColumns.map((column) => escapeCsv(column.label)).join(',')
        const body = rows
          .map((ticket) => exportColumns.map((column) => escapeCsv(formatCellValue(ticket.values[column.path]))).join(','))
          .join('\r\n')
        const blob = new Blob([header + '\r\n' + body], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `tickets-${queueId}-${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not export this queue.')
      } finally {
        setExporting(false)
      }
    })()
  }

  function renderCell(ticket: ApiSearchTicket, column: ApiSearchField) {
    const value = ticket.values[column.path]
    if (column.path === 'number') {
      return (
        <Link to={`/scp/tickets/${ticket.id}`} className="font-medium text-brand-600">
          {formatCellValue(value) === '—' ? ticket.number : formatCellValue(value)}
        </Link>
      )
    }
    if (column.path === 'subject') {
      return (
        <div>
          <Link to={`/scp/tickets/${ticket.id}`} className="hover:underline">
            {formatCellValue(value) === '—' ? ticket.subject : formatCellValue(value)}
          </Link>
          {ticket.snippet ? <p className="mt-1 max-w-xl text-xs text-ink-500">{ticket.snippet}</p> : null}
        </div>
      )
    }
    if (column.path === 'status') {
      return <StatusBadge status={String(ticket.status || lastSegment(value)).toLowerCase() as TicketStatus} />
    }
    if (column.path === 'priority') {
      return <PriorityBadge priority={String(value || ticket.priority).toLowerCase() as Priority} />
    }
    if (column.type === 'date') return formatDateTime(value)
    if (column.type === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : '—'
    return formatCellValue(value)
  }

  return (
    <div>
      <PageHeader
        title="Ticket queues"
        subtitle="Open, answered, mine, overdue, unassigned, and closed tickets."
        actions={
          <>
            <Link to="/scp/tickets/new" className={btnPrimary}>
              Open ticket
            </Link>
            <button type="button" className={btnGhost} onClick={exportCsv} disabled={!result || result.tickets.length === 0 || exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setEditingPersonalQueueId(null)
                setPersonalModalOpen(true)
              }}
            >
              Personal queues
            </button>
            {user?.role === 'admin' ? <Link to="/scp/admin/queues" className={btnGhost}>Manage queues</Link> : null}
          </>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-2">
        {catalog.map((queue) => (
          <button
            key={queue.id}
            type="button"
            onClick={() => patch('queue', queue.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5 ${
              queueId === queue.id ? 'bg-brand-600 text-white' : 'bg-surface ring-1 ring-line'
            }`}
          >
            {queue.isPersonal ? (
              <Bookmark className={`h-3 w-3 ${queueId === queue.id ? 'text-white' : 'text-brand-600'}`} />
            ) : null}
            <span>{queue.title}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search number, subject, requester, or message body"
          className={inputClass + ' flex-1'}
          aria-label="Search this queue"
        />
        <select value={dept} onChange={(event) => patch('dept', event.target.value)} className={inputClass + ' lg:w-56'} aria-label="Filter by department">
          <option value="all">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <select value={pageSize} onChange={(event) => patch('pageSize', event.target.value)} className={inputClass + ' lg:w-36'} aria-label="Tickets per page">
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
        <Link to="/scp/search" className={btnGhost}>Advanced search</Link>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}

      {selected.length > 0 && user ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => void applyBulk({ status: 'closed' })}>
            Close
          </button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => void applyBulk({ status: 'open' })}>
            Reopen
          </button>
          <select
            className={inputClass + ' w-auto'}
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value
              event.target.value = ''
              if (!value) return
              void applyBulk({ assigneeId: value === 'none' ? null : value })
            }}
            aria-label="Assign selected tickets"
          >
            <option value="">Assign…</option>
            <option value="none">Unassigned</option>
            {assignableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-800">{activeQueue?.title ?? queueId}</h2>
            {activeQueue?.isPersonal ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                <Bookmark className="h-3 w-3" />
                Personal Queue
              </span>
            ) : null}
          </div>
          <p className="text-sm text-ink-600">
            {loading && !result ? 'Loading tickets…' : result ? `${result.total.toLocaleString()} ticket${result.total === 1 ? '' : 's'}` : 'No queue loaded'}
            {result && result.total > 0 ? ` · page ${result.page} of ${Math.max(1, result.pages)}` : ''}
            {result?.keyword ? ` · keyword “${result.keyword}”` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeQueue?.isPersonal ? (
            <>
              <button
                type="button"
                className={btnGhost + ' text-xs px-2.5 py-1.5'}
                onClick={() => {
                  setEditingPersonalQueueId(activeQueue.id)
                  setPersonalModalOpen(true)
                }}
              >
                Edit queue
              </button>
              <button
                type="button"
                className={btnGhost + ' text-xs text-rose-600 hover:text-rose-700 px-2.5 py-1.5'}
                onClick={() => void deleteCurrentQueue(activeQueue.id, activeQueue.title)}
              >
                Delete
              </button>
            </>
          ) : null}
          {loading && result ? <span className="text-sm text-ink-500">Refreshing…</span> : null}
        </div>
      </div>

      <ul className="mt-4 grid gap-3 lg:hidden">
        {tickets.map((ticket) => (
          <li key={ticket.id} className="rounded-2xl border border-line bg-surface p-4">
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(ticket.id)} onChange={() => toggle(ticket.id)} />
              Select
            </label>
            <Link to={`/scp/tickets/${ticket.id}`} className="block">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">
                  #{ticket.number} {ticket.subject}
                </p>
                <StatusBadge status={String(ticket.status).toLowerCase() as TicketStatus} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                <PriorityBadge priority={String(ticket.priority).toLowerCase() as Priority} />
                {ticket.department ? <span>{ticket.department}</span> : null}
                <span>{ticket.assignee || 'Unassigned'}</span>
                <span>{formatDateTime(ticket.updatedAt)}</span>
                {ticket.overdue ? <span className="text-rose-600">overdue</span> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="-mx-3 hidden overflow-x-auto px-3 lg:mx-0 lg:block lg:px-0">
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-paper text-ink-600">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? tickets.map((ticket) => ticket.id) : [])}
                    aria-label="Select all tickets on this page"
                  />
                </th>
                {columns.map((column) => {
                  const active = activeSort?.field === column.path
                  return (
                    <th key={column.path} className="whitespace-nowrap px-4 py-3 font-medium">
                      <button type="button" className={active ? 'text-brand-700' : undefined} onClick={() => changeSort(column)}>
                        {column.label}{active ? (activeSort?.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(ticket.id)}
                      onChange={() => toggle(ticket.id)}
                      aria-label={`Select ticket ${ticket.number}`}
                    />
                  </td>
                  {columns.map((column) => (
                    <td key={column.path} className="max-w-[22rem] break-words px-4 py-3">
                      {renderCell(ticket, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loading && tickets.length === 0 ? <p className="px-4 py-6 text-sm text-ink-600">Loading tickets…</p> : null}
          {!loading && tickets.length === 0 ? <p className="px-4 py-6 text-sm text-ink-600">No tickets in this queue.</p> : null}
        </div>
      </div>

      {!loading && tickets.length === 0 ? <p className="mt-4 text-sm text-ink-600 lg:hidden">No tickets in this queue.</p> : null}

      {result && result.pages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" className={btnGhost} disabled={result.page <= 1 || loading} onClick={() => patch('page', String(result.page - 1))}>
            Previous
          </button>
          <span className="text-sm text-ink-600">
            Page {result.page} of {result.pages}
          </span>
          <button type="button" className={btnGhost} disabled={result.page >= result.pages || loading} onClick={() => patch('page', String(result.page + 1))}>
            Next
          </button>
        </div>
      ) : null}

      <PersonalQueueModal
        open={personalModalOpen}
        onOpenChange={(isOpen) => {
          setPersonalModalOpen(isOpen)
          if (!isOpen) setEditingPersonalQueueId(null)
        }}
        initialQueueId={editingPersonalQueueId}
        parentQueueOptions={catalog.filter((q) => !q.isPersonal)}
        onSaved={(newQueueId) => {
          setRefreshKey((k) => k + 1)
          patch('queue', newQueueId)
        }}
        onDeleted={(deletedId) => {
          setRefreshKey((k) => k + 1)
          if (queueId === deletedId) {
            patch('queue', 'open')
          }
        }}
        onSelectQueue={(selectedQueueId) => {
          patch('queue', selectedQueueId)
        }}
      />
    </div>
  )
}
