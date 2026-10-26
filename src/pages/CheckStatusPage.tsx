import { FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiLookupTicketByEmail } from '../lib/api'
import { hydrateSingleApiTicket } from '../lib/store'

import { inputClass } from "../components/ui"
export function CheckStatusPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [number, setNumber] = useState(params.get('number') ?? '')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await apiLookupTicketByEmail(number.trim(), email.trim())
      const hydrated = hydrateSingleApiTicket(result.ticket, result.messages)
      if (!hydrated) throw new Error('Ticket could not be loaded.')
      navigate(`/tickets/${hydrated.id}?guest=1&email=${encodeURIComponent(email)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No ticket matched that email and number.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold dark:text-slate-500">Check ticket status</h1>
      <p className="mt-1 text-sm text-ink-600">Enter the email used on the ticket and the ticket number.</p>
      {params.get('number') ? (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Ticket #{params.get('number')} was created. Check it below.
        </p>
      ) : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border-4 dark:border-slate-600 border-slate-200 p-5 shadow-sm">
        <label className="block text-sm font-medium dark:text-slate-400">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass + " mt-1"}
          />
        </label>
        <label className="block text-sm font-medium dark:text-slate-400">
          Ticket number
          <input
            required
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className={inputClass + " mt-1"}
            placeholder=""
          />
        </label>
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white disabled:opacity-60">
          {loading ? 'Loading…' : 'View ticket'}
        </button>
      </form>
    </div>
  )
}
