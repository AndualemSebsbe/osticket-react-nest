import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Field, PageHeader, inputClass, btnPrimary } from '../../components/ui'
import { advancedSearchApiTickets } from '../../lib/api'

const fields = [
  ['number', 'Ticket number'], ['subject', 'Subject'], ['status', 'Status'], ['priority', 'Priority'],
  ['department', 'Department'], ['topic', 'Help topic'], ['requester', 'Requester name'], ['email', 'Requester email'], ['assignee', 'Assigned agent'], ['source', 'Source'],
] as const
const dateFields = [['createdFrom','Created after'],['createdTo','Created before'],['updatedFrom','Updated after'],['updatedTo','Updated before']] as const

export function StaffSearchPage() {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [tickets, setTickets] = useState<Array<Record<string, any>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try { setTickets((await advancedSearchApiTickets({ q, filters })).tickets) }
    catch (err) { setError(err instanceof Error ? err.message : 'Search failed.') }
    finally { setLoading(false) }
  }
  return <div>
    <PageHeader title="Advanced Ticket Search" subtitle="Search tickets by keywords and match specific ticket fields." />
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Keywords"><input value={q} onChange={e=>setQ(e.target.value)} className={inputClass} placeholder="Ticket number, subject, requester, email, or message" /></Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([key,label])=><Field key={key} label={label}><input value={filters[key]||''} onChange={e=>setFilters(current=>({...current,[key]:e.target.value}))} className={inputClass} /></Field>)}
        </div>
        <h2 className="pt-2 font-semibold">Date range</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dateFields.map(([key,label])=><Field key={key} label={label}><input type="date" value={filters[key]||''} onChange={e=>setFilters(current=>({...current,[key]:e.target.value}))} className={inputClass} /></Field>)}
        </div>
        <button disabled={loading} className={btnPrimary}>{loading?'Searching…':'Search tickets'}</button>
      </form>
    </Card>
    {error?<p className="mt-4 text-sm text-rose-600">{error}</p>:null}
    {tickets?<Card className="mt-5"><h2 className="font-semibold">Tickets ({tickets.length})</h2><ul className="mt-3 divide-y divide-line">{tickets.map(t=><li key={t.id} className="py-3"><Link to={`/scp/tickets/${t.id}`} className="font-medium text-brand-700">#{t.number} {t.subject}</Link><p className="text-sm text-ink-600">{t.status} · {t.priority} · {t.department} · {t.requesterName} · {t.requesterEmail}</p></li>)}{tickets.length===0?<li className="py-3 text-sm text-ink-500">No matching tickets.</li>:null}</ul></Card>:null}
  </div>
}
