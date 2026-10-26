import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Field, PageHeader, inputClass, btnPrimary } from '../../components/ui'
import { useDb } from '../../hooks/useDb'
import { searchHelpdesk } from '../../lib/store'

export function StaffSearchPage() {
  useDb()
  const [q, setQ] = useState('')
  const [result, setResult] = useState<ReturnType<typeof searchHelpdesk> | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setResult(searchHelpdesk(q))
  }

  return (
    <div>
      <PageHeader title="Search" subtitle="Find tickets, users, and FAQs the way osTicket advanced search does — locally in this demo." />
      <form onSubmit={onSubmit} className="mb-6 flex flex-col gap-2 sm:flex-row">
        <Field label="Query" className="flex-1">
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inputClass} placeholder="Number, subject, name, or article" />
        </Field>
        <button className={`${btnPrimary} sm:mt-6`}>Search</button>
      </form>
      {result ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h2 className="font-semibold">Tickets ({result.tickets.length})</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {result.tickets.map((t) => (
                <li key={t.id}>
                  <Link to={`/scp/tickets/${t.id}`} className="text-brand-600">
                    #{t.number} {t.subject}
                  </Link>
                </li>
              ))}
              {result.tickets.length === 0 ? <li className="text-ink-400">None</li> : null}
            </ul>
          </Card>
          <Card>
            <h2 className="font-semibold">Users ({result.users.length})</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {result.users.map((u) => (
                <li key={u.id}>
                  <Link to={`/scp/users/${u.id}`} className="text-brand-600">
                    {u.name}
                  </Link>
                  <span className="block break-all text-ink-400">{u.email}</span>
                </li>
              ))}
              {result.users.length === 0 ? <li className="text-ink-400">None</li> : null}
            </ul>
          </Card>
          <Card>
            <h2 className="font-semibold">Knowledgebase ({result.faqs.length})</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {result.faqs.map((f) => (
                <li key={f.id}>
                  <Link to={`/kb/${f.id}`} className="text-brand-600">
                    {f.question}
                  </Link>
                </li>
              ))}
              {result.faqs.length === 0 ? <li className="text-ink-400">None</li> : null}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
