import { useDb } from '../../hooks/useDb'
import { Card, PageHeader } from '../../components/ui'

export function StaffDirectoryPage() {
  const db = useDb()
  const clients = db.users.filter((u) => u.role === 'client')
  const staff = db.users.filter((u) => u.role !== 'client')

  return (
    <div className="space-y-8">
      <PageHeader title="Directory" subtitle="Agents and end users in this help desk." />
      <section>
        <h2 className="mb-3 font-semibold">Agents</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {staff.map((u) => (
            <li key={u.id}>
              <Card>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{u.name}</p>
                    <p className="truncate text-sm text-ink-600">{u.email}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase text-brand-700">{u.role}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Users</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((u) => (
            <li key={u.id}>
              <Card>
                <p className="font-medium">{u.name}</p>
                <p className="text-sm text-ink-600">
                  {u.email} {u.org ? `· ${u.org}` : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
