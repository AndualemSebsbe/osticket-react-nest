import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { PriorityBadge, StatusBadge } from '../components/Badges'
import { inputClass } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { formatDate, relativeTime } from '../lib/format'
import { apiCheckMyTicketStatus, type ApiPersistedTicket, type ApiPersistedMessage } from '../lib/api'
import { getDb } from '../lib/store'

interface TicketResult {
  ticket: ApiPersistedTicket & {
    id: string
    department: string
    topic: string
    messages: ApiPersistedMessage[]
  }
  messages: ApiPersistedMessage[]
}

export function CheckStatusPage() {
  const { user } = useAuth()
  const [number, setNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TicketResult | null>(null)

  const db = getDb()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const data = await apiCheckMyTicketStatus(number.trim())
      setResult(data as TicketResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No ticket found with that number.')
    } finally {
      setLoading(false)
    }
  }

  function onClear() {
    setResult(null)
    setError('')
    setNumber('')
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="text-sm text-ink-600">
          <Link to="/login" className="font-semibold text-brand-600 underline">Sign in</Link> to check your ticket status.
        </p>
      </div>
    )
  }

  const ticket = result?.ticket
  const publicMessages = result?.messages.filter(m => !m.internal) ?? []

  const statusColorMap: Record<string, string> = {
    open: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    pending: 'bg-amber-50 border-amber-200 text-amber-900',
    closed: 'bg-slate-50 border-slate-200 text-slate-700',
    resolved: 'bg-sky-50 border-sky-200 text-sky-900',
  }
  const statusColor = ticket ? (statusColorMap[ticket.status] ?? statusColorMap.open) : ''

  const lastReply = [...publicMessages].reverse().find(m => m.kind === 'agent')
  const lastClientMsg = [...publicMessages].reverse().find(m => m.kind === 'client' || m.kind === 'collaborator')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold dark:text-white">Check Ticket Status</h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-slate-400">
          Enter your ticket number to view its current status and conversation history.
        </p>
      </div>

      {/* Lookup form */}
      {!result ? (
        <form onSubmit={onSubmit} className="rounded-2xl border-4 border-slate-200 dark:border-slate-600 bg-surface p-6 shadow-sm space-y-4">
          <label className="block text-sm font-medium dark:text-slate-300">
            Ticket Number
            <input
              required
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder="e.g. 123456"
              className={inputClass + ' mt-1'}
            />
          </label>
          {error ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 border border-rose-200">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-60 hover:bg-brand-700 transition-colors"
          >
            {loading ? 'Looking up…' : 'Check Status'}
          </button>
          <p className="text-center text-sm text-ink-500 dark:text-slate-400">
            To see all your tickets, visit{' '}
            <Link to="/tickets" className="font-medium text-brand-600 hover:underline">My Tickets</Link>.
          </p>
        </form>
      ) : ticket ? (
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`rounded-2xl border-2 p-5 ${statusColor}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Ticket #{ticket.number}</p>
                <h2 className="mt-1 text-xl font-semibold">{ticket.subject}</h2>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <StatusBadge status={ticket.status} label={ticket.statusName || ticket.status} />
                <PriorityBadge priority={ticket.priority} />
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-surface p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Ticket Details</h3>
              <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                <dt className="text-ink-600 dark:text-slate-400">Status</dt>
                <dd className="font-medium capitalize dark:text-white">{ticket.statusName || ticket.status}</dd>
                <dt className="text-ink-600 dark:text-slate-400">Priority</dt>
                <dd className="capitalize dark:text-white">{ticket.priority}</dd>
                <dt className="text-ink-600 dark:text-slate-400">Department</dt>
                <dd className="dark:text-white">{ticket.department || '—'}</dd>
                <dt className="text-ink-600 dark:text-slate-400">Help Topic</dt>
                <dd className="dark:text-white">{ticket.topic || '—'}</dd>
                {ticket.branchName ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Branch</dt>
                    <dd className="dark:text-white">{ticket.branchName}</dd>
                  </>
                ) : null}
                <dt className="text-ink-600 dark:text-slate-400">Opened</dt>
                <dd className="dark:text-white">{formatDate(ticket.createdAt)}</dd>
                <dt className="text-ink-600 dark:text-slate-400">Last Updated</dt>
                <dd className="dark:text-white">{relativeTime(ticket.updatedAt)}</dd>
                {ticket.assignee ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Assigned To</dt>
                    <dd className="dark:text-white">{ticket.assignee}</dd>
                  </>
                ) : null}
                {ticket.overdue ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Overdue</dt>
                    <dd className="font-semibold text-rose-600">Yes</dd>
                  </>
                ) : null}
              </dl>
            </section>

            <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-surface p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Conversation Summary</h3>
              <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                <dt className="text-ink-600 dark:text-slate-400">Messages</dt>
                <dd className="dark:text-white">{publicMessages.length}</dd>
                {lastClientMsg ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Your last msg</dt>
                    <dd className="dark:text-white">{relativeTime(lastClientMsg.createdAt)}</dd>
                  </>
                ) : null}
                {lastReply ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Last reply</dt>
                    <dd className="dark:text-white">{relativeTime(lastReply.createdAt)}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Last reply</dt>
                    <dd className="text-ink-500 dark:text-slate-400 italic">Awaiting response</dd>
                  </>
                )}
                {ticket.collaborators && ticket.collaborators.length > 0 ? (
                  <>
                    <dt className="text-ink-600 dark:text-slate-400">Collaborators</dt>
                    <dd className="dark:text-white">{ticket.collaborators.filter(c => c.active).length}</dd>
                  </>
                ) : null}
              </dl>

              {/* Latest snippet */}
              {lastReply ? (
                <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-700 p-3">
                  <p className="text-xs font-medium text-ink-500 dark:text-slate-400 mb-1">Latest agent reply</p>
                  <p className="text-sm text-ink-700 dark:text-slate-200 line-clamp-3">{lastReply.body.replace(/<[^>]+>/g, '').trim()}</p>
                </div>
              ) : null}
            </section>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/tickets/${ticket.id}`}
              className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700 transition-colors text-sm"
            >
              View Full Thread →
            </Link>
            {ticket.status !== 'closed' ? (
              <Link
                to={`/tickets/${ticket.id}`}
                className="rounded-xl border-2 border-brand-600 px-5 py-2.5 font-semibold text-brand-600 hover:bg-brand-50 transition-colors text-sm"
              >
                Post a Reply
              </Link>
            ) : null}
            <button
              type="button"
              onClick={onClear}
              className="rounded-xl border-2 border-slate-300 dark:border-slate-600 px-5 py-2.5 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              Check Another Ticket
            </button>
          </div>

          {/* Quick stats / awareness */}
          {ticket.status === 'closed' ? (
            <p className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
              This ticket is <strong>closed</strong>.{' '}
              {db.settings?.allowClientReopen
                ? 'You can reopen it by visiting the full thread and clicking "Reopen ticket".'
                : 'Contact support if you need further assistance.'}
            </p>
          ) : ticket.status === 'pending' ? (
            <p className="rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              This ticket is <strong>pending your response</strong>. Please reply to continue.
            </p>
          ) : !lastReply ? (
            <p className="rounded-xl bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-700 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
              Your ticket is <strong>open</strong> and awaiting a response from our support team.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
