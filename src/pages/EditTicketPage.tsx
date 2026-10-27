import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/TicketThread'
import { useAuth } from '../context/AuthContext'
import { useDb } from '../hooks/useDb'
import { canAccessTicket, editClientTicket, getTicket } from '../lib/store'

import { inputClass } from "../components/ui"
export function EditTicketPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const db = useDb()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const ticket = id ? getTicket(id) : undefined

  if (!user || user.role !== 'client') {
    return <EmptyState title="Sign in first" body="Only registered clients can edit tickets." to="/login" cta="Sign in" />
  }
  if (!ticket || !canAccessTicket(ticket.id, user) || ticket.userId !== user.id) {
    return <EmptyState title="Ticket not found" body="You can only edit tickets you opened." to="/tickets" cta="My tickets" />
  }
  if (ticket.status === 'closed') {
    return <Navigate to={`/tickets/${ticket.id}`} replace />
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSaving(true)
    setError('')
    try {
      editClientTicket(ticket!.id, user!.id, {
        subject: String(form.get('subject')),
        topicId: String(form.get('topicId')),
      })
      navigate(`/tickets/${ticket!.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save ticket changes.')
    } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link to={`/tickets/${ticket.id}`} className="text-sm text-brand-600">
        ← Back to ticket
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Edit ticket #{ticket.number}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
        <label className="block text-sm font-medium">
          Subject
          <input name="subject" required defaultValue={ticket.subject} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Help topic
          <select name="topicId" defaultValue={ticket.topicId} className={inputClass + " mt-1"}>
            {db.topics.filter((t) => t.active !== false).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
        <button type="submit" disabled={saving} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}
