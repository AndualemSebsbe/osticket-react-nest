import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useDb } from '../../hooks/useDb'
import { resetDemo } from '../../lib/store'

export function StaffDashboardPage() {
  const db = useDb()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const stats = useMemo(() => {
    const open = db.tickets.filter((t) => t.status === 'open').length
    const pending = db.tickets.filter((t) => t.status === 'pending').length
    const closed = db.tickets.filter((t) => t.status === 'closed').length
    const overdue = db.tickets.filter((t) => t.overdue).length
    const byDept = db.departments.map((d) => ({
      name: d.name,
      count: db.tickets.filter((t) => t.deptId === d.id).length,
    }))
    return { open, pending, closed, overdue, byDept }
  }, [db])

  const max = Math.max(...stats.byDept.map((d) => d.count), 1)

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ticket activity</h1>
          <p className="text-sm text-ink-600">Live counts from demo tickets stored in this browser.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin ? (
            <Link to="/scp/admin" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              Admin panel
            </Link>
          ) : null}
          <button type="button" onClick={resetDemo} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm">
            Reset demo data
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open', value: stats.open, to: '/scp/tickets?queue=open' },
          { label: 'Pending', value: stats.pending, to: '/scp/tickets?queue=pending' },
          { label: 'Closed', value: stats.closed, to: '/scp/tickets?queue=closed' },
          { label: 'Overdue', value: stats.overdue, to: '/scp/tickets?queue=overdue' },
        ].map((s) => (
          <Link key={s.label} to={s.to}>
            <Card>
              <p className="text-sm text-ink-600">{s.label}</p>
              <p className="mt-1 text-3xl font-semibold">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>
      <section>
        <Card>
        <h2 className="font-semibold">By department</h2>
        <ul className="mt-4 space-y-3">
          {stats.byDept.map((d) => (
            <li key={d.name}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{d.name}</span>
                <span className="text-ink-400">{d.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        </Card>
      </section>
    </div>
  )
}
