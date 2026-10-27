import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PriorityBadge, StatusBadge } from '../components/Badges'
import { EmptyState, TicketThread } from '../components/TicketThread'
import { btnGhost, inputClass} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../lib/format'
import { printTicket } from '../lib/printTicket'
import { addReply, canAccessTicket, getDb, getTicket, messagesFor, reopenTicket, subscribe } from '../lib/store'

export function TicketViewPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const [, setTick] = useState(0)
  useEffect(() => subscribe(() => setTick((n) => n + 1)), [])

  const db = getDb()
  const guestEmail = params.get('email') ?? ''
  const isGuest = params.get('guest') === '1' && Boolean(guestEmail)
  let ticket = id ? getTicket(id) : undefined

  if (ticket && !canAccessTicket(ticket.id, user, isGuest ? guestEmail : undefined)) {
    ticket = undefined
  }

  if (!ticket) {
    return <EmptyState title="Ticket not found" body="Sign in or use Check status with the correct email and number." to="/status" cta="Check status" />
  }

  const owner = db.users.find((u) => u.id === ticket.userId)
  const dept = db.departments.find((d) => d.id === ticket.deptId)
  const topic = db.topics.find((t) => t.id === ticket.topicId)
  const thread = messagesFor(ticket.id, false)
  const isOwner = user?.id === ticket.userId
  const orgPeer = user?.orgId && owner?.orgId === user.orgId && !isOwner
  const canReply = (user?.role === 'client' && (isOwner || ticket.collaboratorIds?.includes(user.id))) || isGuest
  const canEdit = isOwner && ticket.status !== 'closed'
  const canReopen = isOwner && ticket.status === 'closed' && db.settings.allowClientReopen

  function onReply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const author = user?.role === 'client' ? user : db.users.find((u) => u.email.toLowerCase() === guestEmail.toLowerCase())
    if (!author) return
    const form = e.currentTarget
    const data = new FormData(form)
    const files = data.getAll('files') as File[]
    addReply({
      ticketId: ticket!.id,
      author,
      body: String(data.get('body')),
      attachments: files.filter((f) => f.name).map((f) => f.name),
    })
    form.reset()
  }

  function onReopen() {
    if (!user || !canReopen) return
    reopenTicket(ticket!.id, user)
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to={user?.role === 'client' ? '/tickets' : '/status'} className="text-sm text-brand-600">
          ← Back
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-2xl font-semibold">
            {ticket.subject} <span className="text-ink-400">#{ticket.number}</span>
          </h1>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={() => printTicket(ticket!, thread, db)}>
            Print
          </button>
          {canEdit ? (
            <Link to={`/tickets/${ticket.id}/edit`} className={btnGhost}>
              Edit ticket
            </Link>
          ) : null}
          {canReopen ? (
            <button type="button" className={btnGhost} onClick={onReopen}>
              Reopen ticket
            </button>
          ) : null}
        </div>
        {orgPeer ? <p className="mt-2 text-sm text-ink-600">Organization ticket — visible because you share an org with {owner?.name}.</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-600 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">Ticket</h2>
          <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
            <dt className="text-ink-600 ">Department</dt>
            <dd className="capitalize dark:text-white">{dept?.name}</dd>
            <dt className="text-ink-600">Help topic</dt>
            <dd className="capitalize dark:text-white">{topic?.name}</dd>
            <dt className="text-ink-600">Branch</dt>
            <dd className="capitalize dark:text-white">{ticket.branchName || '—'}</dd>
            <dt className="text-ink-600">Created</dt>
            <dd className="capitalize dark:text-white">{formatDate(ticket.createdAt)}</dd>
            <dt className="text-ink-600">Source</dt>
            <dd className="capitalize dark:text-white">{ticket.source}</dd>
          </dl>
        </section>
        <section className="rounded-2xl border-2 border-slate-200 dark:border-slate-600 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">User</h2>
          <dl className="mt-3 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
            <dt className="text-ink-600">Name</dt>
            <dd className="capitalize dark:text-white">{owner?.name}</dd>
            <dt className="text-ink-600">Email</dt>
            <dd className="break-all dark:text-white">{owner?.email}</dd>
            <dt className="text-ink-600">Phone</dt>
            <dd className="capitalize dark:text-white">{owner?.phone || '—'}</dd>
          </dl>
        </section>
      </div>
      <TicketThread messages={thread} ticketNumber={ticket.number} attachmentEmail={isGuest ? guestEmail : undefined} />
      {canReply ? (
        <form onSubmit={onReply} className="rounded-2xl border border-line bg-surface p-4">
          <label className="block text-sm font-medium">
            Post a reply
            <textarea required name="body" rows={4} className={inputClass + " mt-1"} />
          </label>
          <label className="mt-3 block text-sm">
            Attachments
            <input name="files" type="file" multiple className="mt-1 block w-full text-sm" />
          </label>
          <button type="submit" className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            Send reply
          </button>
          {ticket.status === 'closed' && db.settings.allowClientReopen ? (
            <p className="mt-2 text-xs text-ink-500">Replying will reopen this ticket.</p>
          ) : null}
        </form>
      ) : ticket.status === 'closed' ? (
        <p className="text-sm text-ink-600">
          This ticket is closed.
          {db.settings.allowClientReopen && isOwner ? ' Use Reopen ticket above, or sign in to reply.' : ' Sign in as the ticket owner to follow up.'}
        </p>
      ) : (
        <p className="text-sm text-ink-600">Sign in as the ticket owner to reply, or use the guest access link from Check status.</p>
      )}
    </div>
  )
}
